"""Les réglages d'e-mails d'une personne dans une boutique (contrat §7). Chacun règle uniquement les siens."""

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response

from core.exceptions import ProblemError
from core.ratelimit import enforce, hit
from shops.permissions import ShopScopedView

from . import compose
from .events import allowed_events, choices_for, default_enabled, includes_revenue, is_enabled
from .models import NotificationPreference
from .recipients import Recipient
from .send import Budget, Pending, send_all, sending_active

PREFS_LIMIT = (60, 3600)  # par membre
TEST_MEMBER_LIMIT = (3, 3600)  # par membre
TEST_SHOP_LIMIT = (20, 86400)  # par boutique
MAX_KEYS = 20


def payload(request, membership):
    explicit = choices_for([membership])
    events = []
    for event in allowed_events(membership):
        default = default_enabled(event, membership.role)
        enabled = is_enabled(event, membership, explicit)
        row = {"id": event.id, "enabled": enabled, "default": default, "custom": enabled != default}
        if event.id == "daily_summary":
            row["includes_revenue"] = includes_revenue(membership)
        events.append(row)
    return {"sending": sending_active(), "email": request.user.email, "events": events}


def _invalid_event():
    # Le même corps pour un identifiant inconnu, non prêt ou sans droit : on n'apprend rien sur ce qui existe.
    return ProblemError(400, "invalid_event", "Ce réglage n'existe pas.")


class NotificationsView(ShopScopedView):
    permission_by_method = {"GET": "orders.view", "PUT": "orders.view"}

    def get(self, request, slug):
        return Response(payload(request, self.membership))

    def put(self, request, slug):
        enforce("notify_prefs", str(self.membership.pk), PREFS_LIMIT)
        body = request.data.get("events") if isinstance(request.data, dict) else None
        if not isinstance(body, dict) or not body or len(body) > MAX_KEYS:
            raise serializers.ValidationError({"events": [{"code": "invalid", "message": "Indiquez 1 à 20 réglages."}]})
        if any(not isinstance(value, bool) for value in body.values()):
            raise serializers.ValidationError({"events": [{"code": "invalid", "message": "Chaque réglage est oui ou non."}]})
        allowed = {event.id: event for event in allowed_events(self.membership)}
        if any(key not in allowed for key in body):
            raise _invalid_event()
        with transaction.atomic():
            for key, value in body.items():
                if value == default_enabled(allowed[key], self.membership.role):
                    NotificationPreference.objects.filter(membership=self.membership, event=key).delete()
                else:
                    NotificationPreference.objects.update_or_create(
                        membership=self.membership, event=key, defaults={"enabled": value, "updated_at": timezone.now()}
                    )
        return Response(payload(request, self.membership))


class NotificationsTestView(ShopScopedView):
    """Un e-mail de test vers l'adresse du compte, jamais vers une adresse saisie."""

    permission_by_method = {"POST": "orders.view"}

    def post(self, request, slug):
        enforce("notify_test:member", str(self.membership.pk), TEST_MEMBER_LIMIT)
        enforce("notify_test:shop", str(self.shop.pk), TEST_SHOP_LIMIT)
        if not sending_active():
            raise ProblemError(409, "notifications_disabled", "L'envoi d'e-mails n'est pas encore activé sur ce serveur.")
        recipient = Recipient(self.membership, frozenset(self.permissions))
        pending = Pending(state=None, message=compose.test_message(recipient, self.shop), refs=[], held_count=0)
        send_all([pending], Budget())
        if pending.failed:
            raise ProblemError(502, "email_failed", "L'e-mail de test n'a pas pu partir.")
        return Response({"sent": True})
