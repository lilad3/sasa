"""
Présence de l'équipe (docs/chantier-p4.md §B) : qui est passé aujourd'hui, et combien de commandes il a fait avancer.
Jamais d'IP, d'appareil ni de lieu : le patron voit l'activité, pas la surveillance.
"""

from datetime import datetime, time

from django.db.models import Count, Max, Min
from django.utils import timezone
from rest_framework.response import Response

from accounts.models import UserSession
from audit.models import AuditEvent

from .models import Membership
from .permissions import ShopScopedView
from .team import ROLE_ORDER, full_name


def local_midnight():
    return datetime.combine(timezone.localdate(), time.min, tzinfo=timezone.get_current_timezone())


class TeamPresenceView(ShopScopedView):
    permission_by_method = {"GET": "team.presence"}

    def get(self, request, slug):
        midnight = local_midnight()
        memberships = list(Membership.objects.filter(shop=self.shop).select_related("user"))
        user_ids = [m.user_id for m in memberships]
        sessions = UserSession.objects.filter(user_id__in=user_ids).order_by()
        last_seen = dict(sessions.values("user_id").annotate(last=Max("last_seen_at")).values_list("user_id", "last"))
        opened_today = dict(
            sessions.filter(created_at__gte=midnight).values("user_id").annotate(first=Min("created_at")).values_list("user_id", "first")
        )
        handled = dict(
            AuditEvent.objects.filter(shop_id=self.shop.pk, action="order_status_changed", actor_id__in=user_ids, created_at__gte=midnight)
            .order_by()
            .values("actor_id")
            .annotate(n=Count("id"))
            .values_list("actor_id", "n")
        )

        people = []
        for m in sorted(memberships, key=lambda m: (ROLE_ORDER[m.role], full_name(m.user).lower())):
            last = last_seen.get(m.user_id)
            status = "never" if last is None else "today" if last >= midnight else "absent"
            people.append(
                {
                    "user_id": str(m.user_id),
                    "name": full_name(m.user),
                    "role": m.role,
                    "is_you": m.user_id == request.user.pk,
                    "status": status,
                    "last_seen_at": last,
                    # Une session ouverte avant minuit et reprise aujourd'hui : on ne connaît que son dernier passage.
                    "first_seen_today": opened_today.get(m.user_id) or (last if status == "today" else None),
                    "handled_today": handled.get(m.user_id, 0),
                }
            )
        return Response(people)
