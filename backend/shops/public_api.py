"""
API publique — /api/public/v1/ (docs/contrat-api.md §4.5), pour relier une boutique à un autre
logiciel (comptabilité, livreur, tableur). La clé désigne la boutique : pas de slug dans l'URL,
et une clé ne peut lire que la sienne. Réservée aux appels de serveur à serveur : pas de CORS.
"""

from django.urls import path
from rest_framework.exceptions import ErrorDetail, ValidationError
from rest_framework.permissions import BasePermission
from rest_framework.views import APIView

from core.exceptions import ProblemError
from core.pagination import PagePagination
from core.ratelimit import enforce

from .api_keys import ApiKeyAuthentication
from .models import Order, OrderStatus, Product
from .serializers import OrderSerializer

KEY_LIMIT = (120, 60)  # 120 requêtes par minute et par clé (§3.3)


class HasScope(BasePermission):
    def has_permission(self, request, view):
        if request.auth is None:
            raise ProblemError(401, "not_authenticated", "Clé API attendue : Authorization: Bearer akw_live_…")
        if view.required_scope not in request.auth.scopes:
            raise ProblemError(403, "scope_missing", f"Cette clé n'a pas le droit « {view.required_scope} ».")
        return True


class PublicApiView(APIView):
    authentication_classes = [ApiKeyAuthentication]
    permission_classes = [HasScope]
    throttle_classes = []
    required_scope = ""

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        enforce("public_api", request.auth.key_id, KEY_LIMIT)
        self.shop = request.auth.shop

    def paginate(self, queryset, serialize):
        paginator = PagePagination()
        page = paginator.paginate_queryset(queryset, self.request, view=self)
        return paginator.get_paginated_response([serialize(item) for item in page])


def public_product(product):
    return {
        "id": str(product.pk),
        "sku": product.sku,
        "slug": product.slug,
        "name": product.name,
        "description": product.description,
        "category": product.category,
        "price": product.price,
        "stock": product.stock,
        "status": product.status,
        "is_active": product.is_active,
        "image_url": product.image_url or None,
        "updated_at": product.updated_at,
    }


class PublicProductsView(PublicApiView):
    required_scope = "catalog:read"

    def get(self, request):
        return self.paginate(Product.objects.for_shop(self.shop).order_by("sku"), public_product)


class PublicOrdersView(PublicApiView):
    required_scope = "orders:read"

    def get(self, request):
        orders = Order.objects.for_shop(self.shop).prefetch_related("items")
        if wanted := request.query_params.get("status"):
            if wanted not in OrderStatus.values:
                raise ValidationError({"status": [ErrorDetail("Statut inconnu.", code="invalid_choice")]})
            orders = orders.filter(status=wanted)
        return self.paginate(orders, lambda order: OrderSerializer(order).data)


urlpatterns = [
    path("products", PublicProductsView.as_view()),
    path("orders", PublicOrdersView.as_view()),
]
