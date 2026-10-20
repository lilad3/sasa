"""
Rôles par boutique (docs/contrat-api.md §2.8). Le front masque ce qui est interdit,
mais c'est ici que le serveur décide.
"""

from rest_framework.exceptions import NotFound, PermissionDenied
from rest_framework.views import APIView

from .models import Membership, Role

ROLE_PERMISSIONS = {
    Role.OWNER: frozenset(
        {"dashboard.view", "orders.view", "orders.manage", "orders.export", "products.view", "products.write", "shop.manage"}
    ),
    Role.MANAGER: frozenset(
        {"dashboard.view", "orders.view", "orders.manage", "orders.export", "products.view", "products.write"}
    ),
    # Le vendeur traite les commandes, mais ne voit ni le chiffre d'affaires ni les exports.
    Role.SELLER: frozenset({"orders.view", "orders.manage", "products.view"}),
}


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
        if self.permission_by_method.get(method) not in ROLE_PERMISSIONS[membership.role]:
            raise PermissionDenied("Votre rôle dans cette boutique ne permet pas cette action.")
        self.membership = membership
        self.shop = membership.shop
