"""
Rôles par boutique (docs/contrat-api.md §2.8). Le front masque ce qui est interdit,
mais c'est ici que le serveur décide.
"""

from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.views import APIView

from .models import Membership, Role

MANAGER_DEFAULT = frozenset(
    {
        "dashboard.view", "orders.view", "orders.manage", "orders.export", "products.view", "products.write",
        "team.view", "notes.send", "customers.view", "customers.loyalty",
    }
)

ROLE_PERMISSIONS = {
    # Le propriétaire a tout, y compris ce qui ne se délègue jamais (plan, clés API, objectif, fidèles nommés).
    Role.OWNER: MANAGER_DEFAULT
    | frozenset(
        {
            "shop.manage", "goals.manage", "customers.vip",
            "team.manage_sellers", "team.presence", "storefront.edit", "discounts.give", "customers.export",
            # Le coût d'achat révèle la marge : propriétaire seulement, jamais délégable (absent de GRANTABLE).
            "products.cost",
        }
    ),
    Role.MANAGER: MANAGER_DEFAULT,
    # Le vendeur traite les commandes et lit les consignes, mais ne voit ni le chiffre d'affaires ni les exports.
    Role.SELLER: frozenset({"orders.view", "orders.manage", "products.view", "team.view"}),
}

# Ce que le propriétaire peut confier à un gérant, en plus de ses droits par défaut (docs/chantier-p4.md §A).
# Jamais : shop.manage (plan, réglages, clés API), goals.manage, customers.vip.
# team.manage_sellers ne vise que les vendeurs : un gérant ne nomme jamais un gérant.
# discounts.give : en % seulement, jusqu'au plafond Membership.discount_cap_percent (docs/chantier-p5.md §1.3).
GRANTABLE = frozenset({"team.manage_sellers", "team.presence", "storefront.edit", "discounts.give", "customers.export"})


def effective_permissions(membership):
    """Les droits réels d'un membre : ceux de son rôle, plus ceux qu'on lui a accordés s'il est gérant."""
    permissions = ROLE_PERMISSIONS[membership.role]
    if membership.role == Role.MANAGER:
        permissions = permissions | (set(membership.grants or ()) & GRANTABLE)
    return permissions


class ShopScopedView(APIView):
    """
    Base de toutes les routes /shops/{slug}/…

    L'appartenance est vérifiée avant tout le reste. Un non-membre reçoit 404, exactement
    comme pour une boutique inexistante : il n'apprend même pas qu'elle existe.
    """

    permission_by_method = {}

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        membership = (
            Membership.objects.select_related("shop").filter(user=request.user, shop__slug=kwargs["slug"]).first()
        )
        if membership is None:
            raise NotFound("Boutique introuvable.")
        method = "GET" if request.method == "HEAD" else request.method
        # Les droits sont relus à chaque requête : un droit retiré ne sert plus dès la suivante.
        self.permissions = effective_permissions(membership)
        if self.permission_by_method.get(method) not in self.permissions:
            raise PermissionDenied("Votre rôle dans cette boutique ne permet pas cette action.")
        self.membership = membership
        self.shop = membership.shop
