"""Catalogue de l'espace marchand : produits, alertes de stock et import CSV (docs/contrat-api.md §4.3)."""

from django.db.models import F, Q
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from audit.services import record
from core.pagination import PagePagination

from . import plans
from .csv_import import import_products
from .models import Product
from .permissions import ShopScopedView
from .serializers import ProductSerializer


def product_queryset(shop, params):
    products = Product.objects.for_shop(shop)
    if query := params.get("q", "").strip()[:60]:
        products = products.filter(Q(name__icontains=query) | Q(sku__icontains=query))
    if category := params.get("category", "").strip()[:40]:
        products = products.filter(category=category)
    stock = params.get("stock", "")
    if stock == "low":
        products = products.filter(stock__gt=0, stock__lte=F("low_stock_threshold"))
    elif stock == "out":
        products = products.filter(stock=0)
    elif stock:
        raise ValidationError({"stock": [ErrorDetail("Filtre attendu : low ou out.", code="invalid_choice")]})
    return products.order_by("category", "name")


class ProductListView(ShopScopedView):
    permission_by_method = {"GET": "products.view", "POST": "products.write"}

    def get(self, request, slug):
        paginator = PagePagination()
        page = paginator.paginate_queryset(product_queryset(self.shop, request.query_params), request, view=self)
        return paginator.get_paginated_response(ProductSerializer(page, many=True).data)

    def post(self, request, slug):
        serializer = ProductSerializer(data=request.data, context={"shop": self.shop})
        serializer.is_valid(raise_exception=True)
        plans.ensure_room(self.shop, "products")
        product = serializer.save()
        return Response(ProductSerializer(product).data, status=status.HTTP_201_CREATED)


class ProductOverviewView(ShopScopedView):
    """En-tête de la page Produits : compteurs, rayons et limite du plan."""

    permission_by_method = {"GET": "products.view"}

    def get(self, request, slug):
        products = Product.objects.for_shop(self.shop)
        return Response(
            {
                "count": products.count(),
                "active": products.filter(is_active=True).count(),
                "limit": plans.spec(self.shop).products,
                "low_stock": products.filter(stock__gt=0, stock__lte=F("low_stock_threshold")).count(),
                "out_of_stock": products.filter(stock=0).count(),
                "categories": sorted(set(products.exclude(category="").values_list("category", flat=True))),
                "csv_import": plans.spec(self.shop).csv_import,
            }
        )


class ProductDetailView(ShopScopedView):
    permission_by_method = {"GET": "products.view", "PATCH": "products.write", "DELETE": "products.write"}

    def get(self, request, slug, product_id):
        return Response(ProductSerializer(self._product(product_id)).data)

    def patch(self, request, slug, product_id):
        product = self._product(product_id)
        serializer = ProductSerializer(product, data=request.data, partial=True, context={"shop": self.shop})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(ProductSerializer(product).data)

    def delete(self, request, slug, product_id):
        # Les commandes passées gardent le nom et le prix de l'article : elles ne changent pas.
        self._product(product_id).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _product(self, product_id):
        product = Product.objects.for_shop(self.shop).filter(pk=product_id).first()
        if product is None:
            raise NotFound("Produit introuvable.")
        return product


class ProductImportView(ShopScopedView):
    """Import d'un CSV exporté d'Excel. `dry_run` montre ce qui se passerait, sans rien enregistrer."""

    permission_by_method = {"POST": "products.write"}
    parser_classes = [MultiPartParser]

    def post(self, request, slug):
        plans.require_feature(self.shop, "csv_import")
        upload = request.FILES.get("file")
        if upload is None:
            raise ValidationError({"file": [ErrorDetail("Choisissez un fichier CSV.", code="required")]})
        dry_run = str(request.data.get("dry_run", "")).lower() in {"1", "true", "oui"}
        report = import_products(self.shop, upload, dry_run=dry_run)
        if not dry_run and not report["errors"]:
            record(
                "products_imported", request, actor=request.user, shop=self.shop,
                created=report["created"], updated=report["updated"],
            )
        return Response(report)
