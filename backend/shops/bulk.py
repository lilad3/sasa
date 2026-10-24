"""
Modification en masse (docs/chantier-a2-produits.md §A2.8) : tout ou rien, dans une transaction, produits verrouillés
dans l'ordre des pk. Chaque identifiant est vérifié dans la boutique avant tout le reste, avec la même réponse
pour un identifiant inconnu et pour celui d'une autre boutique.
"""

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.response import Response

from accounts.sessions import require_reauth
from audit.actions import Category, Severity
from audit.services import record
from core.exceptions import ProblemError
from core.ratelimit import enforce

from . import plans
from . import stock as stock_ledger
from . import tags as product_tags
from .models import Product, ProductStatus, ProductTag, StockReason
from .permissions import ShopScopedView
from .storefront import plain_text

MAX_IDS = 100
MAX_REPORTED = 20
MEMBER_LIMIT = (20, 3600)
SHOP_LIMIT = (100, 86400)
PRICE_STEP = 5
MAX_PRICE = 100_000_000


class ActionSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["price", "stock", "status", "tag_add", "tag_remove"])
    mode = serializers.ChoiceField(choices=["set", "percent", "add"], required=False)
    value = serializers.IntegerField(required=False, min_value=-MAX_PRICE, max_value=MAX_PRICE)
    reason = serializers.ChoiceField(choices=list(stock_ledger.MANUAL_REASONS), required=False)
    note = serializers.CharField(max_length=200, required=False, allow_blank=True, default="", validators=[plain_text])
    status = serializers.ChoiceField(choices=ProductStatus.choices, required=False)
    label = serializers.CharField(max_length=product_tags.MAX_LABEL, required=False, validators=[plain_text])

    def validate(self, attrs):
        kind = attrs["type"]

        def need(*names):
            missing = {name: ["Champ obligatoire."] for name in names if name not in attrs}
            if missing:
                raise serializers.ValidationError(missing)

        if kind == "price":
            need("mode", "value")
            if attrs["mode"] == "set" and not 1 <= attrs["value"] <= MAX_PRICE:
                raise serializers.ValidationError({"value": ["Un prix entre 1 et 100 000 000 F."]})
            if attrs["mode"] == "percent" and (attrs["value"] == 0 or not -90 <= attrs["value"] <= 100):
                raise serializers.ValidationError({"value": ["Un pourcentage non nul, de −90 à +100."]})
            if attrs["mode"] == "add":
                raise serializers.ValidationError({"mode": ["Mode attendu : set ou percent."]})
        elif kind == "stock":
            need("mode", "value")
            if "reason" not in attrs:
                raise serializers.ValidationError({"reason": [serializers.ErrorDetail("Indiquez la raison.", code="reason_required")]})
            if attrs["mode"] == "percent":
                raise serializers.ValidationError({"mode": ["Mode attendu : add ou set."]})
            if attrs["mode"] == "add" and attrs["value"] == 0:
                raise serializers.ValidationError({"value": [serializers.ErrorDetail("Indiquez la quantité.", code="delta_required")]})
            if attrs["mode"] == "set":
                if attrs["value"] < 0 or attrs["value"] > stock_ledger.MAX_STOCK:
                    raise serializers.ValidationError({"value": ["Une quantité de 0 à 1 000 000."]})
                if attrs["reason"] != StockReason.CORRECTION:
                    raise serializers.ValidationError(
                        {"reason": [serializers.ErrorDetail("Fixer le stock est une correction.", code="reason_sign_mismatch")]}
                    )
            else:
                sign = stock_ledger.MANUAL_REASONS[attrs["reason"]]
                if (sign == "+" and attrs["value"] < 0) or (sign == "-" and attrs["value"] > 0):
                    raise serializers.ValidationError(
                        {"reason": [serializers.ErrorDetail("Cette raison ne va pas avec ce sens.", code="reason_sign_mismatch")]}
                    )
        elif kind == "status":
            need("status")
        else:
            need("label")
            if not product_tags.dedupe([attrs["label"]]):
                raise serializers.ValidationError({"label": ["Étiquette vide."]})
        return attrs


class BulkSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField(), min_length=1, max_length=MAX_IDS)
    action = ActionSerializer()

    def validate_ids(self, ids):
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Un même produit apparaît deux fois.", code="duplicate_item")
        return ids


def new_price(price, action):
    if action["mode"] == "set":
        return action["value"]
    # Prix × (100 + v) / 100, arrondi au multiple de 5 F le plus proche (demi vers le haut), 5 F au minimum.
    rounded = (price * (100 + action["value"]) + 50 * PRICE_STEP) // (100 * PRICE_STEP) * PRICE_STEP
    return max(rounded, PRICE_STEP)


