"""Catalogue de l'espace marchand : produits, étiquettes, stock, doublons et import CSV (docs/chantier-a2-produits.md)."""

from django.db import transaction
from django.db.models import Case, F, IntegerField, Prefetch, Q, Value, When
from django.utils.dateparse import parse_datetime
from rest_framework import serializers, status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from audit.services import record
from core.exceptions import ProblemError
from core.pagination import PagePagination
from core.ratelimit import enforce

from . import plans
from . import stock as stock_ledger
from . import tags as product_tags
from .csv_import import import_products
from .models import Product, ProductPhoto, ProductStatus, ProductTag, StockMovement, StockReason
from .permissions import ShopScopedView
from .serializers import ProductSerializer
from .storefront import photo_prefetch, plain_text
from .team import full_name

DUPLICATE_LIMIT = (60, 3600)  # par membre
STOCK_ADJUST_LIMIT = (120, 3600)  # par membre
MOVEMENTS_PAGE = 50
# Tris permis ; le coût et la marge ne servent qu'au propriétaire (sinon le tri serait un oracle sur le coût).
SORTS = {
    "name": ("category", "name"), "-name": ("-category", "-name"), "price": ("price", "name"), "-price": ("-price", "name"),
    "stock": ("stock", "name"), "-stock": ("-stock", "name"), "recent": ("-created_at", "name"),
}
COST_SORTS = {"cost": ("cost", "name"), "-cost": ("-cost", "name"), "margin": ("margin_amount", "name"), "-margin": ("-margin_amount", "name")}


def product_context(view, **extra):
    """Ce que le sérialiseur a besoin de savoir de la vue : jamais du corps de la requête."""
    return {"shop": view.shop, "can_cost": "products.cost" in view.permissions, "actor": view.request.user, **extra}


def product_queryset(shop, params, can_cost=False):
    products = Product.objects.for_shop(shop)
    # Ni filtre ni tri sur le coût ou la marge pour un non-propriétaire : même un 200 vide révélerait quelque chose.
    if not can_cost and any(key.lower().startswith(("cost", "margin")) for key in params):
        raise ValidationError({"query": [ErrorDetail("Ce filtre n'existe pas.", code="invalid_choice")]})
    if query := params.get("q", "").strip()[:60]:
        products = products.filter(Q(name__icontains=query) | Q(sku__icontains=query))
    if category := params.get("category", "").strip()[:40]:
        products = products.filter(category=category)
    wanted = params.get("status", "")
    if wanted == "all":
        pass
    elif wanted in ProductStatus.values:
        products = products.filter(status=wanted)
    elif wanted:
        raise ValidationError({"status": [ErrorDetail("Statut attendu : draft, active, archived ou all.", code="invalid_choice")]})
    else:
        products = products.exclude(status=ProductStatus.ARCHIVED)
    if raw_tags := params.get("tag", "").strip()[:200]:
        keys = {product_tags.tag_key(part) for part in raw_tags.split(",") if part.strip()}
        if len(keys) > 3:
            raise ValidationError({"tag": [ErrorDetail("Trois étiquettes au plus.", code="tags_limit")]})
        for key in keys:
            products = products.filter(tags__key=key)
    stock = params.get("stock", "")
    if stock == "low":
        products = products.filter(stock__gt=0, stock__lte=F("low_stock_threshold"))
    elif stock == "out":
        products = products.filter(stock=0)
    elif stock:
        raise ValidationError({"stock": [ErrorDetail("Filtre attendu : low ou out.", code="invalid_choice")]})
    sort = params.get("sort", "name")
    if sort in COST_SORTS and can_cost:
        products = products.annotate(
            margin_amount=Case(When(cost__isnull=True, then=Value(None)), default=F("price") - F("cost"), output_field=IntegerField())
        )
        order = COST_SORTS[sort]
    elif sort in SORTS:
        order = SORTS[sort]
    else:
        raise ValidationError({"sort": [ErrorDetail("Tri inconnu.", code="invalid_choice")]})
    return products.prefetch_related(photo_prefetch(), Prefetch("tags")).order_by(*order)


