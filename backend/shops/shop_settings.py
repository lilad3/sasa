"""Paramètres de la boutique : profil de la vitrine, mode vacances et plan. Réservés au propriétaire."""

from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail, ValidationError
from rest_framework.response import Response

from accounts.sessions import require_reauth
from audit.models import AuditEvent
from audit.services import record
from core.exceptions import ProblemError

from . import plans
from .activity import DETAILS, _people
from .models import Accent, Sector
from .permissions import ShopScopedView
from .storefront import plain_text
from .team import full_name


class ShopSettingsSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=60, validators=[plain_text])
    description = serializers.CharField(max_length=280, allow_blank=True, validators=[plain_text])
    city = serializers.CharField(max_length=60, allow_blank=True, validators=[plain_text])
    accent = serializers.ChoiceField(choices=Accent.choices)
    sector = serializers.ChoiceField(choices=Sector.choices)
    vacation_active = serializers.BooleanField()
    vacation_message = serializers.CharField(max_length=280, allow_blank=True, validators=[plain_text])
    vacation_until = serializers.DateField(allow_null=True)

    def validate_vacation_until(self, value):
        if value is not None and value <= timezone.localdate():
            raise serializers.ValidationError("La date de retour doit être après aujourd'hui.", code="date_in_past")
        return value


def settings_payload(shop):
    return {
        "slug": shop.slug,
        "name": shop.name,
        "description": shop.description,
        "city": shop.city,
        "accent": shop.accent,
        "sector": shop.sector,
        "plan": shop.plan,
        "custom_accent": plans.spec(shop).custom_accent,
        "vacation": {
            "active": shop.vacation_active,
            "message": shop.vacation_message,
            "until": shop.vacation_until,
            # Actif, mais la date de retour est passée : la vitrine a déjà rouvert.
            "on_vacation": shop.on_vacation(),
        },
    }


class ShopSettingsView(ShopScopedView):
    permission_by_method = {"GET": "shop.manage", "PATCH": "shop.manage"}

    def get(self, request, slug):
        return Response(settings_payload(self.shop))

    def patch(self, request, slug):
        serializer = ShopSettingsSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        changes = {
            field: value for field, value in serializer.validated_data.items() if getattr(self.shop, field) != value
        }
        if "accent" in changes:
            plans.require_feature(self.shop, "custom_accent")
        if changes:
            for field, value in changes.items():
                setattr(self.shop, field, value)
            self.shop.save(update_fields=list(changes))
            record("shop_updated", request, actor=request.user, shop=self.shop, fields=sorted(changes))
        return Response(settings_payload(self.shop))


class PlanListView(ShopScopedView):
    permission_by_method = {"GET": "shop.manage"}

    def get(self, request, slug):
        return Response(plans.plans_payload(self.shop))


class PlanChangeView(ShopScopedView):
    """Changer de plan engage la boutique (et un jour, un paiement) : confirmation renforcée."""

    permission_by_method = {"POST": "shop.manage"}

    def post(self, request, slug):
        target = request.data.get("plan")
        if target not in plans.PLANS:
            raise ValidationError({"plan": [ErrorDetail("Plan attendu : free, pro ou business.", code="invalid_choice")]})
        require_reauth(request)
        if target != self.shop.plan:
            if blockers := plans.downgrade_blockers(self.shop, target):
                raise ProblemError(
                    409,
                    "plan_too_small",
                    f"Le plan {plans.PLANS[target].name} ne suffit pas : " + " ; ".join(blockers) + ".",
                )
            previous = self.shop.plan
            self.shop.plan = target
            self.shop.save(update_fields=["plan"])
            record("plan_changed", request, actor=request.user, shop=self.shop, previous_plan=previous, new_plan=target)
        return Response(plans.plans_payload(self.shop))


PLAN_HISTORY_FOR = timedelta(days=365)  # le journal de la boutique garde 90 jours ; un historique de forfait remonte plus loin
PLAN_HISTORY_MAX = 24


class PlanHistoryView(ShopScopedView):
    """Les changements de plan des douze derniers mois, lus dans le journal d'audit (aucune donnée de plus que lui)."""

    permission_by_method = {"GET": "shop.manage"}

    def get(self, request, slug):
        events = list(
            AuditEvent.objects.filter(
                shop_id=self.shop.pk, action="plan_changed", created_at__gte=timezone.now() - PLAN_HISTORY_FOR
            ).order_by("-id")[:PLAN_HISTORY_MAX]
        )
        users, _ = _people(self.shop, [event.actor_id for event in events])
        results = []
        for event in events:
            details = {key: event.metadata[key] for key in DETAILS["plan_changed"] if key in event.metadata}
            user = users.get(str(event.actor_id)) if event.actor_id else None
            results.append(
                {
                    "id": str(event.public_id),
                    "at": event.created_at,
                    "previous_plan": details.get("previous_plan"),
                    "new_plan": details.get("new_plan"),
                    "actor": {"name": full_name(user) if user else event.actor_email, "is_you": event.actor_id == request.user.pk},
                }
            )
        return Response({"results": results})