class ProductBulkView(ShopScopedView):
    permission_by_method = {"POST": "products.write"}

    def post(self, request, slug):
        enforce("products_bulk:member", str(self.membership.pk), MEMBER_LIMIT)
        enforce("products_bulk:shop", str(self.shop.pk), SHOP_LIMIT)
        serializer = BulkSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids, action = serializer.validated_data["ids"], serializer.validated_data["action"]

        with transaction.atomic():
            plans.lock_shop(self.shop)
            products = list(Product.objects.for_shop(self.shop).select_for_update().filter(pk__in=ids).order_by("pk"))
            # Inconnu ou d'une autre boutique : la même réponse, sans identifiant ni nombre.
            if len(products) != len(ids):
                raise ProblemError(400, "invalid_selection", "La sélection n'est pas valide.")
            lowered = getattr(self, f"_{action['type']}")(request, products, action)
            details = {"count": len(products), "action": action["type"]}
            if action["type"] == "status":
                details["status"] = action["status"]
            if action["type"] == "stock":
                details["reason"] = action["reason"]
            if lowered:
                # Une session volée pourrait mettre 100 produits à −90 % puis commander : événement de sécurité.
                details["lowered"] = True
                record(
                    "products_bulk_updated", request, actor=request.user, shop=self.shop,
                    category=Category.SECURITY, severity=Severity.WARNING, **details,
                )
            else:
                record("products_bulk_updated", request, actor=request.user, shop=self.shop, **details)
        return Response({"count": len(products), "action": action["type"]})

    @staticmethod
    def _fail(errors):
        raise ProblemError(409, "bulk_failed", "Rien n'a été modifié : certains produits ne peuvent pas l'être.", errors=errors[:MAX_REPORTED])

    def _price(self, request, products, action):
        errors, updates = [], []
        for product in products:
            price = new_price(product.price, action)
            if price > MAX_PRICE:
                errors.append(_error(product, "validation_error", "Le nouveau prix dépasse 100 000 000 F."))
            elif product.compare_at_price is not None and product.compare_at_price <= price:
                errors.append(_error(product, "compare_at_invalid", "Le prix barré doit rester plus élevé que le prix."))
            else:
                updates.append((product, price))
        if errors:
            self._fail(errors)
        lowered = any(price < product.price for product, price in updates)
        if lowered:
            # Baisser des prix en masse exige une confirmation récente de l'identité.
            require_reauth(request)
        for product, price in updates:
            Product.objects.filter(pk=product.pk).update(price=price, updated_at=timezone.now())
        return lowered

    def _stock(self, request, products, action):
        errors = []
        for product in products:
            target = product.stock + action["value"] if action["mode"] == "add" else action["value"]
            if target < 0:
                errors.append(_error(product, "stock_below_zero", f"Il n'y en a que {product.stock}."))
            elif target > stock_ledger.MAX_STOCK:
                errors.append(_error(product, "stock_too_high", "Le stock dépasse 1 000 000."))
        if errors:
            self._fail(errors)
        for product in products:
            if action["mode"] == "add":
                stock_ledger.apply(product.pk, action["value"], action["reason"], shop=self.shop, actor=request.user, note=action["note"])
            else:
                stock_ledger.set_to(product.pk, action["value"], action["reason"], shop=self.shop, actor=request.user, note=action["note"])
        return False

    def _status(self, request, products, action):
        new = action["status"]
        moving = [p for p in products if p.status != new]
        leaving_archive = sum(1 for p in moving if p.status == ProductStatus.ARCHIVED)
        if new == ProductStatus.ARCHIVED:
            plans.ensure_archive_room(self.shop, adding=len(moving))
        elif leaving_archive:
            plans.ensure_room(self.shop, "products", adding=leaving_archive)
        for product in moving:
            changes = {"status": new, "legacy_is_active": new == ProductStatus.ACTIVE, "updated_at": timezone.now()}
            if new != ProductStatus.ACTIVE and product.is_featured:
                changes["is_featured"] = False
                record(
                    "product_featured", request, actor=request.user, shop=self.shop,
                    target=("product", product.pk, product.name), change="removed",
                )
            Product.objects.filter(pk=product.pk).update(**changes)
        return False

    def _tag_add(self, request, products, action):
        (label, key), = product_tags.dedupe([action["label"]])
        have = {}
        for tag in ProductTag.objects.for_shop(self.shop).filter(product__in=products):
            have.setdefault(tag.product_id, set()).add(tag.key)
        errors = [
            _error(product, "tags_limit", f"{product_tags.MAX_PER_PRODUCT} étiquettes au plus.")
            for product in products
            if key not in have.get(product.pk, set()) and len(have.get(product.pk, set())) >= product_tags.MAX_PER_PRODUCT
        ]
        if errors:
            self._fail(errors)
        ProductTag.objects.bulk_create(
            ProductTag(shop=self.shop, product=product, label=label, key=key) for product in products if key not in have.get(product.pk, set())
        )
        return False

    def _tag_remove(self, request, products, action):
        key = product_tags.tag_key(action["label"])
        ProductTag.objects.for_shop(self.shop).filter(product__in=products, key=key).delete()
        return False


def _error(product, code, message):
    return {"product_id": str(product.pk), "sku": product.sku, "code": code, "message": message}