class ProductListView(ShopScopedView):
    permission_by_method = {"GET": "products.view", "POST": "products.write"}

    def get(self, request, slug):
        paginator = PagePagination()
        queryset = product_queryset(self.shop, request.query_params, "products.cost" in self.permissions)
        page = paginator.paginate_queryset(queryset, request, view=self)
        return paginator.get_paginated_response(ProductSerializer(page, many=True, context=product_context(self)).data)

    def post(self, request, slug):
        serializer = ProductSerializer(data=request.data, context=product_context(self))
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            plans.lock_shop(self.shop)
            if serializer.validated_data.get("status") == ProductStatus.ARCHIVED:
                plans.ensure_archive_room(self.shop)
            else:
                plans.ensure_room(self.shop, "products")
            product = serializer.save()
        return Response(ProductSerializer(product, context=product_context(self)).data, status=status.HTTP_201_CREATED)


class ProductOverviewView(ShopScopedView):
    """En-tête de la page Produits : compteurs, rayons, étiquettes et limite du plan."""

    permission_by_method = {"GET": "products.view"}

    def get(self, request, slug):
        products = Product.objects.for_shop(self.shop)
        listed = products.exclude(status=ProductStatus.ARCHIVED)
        return Response(
            {
                "count": listed.count(),
                "active": products.filter(status=ProductStatus.ACTIVE).count(),
                "draft": products.filter(status=ProductStatus.DRAFT).count(),
                "archived": products.filter(status=ProductStatus.ARCHIVED).count(),
                "limit": plans.spec(self.shop).products,
                "low_stock": listed.filter(stock__gt=0, stock__lte=F("low_stock_threshold")).count(),
                "out_of_stock": listed.filter(stock=0).count(),
                "categories": sorted(set(products.exclude(category="").values_list("category", flat=True))),
                "tags": product_tags.popular(self.shop, limit=product_tags.OVERVIEW),
                "csv_import": plans.spec(self.shop).csv_import,
            }
        )


class ProductTagListView(ShopScopedView):
    """Suggestions d'étiquettes : les plus utilisées, filtrées par début de mot."""

    permission_by_method = {"GET": "products.view"}

    def get(self, request, slug):
        return Response(product_tags.popular(self.shop, request.query_params.get("q", "")[:30]))


class ProductDetailView(ShopScopedView):
    permission_by_method = {"GET": "products.view", "PATCH": "products.write", "DELETE": "products.write"}

    def get(self, request, slug, product_id):
        return Response(ProductSerializer(self._product(product_id), context=product_context(self)).data)

    def patch(self, request, slug, product_id):
        with transaction.atomic():
            if "status" in request.data:
                plans.lock_shop(self.shop)
            product = self._product(product_id, lock=True)
            previous = product.status
            serializer = ProductSerializer(product, data=request.data, partial=True, context=product_context(self))
            serializer.is_valid(raise_exception=True)
            new = serializer.validated_data.get("status", previous)
            if new != previous:
                if previous == ProductStatus.ARCHIVED:
                    plans.ensure_room(self.shop, "products")
                elif new == ProductStatus.ARCHIVED:
                    plans.ensure_archive_room(self.shop)
            serializer.save()
            if new != previous:
                if new != ProductStatus.ACTIVE and product.is_featured:
                    Product.objects.filter(pk=product.pk).update(is_featured=False)
                    product.is_featured = False
                    record("product_featured", request, actor=request.user, shop=self.shop, target=("product", product.pk, product.name), change="removed")
                record(
                    "product_status_changed", request, actor=request.user, shop=self.shop,
                    target=("product", product.pk, product.name), previous=previous, new=new,
                )
        return Response(ProductSerializer(product, context=product_context(self)).data)

    def delete(self, request, slug, product_id):
        with transaction.atomic():
            product = self._product(product_id, lock=True)
            # Le journal du stock est une preuve : un produit qui en a un se range (archive), il ne s'efface pas.
            if product.movements.exclude(reason=StockReason.INITIAL).exists():
                raise ProblemError(409, "product_has_history", "Ce produit a un historique de stock : archivez-le plutôt que de le supprimer.")
            # Les commandes passées gardent le nom et le prix de l'article : elles ne changent pas.
            record("product_deleted", request, actor=request.user, shop=self.shop, target=("product", product.pk, product.name))
            product.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)

    def _product(self, product_id, lock=False):
        products = Product.objects.for_shop(self.shop)
        product = (products.select_for_update() if lock else products).filter(pk=product_id).first()
        if product is None:
            raise NotFound("Produit introuvable.")
        return product


