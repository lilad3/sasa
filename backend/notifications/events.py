"""
Les événements qui peuvent donner lieu à un e-mail (docs/chantier-a2-notifications.md §2). Une liste fermée :
le serveur est seul juge de ce qui existe, de ce qu'une personne a le droit de recevoir et de ses défauts.
Passer un événement à `ready` se fait ici, sans migration.
"""

from dataclasses import dataclass, field

from shops.models import Role
from shops.permissions import effective_permissions


@dataclass(frozen=True)
class Event:
    id: str
    permission: str
    ready: bool
    # Les rôles qui le reçoivent tant que la personne n'a rien réglé.
    default_roles: frozenset = field(default_factory=frozenset)
    # Regroupé par la fenêtre anti-rafale (le résumé du jour a la sienne : un par jour).
    windowed: bool = True


EVENTS = {
    event.id: event
    for event in (
        Event("new_order", "orders.view", True, frozenset({Role.OWNER, Role.MANAGER})),
        Event("low_stock", "products.view", True, frozenset({Role.OWNER, Role.MANAGER})),
        Event("order_cancelled", "orders.view", True, frozenset({Role.OWNER})),
        Event("daily_summary", "orders.view", True, frozenset({Role.OWNER, Role.MANAGER}), windowed=False),
        # Réservés : ni ligne dans la page, ni accepté, ni envoyé.
        Event("payment_received", "orders.view", False),
        Event("review_to_moderate", "orders.manage", False),
        Event("abandoned_cart", "orders.view", False),
    )
}


def ready_events():
    return [event for event in EVENTS.values() if event.ready]


def default_enabled(event, role):
    return role in event.default_roles


def allowed_events(membership):
    """Les événements prêts auxquels le rôle et les droits accordés de la personne donnent accès, dans l'ordre de la page."""
    permissions = effective_permissions(membership)
    return [event for event in ready_events() if event.permission in permissions]


def includes_revenue(membership):
    """Le résumé du jour contient le chiffre d'affaires seulement pour qui peut lire le tableau de bord."""
    return "dashboard.view" in effective_permissions(membership)


def choices_for(memberships):
    """{(membership_id, event_id): bool} : les choix explicites de ces membres, en une requête."""
    from .models import NotificationPreference

    rows = NotificationPreference.objects.filter(membership__in=memberships).values_list("membership_id", "event", "enabled")
    return {(membership_id, event): enabled for membership_id, event, enabled in rows}


def is_enabled(event, membership, explicit):
    """Le choix de la personne, sinon le défaut de son rôle. `explicit` vient de choices_for()."""
    return explicit.get((membership.pk, event.id), default_enabled(event, membership.role))
