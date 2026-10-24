"""Qui reçoit un événement (contrat §3.2), recalculé à chaque envoi sur les droits du moment."""

from dataclasses import dataclass

from shops.models import Membership
from shops.permissions import effective_permissions

from .events import choices_for, is_enabled

MAX_RECIPIENTS = 20  # le plan Business plafonne à 20 personnes


@dataclass(frozen=True)
class Recipient:
    membership: Membership
    permissions: frozenset

    @property
    def user(self):
        return self.membership.user

    @property
    def is_owner(self):
        return self.membership.role == "owner"


def recipients(shop, event):
    """
    Les membres de la boutique qui doivent recevoir `event` : compte actif, ni démo, mot de passe déjà choisi,
    droit requis, événement activé. Deux requêtes, 20 personnes au plus.
    """
    memberships = list(
        Membership.objects.filter(shop=shop, user__is_active=True, user__is_demo=False, user__must_change_password=False)
        .select_related("user")
        .order_by("created_at", "pk")
    )
    explicit = choices_for(memberships)
    found = []
    for membership in memberships:
        permissions = effective_permissions(membership)
        if event.permission in permissions and is_enabled(event, membership, explicit):
            found.append(Recipient(membership, frozenset(permissions)))
    return found[:MAX_RECIPIENTS]