COPIED = (
    "description", "category", "price", "compare_at_price", "cost", "low_stock_threshold", "image_url", "allow_backorder",
    "backorder_days", "backorder_limit", "condition", "warranty_months", "sold_by", "one_of_a_kind", "made_to_order", "bulky",
)


def free_sku(shop, sku):
    for n in range(1, 1000):
        suffix = "-COPIE" if n == 1 else f"-COPIE-{n}"
        candidate = sku[: 40 - len(suffix)] + suffix
        if not Product.objects.for_shop(shop).filter(sku__iexact=candidate).exists():
            return candidate
    raise ProblemError(409, "conflict", "Trop de copies de ce produit.")


class ProductDuplicateView(ShopScopedView):
    """Une copie en brouillon : stock à 0 sans mouvement, ni à la une, photos et étiquettes copiées. Le coût est copié côté serveur."""

    permission_by_method = {"POST": "products.write"}

    def post(self, request, slug, product_id):
        enforce("product_duplicate:member", str(self.membership.pk), DUPLICATE_LIMIT)
        from .serializers import unique_slug

        with transaction.atomic():
            plans.lock_shop(self.shop)
            source = Product.objects.for_shop(self.shop).select_for_update().filter(pk=product_id).first()
            if source is None:
                raise NotFound("Produit introuvable.")
            plans.ensure_room(self.shop, "products")
            name = source.name if source.name.startswith("Copie de") else f"Copie de {source.name}"
            copy = Product.objects.create(
                shop=self.shop, status=ProductStatus.DRAFT, stock=0, name=name[:120], sku=free_sku(self.shop, source.sku),
                slug=unique_slug(self.shop, name), **{field: getattr(source, field) for field in COPIED},
            )
            for photo in ProductPhoto.objects.for_shop(self.shop).filter(product=source).order_by("position")[: ProductPhoto.MAX_PER_PRODUCT]:
                ProductPhoto.objects.create(
                    shop=self.shop, product=copy, position=photo.position, image=bytes(photo.image), version=photo.version, created_by=request.user
                )
            ProductTag.objects.bulk_create(
                ProductTag(shop=self.shop, product=copy, label=tag.label, key=tag.key)
                for tag in ProductTag.objects.for_shop(self.shop).filter(product=source)
            )
            record("product_duplicated", request, actor=request.user, shop=self.shop, target=("product", copy.pk, copy.name), source=source.name)
        return Response(ProductSerializer(copy, context=product_context(self)).data, status=status.HTTP_201_CREATED)


class StockAdjustSerializer(serializers.Serializer):
    """« Ajouter ou retirer » (delta + raison) ou « J'ai compté » (count). La quantité et la raison sont obligatoires."""

    delta = serializers.IntegerField(min_value=-stock_ledger.MAX_STOCK, max_value=stock_ledger.MAX_STOCK, required=False)
    count = serializers.IntegerField(min_value=0, max_value=stock_ledger.MAX_STOCK, required=False)
    reason = serializers.ChoiceField(choices=list(stock_ledger.MANUAL_REASONS), required=False)
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="", validators=[plain_text])

    def validate(self, attrs):
        has_delta, has_count = "delta" in attrs, "count" in attrs
        if has_delta and has_count:
            raise serializers.ValidationError({"delta": [ErrorDetail("Une quantité à ajouter ou une quantité comptée, pas les deux.", code="invalid_field")]})
        if not (has_delta or has_count):
            raise serializers.ValidationError({"delta": [ErrorDetail("Indiquez la quantité.", code="delta_required")]})
        if has_count:
            if attrs.setdefault("reason", StockReason.CORRECTION) != StockReason.CORRECTION:
                raise serializers.ValidationError({"reason": [ErrorDetail("Un comptage est une correction.", code="reason_sign_mismatch")]})
            return attrs
        if attrs["delta"] == 0:
            raise serializers.ValidationError({"delta": [ErrorDetail("Indiquez la quantité.", code="delta_required")]})
        if "reason" not in attrs:
            raise serializers.ValidationError({"reason": [ErrorDetail("Indiquez la raison.", code="reason_required")]})
        sign = stock_ledger.MANUAL_REASONS[attrs["reason"]]
        if (sign == "+" and attrs["delta"] < 0) or (sign == "-" and attrs["delta"] > 0):
            raise serializers.ValidationError({"reason": [ErrorDetail("Cette raison ne va pas avec ce sens.", code="reason_sign_mismatch")]})
        return attrs


