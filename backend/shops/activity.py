"""
Journal de la boutique et santé de la sécurité (docs/contrat-api.md §2.10).

Le journal d'audit de la plateforme sert aussi au propriétaire, mais seulement pour sa boutique :
qui a exporté les ventes, ajouté quelqu'un, créé une clé. Lecture seule, toujours filtré par
boutique, réservé au propriétaire. Les détails sortent par liste blanche, jamais en vrac.
"""

from collections import Counter
from datetime import timedelta

from django.utils import timezone
from rest_framework.exceptions import ErrorDetail, ValidationError
from rest_framework.response import Response

from accounts.models import TOTPDevice, User
from audit.actions import ACTIONS, Category
from audit.models import AuditEvent
from core.pagination import PagePagination

from .models import ApiKey, Membership
from .permissions import ShopScopedView
from .team import ROLE_ORDER, full_name

ACTIVITY_VISIBLE_FOR = timedelta(days=90)

# Ce que chaque événement peut montrer de ses détails : rien d'autre ne sort du journal.
DETAILS = {
    "member_added": ("role",),
    "member_role_changed": ("previous_role", "new_role"),
    "orders_exported": ("rows", "first", "last"),
    "order_status_changed": ("previous_status", "new_status"),
    "order_placed": ("total", "payment_method", "discount_amount", "channel"),
    "plan_changed": ("previous_plan", "new_plan"),
    "shop_updated": ("fields",),
    "api_key_created": ("scopes",),
    "products_imported": ("created", "updated"),
    "team_note_sent": ("audience", "urgent", "recipients"),
    "member_grants_changed": ("added", "removed", "discount_cap_percent"),
    "discount_created": ("kind", "value", "max_uses", "ends_on", "customer"),
    "discount_revoked": ("uses",),
    "goal_set": ("month", "previous", "amount"),
    "loyalty_threshold_changed": ("previous", "threshold"),
    "shop_logo_changed": ("change",),
}

# Ce qui, sur le compte d'un membre de l'équipe, peut vouloir dire qu'on essaie d'y entrer.
SUSPICIOUS = ("login_failed", "mfa_failed", "reauth_failed", "account_locked", "refresh_reuse_detected")
SUSPICIOUS_WINDOW = timedelta(days=7)
# Une clé qui ne sert plus est une porte ouverte pour rien.
DORMANT_AFTER = timedelta(days=30)
NEW_KEY_GRACE = timedelta(days=7)
EXPIRES_SOON = timedelta(days=14)


def _people(shop, user_ids):
    """Noms et rôles actuels des comptes cités dans le journal. Un rôle absent : la personne a quitté la boutique."""
    ids = {str(user_id) for user_id in user_ids if user_id}
    users = {str(user.pk): user for user in User.objects.filter(pk__in=ids)}
    roles = {str(m.user_id): m.role for m in Membership.objects.filter(shop=shop, user_id__in=ids)}
    return users, roles


def event_payload(event, users, roles, viewer):
    actor = None
    if event.actor_id:
        key = str(event.actor_id)
        user = users.get(key)
        actor = {"name": full_name(user) if user else event.actor_email, "role": roles.get(key), "is_you": event.actor_id == viewer.pk}
    target = None
    if event.target_type:
        person = users.get(event.target_id) if event.target_type == "user" else None
        target = {"type": event.target_type, "label": full_name(person) if person else event.target_label}
    return {
        "id": str(event.public_id),
        "type": event.action,
        "label": event.get_action_display(),
        "severity": event.severity,
        "created_at": event.created_at,
        "actor": actor,
        "target": target,
        "details": {key: event.metadata[key] for key in DETAILS.get(event.action, ()) if key in event.metadata},
        # L'appareil et l'IP de l'équipe, jamais ceux des clients : le marchand n'en a pas besoin.
        "device_label": event.device_label if actor else "",
        "ip": event.ip if actor else None,
    }


