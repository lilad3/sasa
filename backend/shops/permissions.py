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


# Garde d'une route de lecture ouverte à tout membre de la boutique (le non-membre reçoit toujours 404). Ce n'est PAS un droit :
# il n'est dans aucun ensemble, ne sort jamais de effective_permissions() ni de /me/shops, et seules des routes GET s'en servent
# (un test échoue si une méthode d'écriture l'utilise). Les routes concernées filtrent elles-mêmes ce qu'elles montrent.
ANY_MEMBER = "__member__"

# L'ordre et les groupes de la page « Qui peut faire quoi ». Un droit absent d'ici sort quand même, à la fin.
PERMISSION_ORDER = (
    "orders.view", "orders.manage", "orders.export",
    "products.view", "products.write",
    "customers.view", "customers.loyalty", "customers.vip", "customers.export",
    "team.view", "team.manage_sellers", "team.presence", "notes.send",
    "dashboard.view", "storefront.edit", "discounts.give", "goals.manage", "shop.manage",
)


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
        required = self.permission_by_method.get(method)
        if required != ANY_MEMBER and required not in self.permissions:
            raise PermissionDenied("Votre rôle dans cette boutique ne permet pas cette action.")
        self.membership = membership
        self.shop = membership.shop


def permissions_matrix(membership):
    """
    Les règles de chaque rôle et la situation de la personne qui lit (docs/chantier-a2-parametres.md §4.2). Tout vient de
    ROLE_PERMISSIONS et GRANTABLE : un droit ajouté là apparaît ici sans autre changement. Ni les droits accordés aux autres,
    ni les plafonds de remise, ni aucun nom.
    """
    known = set(GRANTABLE).union(*ROLE_PERMISSIONS.values())
    codes = [code for code in PERMISSION_ORDER if code in known] + sorted(known - set(PERMISSION_ORDER))
    mine = effective_permissions(membership)
    return {
        "roles": [Role.OWNER, Role.MANAGER, Role.SELLER],
        "you": {"role": membership.role},
        "permissions": [
            {
                "code": code,
                "owner": code in ROLE_PERMISSIONS[Role.OWNER],
                "manager": code in ROLE_PERMISSIONS[Role.MANAGER],
                "seller": code in ROLE_PERMISSIONS[Role.SELLER],
                "grantable": code in GRANTABLE,
                "yours": code in mine,
            }
            for code in codes
        ],
    }