def movement_payload(movement, viewer):
    return {
        "id": str(movement.pk),
        "delta": movement.delta,
        "stock_after": movement.stock_after,
        "reason": movement.reason,
        "label": movement.get_reason_display(),
        "order": {"id": str(movement.order_id), "reference": movement.order_reference} if movement.order_id else None,
        "actor": {"name": movement.actor_name, "is_you": movement.actor_id == viewer.pk} if movement.actor_name else None,
        "note": movement.note,
        "created_at": movement.created_at,
    }


class ProductStockView(ShopScopedView):
    """Ajuster le stock à la main : toujours une raison, toujours un mouvement, jamais sous zéro."""

    permission_by_method = {"POST": "products.write"}

    def post(self, request, slug, product_id):
        enforce("stock_adjust:member", str(self.membership.pk), STOCK_ADJUST_LIMIT)
        serializer = StockAdjustSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        with transaction.atomic():
            if not Product.objects.for_shop(self.shop).filter(pk=product_id).exists():
                raise NotFound("Produit introuvable.")
            if "count" in data:
                movement = stock_ledger.set_to(
                    product_id, data["count"], data["reason"], shop=self.shop, actor=request.user, note=data["note"]
                )
            else:
                movement = stock_ledger.apply(
                    product_id, data["delta"], data["reason"], shop=self.shop, actor=request.user, note=data["note"]
                )
            if movement is not None:
                product = Product.objects.for_shop(self.shop).get(pk=product_id)
                record(
                    "product_stock_adjusted", request, actor=request.user, shop=self.shop,
                    target=("product", product.pk, product.name), delta=movement.delta, reason=movement.reason,
                )
            stock = Product.objects.for_shop(self.shop).values_list("stock", flat=True).get(pk=product_id)
        body = {"movement": movement_payload(movement, request.user) if movement else None, "stock": stock}
        return Response(body, status=status.HTTP_201_CREATED if movement else status.HTTP_200_OK)


class ProductMovementsView(ShopScopedView):
    """Les 50 derniers mouvements, plus récents d'abord ; `?before=` (date ISO) pour la suite."""

    permission_by_method = {"GET": "products.view"}

    def get(self, request, slug, product_id):
        if not Product.objects.for_shop(self.shop).filter(pk=product_id).exists():
            raise NotFound("Produit introuvable.")
        movements = StockMovement.objects.for_shop(self.shop).filter(product_id=product_id)
        if raw := request.query_params.get("before"):
            before = parse_datetime(raw)
            if before is None:
                raise ValidationError({"before": [ErrorDetail("Date attendue au format ISO.", code="invalid_date")]})
            movements = movements.filter(created_at__lt=before)
        page = list(movements.order_by("-created_at", "-id")[:MOVEMENTS_PAGE])
        return Response(
            {
                "results": [movement_payload(m, request.user) for m in page],
                "next_before": page[-1].created_at if len(page) == MOVEMENTS_PAGE else None,
            }
        )


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
        report = import_products(
            self.shop, upload, dry_run=dry_run, can_cost="products.cost" in self.permissions, actor=request.user
        )
        if not dry_run and not report["errors"]:
            record(
                "products_imported", request, actor=request.user, shop=self.shop,
                created=report["created"], updated=report["updated"],
            )
        return Response(report)
