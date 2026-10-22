"""
Objectif du mois (docs/chantier-p4.md §D). Le propriétaire fixe un montant ; toute l'équipe suit la jauge,
mais le vendeur ne voit que le pourcentage : ni le montant visé, ni le chiffre d'affaires.
"""

import calendar
from datetime import datetime, time, timedelta

from django.db import transaction
from django.db.models import Sum
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response

from audit.services import record
from core.ratelimit import enforce

from .models import Membership, NoteAudience, Order, OrderStatus, Role, ShopGoal, TeamNote, TeamNoteReceipt
from .permissions import ShopScopedView
from .team import full_name

MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"]
GOAL_SET_LIMIT = (20, 3600)  # par boutique
HISTORY_MONTHS = 3


def next_month(first):
    return (first.replace(day=28) + timedelta(days=4)).replace(day=1)


def month_revenue(shop, first):
    """Chiffre d'affaires du mois, hors commandes annulées (même règle que le dashboard)."""
    tz = timezone.get_current_timezone()
    total = (
        Order.objects.for_shop(shop)
        .exclude(status=OrderStatus.CANCELLED)
        .filter(
            created_at__gte=datetime.combine(first, time.min, tzinfo=tz),
            created_at__lt=datetime.combine(next_month(first), time.min, tzinfo=tz),
        )
        .aggregate(total=Sum("total"))["total"]
    )
    return total or 0


def of_month(label):
    """« d'octobre », « d'août », mais « de mai » : élision devant une voyelle."""
    return f"d'{label}" if label[0] in "aeiouâéèêîôû" else f"de {label}"


def fcfa(amount):
    return f"{amount:,}".replace(",", " ") + " F"


class GoalSerializer(serializers.Serializer):
    amount = serializers.IntegerField(min_value=1_000, max_value=2_000_000_000)


class GoalView(ShopScopedView):
    permission_by_method = {"GET": "team.view", "PUT": "goals.manage"}

    def get(self, request, slug):
        return Response(self.payload(request))

    def put(self, request, slug):
        enforce("goal_set", str(self.shop.pk), GOAL_SET_LIMIT)
        serializer = GoalSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        amount = serializer.validated_data["amount"]
        first = timezone.localdate().replace(day=1)
        previous = ShopGoal.objects.for_shop(self.shop).filter(month=first).values_list("amount", flat=True).first()

        with transaction.atomic():
            ShopGoal.objects.update_or_create(
                shop=self.shop,
                month=first,
                defaults={
                    "amount": amount,
                    "set_by": request.user,
                    "set_by_name": full_name(request.user),
                    "set_by_role": self.membership.role,
                },
            )
            if previous != amount:
                self._announce(request, first, amount)
        record("goal_set", request, actor=request.user, shop=self.shop, month=first.strftime("%Y-%m"), previous=previous, amount=amount)
        return Response(self.payload(request))

    def payload(self, request):
        today = timezone.localdate()
        first = today.replace(day=1)
        sees_amounts = "dashboard.view" in self.permissions
        goals = {goal.month: goal for goal in ShopGoal.objects.for_shop(self.shop).filter(month__lte=first).order_by("-month")[: HISTORY_MONTHS + 1]}

        def summary(goal):
            revenue = month_revenue(self.shop, goal.month)
            return {
                "percent": round(revenue * 100 / goal.amount, 1),
                "reached": revenue >= goal.amount,
                "amount": goal.amount if sees_amounts else None,
                "revenue": revenue if sees_amounts else None,
            }

        current = goals.get(first)
        return {
            "month": first.strftime("%Y-%m"),
            "label": MONTHS[first.month - 1],
            "days_left": calendar.monthrange(today.year, today.month)[1] - today.day,
            "goal": None
            if current is None
            else {
                **summary(current),
                "set_at": current.updated_at,
                "set_by": {"name": current.set_by_name, "role": current.set_by_role, "is_you": current.set_by_id == request.user.pk},
            },
            "history": [
                {"month": month.strftime("%Y-%m"), "label": MONTHS[month.month - 1], **{k: v for k, v in summary(goal).items() if k != "revenue"}}
                for month, goal in goals.items()
                if month < first
            ][:HISTORY_MONTHS],
        }

    def _announce(self, request, first, amount):
        """Un message d'équipe par public : les gérants voient le montant, les vendeurs seulement qu'il y a un objectif."""
        label = MONTHS[first.month - 1]
        first_name = request.user.first_name or full_name(request.user)
        audiences = [
            (NoteAudience.MANAGERS, Role.MANAGER, f"Objectif {of_month(label)} : {fcfa(amount)}. Suivez la progression sur la vue d'ensemble."),
            (NoteAudience.SELLERS, Role.SELLER, f"{first_name} a fixé l'objectif {of_month(label)} pour l'équipe. Suivez la progression sur la vue d'ensemble."),
        ]
        for audience, role, body in audiences:
            recipients = list(Membership.objects.filter(shop=self.shop, role=role).exclude(user=request.user).values_list("user_id", flat=True))
            if not recipients:
                continue
            note = TeamNote.objects.create(
                shop=self.shop,
                author=request.user,
                author_name=full_name(request.user),
                author_role=self.membership.role,
                body=body,
                audience=audience,
                kind="goal",
            )
            TeamNoteReceipt.objects.bulk_create(TeamNoteReceipt(note=note, user_id=user_id) for user_id in recipients)