class ShopActivityView(ShopScopedView):
    """`?type=sensible` (par défaut) : équipe, clés, exports, robots. `?type=tout` : aussi les commandes et le catalogue."""

    permission_by_method = {"GET": "shop.manage"}

    def get(self, request, slug):
        kind = request.query_params.get("type", "sensible")
        if kind not in ("sensible", "tout"):
            raise ValidationError({"type": [ErrorDetail("Type attendu : sensible ou tout.", code="invalid_choice")]})
        events = AuditEvent.objects.filter(shop_id=self.shop.pk, created_at__gte=timezone.now() - ACTIVITY_VISIBLE_FOR)
        if kind == "sensible":
            events = events.filter(category=Category.SECURITY)

        paginator = PagePagination()
        page = paginator.paginate_queryset(events.order_by("-id"), request, view=self)
        users, roles = _people(self.shop, [e.actor_id for e in page] + [e.target_id for e in page if e.target_type == "user"])
        return paginator.get_paginated_response([event_payload(event, users, roles, request.user) for event in page])


class SecurityOverviewView(ShopScopedView):
    """
    Les faits qui disent si la boutique est bien gardée. Le front en tire ses verdicts ;
    ici, on ne fait que compter, sans jamais montrer de secret.
    """

    permission_by_method = {"GET": "shop.manage"}

    def get(self, request, slug):
        now = timezone.now()
        memberships = sorted(
            Membership.objects.filter(shop=self.shop).select_related("user"),
            key=lambda m: (ROLE_ORDER[m.role], full_name(m.user).lower()),
        )
        members = [m.user for m in memberships]
        with_mfa = set(
            TOTPDevice.objects.filter(user__in=members, confirmed_at__isnull=False).values_list("user_id", flat=True)
        )
        team = [
            {
                "user_id": str(m.user.pk),
                "name": full_name(m.user),
                "role": m.role,
                "is_you": m.user.pk == request.user.pk,
                "mfa_enabled": m.user.pk in with_mfa,
                "pending": m.user.must_change_password,
                "temporary_password_expired": bool(
                    m.user.must_change_password
                    and m.user.temporary_password_expires_at
                    and m.user.temporary_password_expires_at < now
                ),
            }
            for m in memberships
        ]

        keys = [
            key
            for key in ApiKey.objects.for_shop(self.shop).filter(revoked_at__isnull=True)
            if key.expires_at is None or key.expires_at > now
        ]
        dormant = [
            key
            for key in keys
            if (key.last_used_at is None and key.created_at < now - NEW_KEY_GRACE)
            or (key.last_used_at is not None and key.last_used_at < now - DORMANT_AFTER)
        ]
        expiring = [key for key in keys if key.expires_at is not None and key.expires_at <= now + EXPIRES_SOON]

        names = {str(m.user.pk): (full_name(m.user), m.user.pk == request.user.pk) for m in memberships}
        attempts = AuditEvent.objects.filter(
            actor_id__in=[m.user.pk for m in memberships], action__in=SUSPICIOUS, created_at__gte=now - SUSPICIOUS_WINDOW
        ).values_list("actor_id", "action", "created_at")
        counts, last_seen = Counter(), {}
        for actor_id, action, created_at in attempts:
            counts[(str(actor_id), action)] += 1
            last_seen[(str(actor_id), action)] = max(created_at, last_seen.get((str(actor_id), action), created_at))
        suspicious = [
            {
                "user_id": user_id,
                "name": names[user_id][0],
                "is_you": names[user_id][1],
                "type": action,
                "label": ACTIONS[action][2],
                "count": count,
                "last_at": last_seen[(user_id, action)],
            }
            for (user_id, action), count in counts.most_common()
        ]

        last_export = AuditEvent.objects.filter(shop_id=self.shop.pk, action="orders_exported").order_by("-id").first()
        export = None
        if last_export is not None:
            users, _ = _people(self.shop, [last_export.actor_id])
            author = users.get(str(last_export.actor_id))
            export = {
                "at": last_export.created_at,
                "by": full_name(author) if author else last_export.actor_email,
                "rows": last_export.metadata.get("rows"),
            }

        return Response(
            {
                "team": team,
                "api_keys": {
                    "active": len(keys),
                    "dormant": [{"id": str(k.pk), "name": k.name, "last_used_at": k.last_used_at, "created_at": k.created_at} for k in dormant],
                    "expiring_soon": [{"id": str(k.pk), "name": k.name, "expires_at": k.expires_at} for k in expiring],
                },
                "suspicious": suspicious,
                "last_export": export,
                "sensitive_events_7d": AuditEvent.objects.filter(
                    shop_id=self.shop.pk, category=Category.SECURITY, created_at__gte=now - timedelta(days=7)
                ).count(),
            }
        )
