import re

from django.utils.text import slugify
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail, PermissionDenied

from . import stock as stock_ledger
from . import tags as product_tags
from .delivery import promised_hours
from .models import Condition, Order, OrderItem, OrderNote, OrderStatus, Product, ProductStatus, SoldBy, StockReason
from .storefront import photos_payload, plain_text


class OrderItemSerializer(serializers.ModelSerializer):
    product_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = OrderItem
        fields = ["product_id", "name", "unit_price", "quantity", "line_total", "from_stock", "backorder_days"]


class OrderSerializer(serializers.ModelSerializer):
    customer = serializers.SerializerMethodField()
    items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "reference", "status", "payment_method", "customer", "items",
            "subtotal", "discount_code", "discount_amount", "delivery_fee", "total", "channel", "created_at",
        ]

    def get_customer(self, order):
        return {
            "name": order.customer_name,
            "phone": order.customer_phone,
            "city": order.customer_city,
            "commune": order.customer_commune,
            "landmark": order.customer_landmark,
        }


class OrderStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=OrderStatus.choices)


class OrderNoteSerializer(serializers.ModelSerializer):
    body = serializers.CharField(min_length=2, max_length=500)

    class Meta:
        model = OrderNote
        fields = ["id", "author_name", "body", "created_at"]
        read_only_fields = ["id", "author_name", "created_at"]


class OrderDetailSerializer(OrderSerializer):
    """La fiche d'une commande : la commande, ses horaires, et les notes internes de l'équipe."""

    notes = OrderNoteSerializer(many=True, read_only=True)
    promised_hours = serializers.SerializerMethodField()
    delivery_hours = serializers.SerializerMethodField()

    class Meta(OrderSerializer.Meta):
        fields = [
            *OrderSerializer.Meta.fields, "confirmed_at", "shipped_at", "delivered_at", "promised_hours", "delivery_hours", "notes",
        ]

    def get_promised_hours(self, order):
        return promised_hours(order.customer_city, order.customer_commune)

    def get_delivery_hours(self, order):
        """De la commande à la livraison, en heures arrondies au dixième (null tant qu'elle n'est pas livrée)."""
        if order.delivered_at is None:
            return None
        return round((order.delivered_at - order.created_at).total_seconds() / 3600, 1)


SKU = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$")


def unique_slug(shop, name, taken=None):
    """Slug libre dans la boutique ; `taken` réserve les slugs d'un import en cours."""
    base = slugify(name)[:70] or "produit"
    existing = Product.objects.for_shop(shop)
    used = set(existing.filter(slug__startswith=base).values_list("slug", flat=True)) | (taken or set())
    slug, n = base, 2
    while slug in used:
        slug, n = f"{base}-{n}", n + 1
    if taken is not None:
        taken.add(slug)
    return slug


def margin(product):
    """(marge en F, marge en %) ; (None, None) sans coût. Le prix barré n'y entre pas. Arrondi à l'entier le plus proche, demi vers le haut."""
    if product.cost is None:
        return None, None
    amount = product.price - product.cost
    return amount, (amount * 200 + product.price) // (product.price * 2)


class TagsField(serializers.ListField):
    child = serializers.CharField(max_length=product_tags.MAX_LABEL, validators=[plain_text])

    def get_attribute(self, instance):
        labels = self.context.get("tag_labels")
        if labels is None:
            labels = self.context["tag_labels"] = product_tags.display_labels(instance.shop)
        return product_tags.labels_of(instance, labels)


class ProductSerializer(serializers.ModelSerializer):
    """
    Le contexte décide de ce qui sort : `can_cost` (droit products.cost, venu de la vue, jamais du corps de la requête)
    garde le coût et la marge ; sans lui, ces clés sont absentes de la réponse, pas nulles.
    """

    name = serializers.CharField(min_length=2, max_length=120, validators=[plain_text])
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True, validators=[plain_text])
    category = serializers.CharField(max_length=40, required=False, allow_blank=True, validators=[plain_text])
    price = serializers.IntegerField(min_value=1, max_value=100_000_000)
    compare_at_price = serializers.IntegerField(min_value=2, max_value=100_000_000, required=False, allow_null=True)
    cost = serializers.IntegerField(min_value=0, max_value=100_000_000, required=False, allow_null=True)
    margin_amount = serializers.SerializerMethodField()
    margin_percent = serializers.SerializerMethodField()
    stock = serializers.IntegerField(min_value=0, max_value=1_000_000, required=False)
    low_stock_threshold = serializers.IntegerField(min_value=0, max_value=10_000, required=False)
    status = serializers.ChoiceField(choices=ProductStatus.choices, required=False)
    is_active = serializers.BooleanField(read_only=True)
    backorder_days = serializers.IntegerField(min_value=1, max_value=60, required=False, allow_null=True)
    backorder_limit = serializers.IntegerField(min_value=1, max_value=10_000, required=False)
    condition = serializers.ChoiceField(choices=Condition.choices, required=False, allow_blank=True)
    warranty_months = serializers.IntegerField(min_value=1, max_value=60, required=False, allow_null=True)
    sold_by = serializers.ChoiceField(choices=SoldBy.choices, required=False)
    tags = TagsField(required=False)
    image_url = serializers.URLField(max_length=200, required=False, allow_blank=True)
    photos = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = [
            "id", "slug", "sku", "name", "description", "category", "price", "compare_at_price", "cost", "margin_amount",
            "margin_percent", "stock", "low_stock_threshold", "status", "is_active", "allow_backorder", "backorder_days",
            "backorder_limit", "image_url", "is_featured", "tags", "condition", "warranty_months", "sold_by", "one_of_a_kind",
            "made_to_order", "bulky", "photos", "created_at", "updated_at",
        ]
        # La une se change par sa propre route (storefront.edit), jamais par la fiche.
        read_only_fields = ["id", "slug", "is_featured", "created_at", "updated_at"]
        extra_kwargs = {"sku": {"validators": []}}

    def get_photos(self, product):
        return photos_payload(product)

    def get_margin_amount(self, product):
        return margin(product)[0]

    def get_margin_percent(self, product):
        return margin(product)[1]

    def to_representation(self, instance):
        data = super().to_representation(instance)
        if not self.context.get("can_cost"):
            for key in ("cost", "margin_amount", "margin_percent"):
                data.pop(key, None)
        return data

    def validate_sku(self, value):
        value = value.strip()
        if not SKU.match(value):
            raise serializers.ValidationError("Lettres, chiffres, point, tiret ou soulignement (40 au plus).", code="invalid_sku")
        taken = Product.objects.for_shop(self.context["shop"]).filter(sku__iexact=value)
        if self.instance is not None:
            taken = taken.exclude(pk=self.instance.pk)
        if taken.exists():
            raise serializers.ValidationError("Une autre fiche utilise déjà cette référence.", code="sku_taken")
        return value

    def validate_image_url(self, value):
        # Seulement des images en https : ni http (contenu mixte), ni javascript:, ni data:.
        if value and not value.lower().startswith("https://"):
            raise serializers.ValidationError("Adresse d'image en https:// attendue.", code="invalid_image_url")
        return value

    def validate_tags(self, labels):
        wanted = product_tags.dedupe(labels)
        if len(labels) > 4 * product_tags.MAX_PER_PRODUCT or len(wanted) > product_tags.MAX_PER_PRODUCT:
            raise serializers.ValidationError(
                f"{product_tags.MAX_PER_PRODUCT} étiquettes au plus par produit.", code="tags_limit"
            )
        return [label for label, _ in wanted]

    def validate(self, attrs):
        given = self.initial_data
        if "cost" in given and not self.context.get("can_cost"):
            # Jamais ignoré en silence : le coût est réservé au propriétaire.
            raise PermissionDenied("Le coût d'achat est réservé au propriétaire.")
        if "is_active" in given:
            raise serializers.ValidationError({"is_active": [ErrorDetail("Utilisez « status » : brouillon, actif ou archivé.", code="invalid_field")]})
        if self.instance is not None and "stock" in attrs and not self.context.get("stock_writable"):
            raise serializers.ValidationError(
                {"stock": [ErrorDetail("Le stock s'ajuste avec une raison : utilisez « Ajuster le stock ».", code="stock_use_adjust")]}
            )

        def value(name, default=None):
            if name in attrs:
                return attrs[name]
            return getattr(self.instance, name) if self.instance is not None else default

        errors = {}
        compare_at = value("compare_at_price")
        if compare_at is not None and compare_at <= value("price"):
            errors["compare_at_price"] = [ErrorDetail("Le prix barré doit être plus élevé que le prix.", code="compare_at_invalid")]
        if value("allow_backorder", False):
            if value("backorder_days") is None:
                errors["backorder_days"] = [ErrorDetail("Indiquez sous combien de jours le produit est disponible.", code="backorder_days_required")]
        else:
            attrs["backorder_days"] = None
        if value("made_to_order", False) and not (value("allow_backorder", False) and value("backorder_days") is not None):
            errors["made_to_order"] = [
                ErrorDetail("« Fabriqué sur commande » demande la précommande et un délai.", code="made_to_order_needs_delay")
            ]
        if errors:
            raise serializers.ValidationError(errors)
        return attrs

    def create(self, validated_data):
        shop = self.context["shop"]
        tags = validated_data.pop("tags", None)
        opening_stock = validated_data.pop("stock", 0)
        slug = unique_slug(shop, validated_data["name"], taken=self.context.get("taken_slugs"))
        product = Product.objects.create(shop=shop, slug=slug, stock=0, **validated_data)
        if opening_stock:
            stock_ledger.apply(
                product.pk, opening_stock, self.context.get("stock_reason", StockReason.INITIAL), shop=shop, actor=self.context.get("actor")
            )
            product.refresh_from_db(fields=["stock"])
        if tags:
            product_tags.replace_tags(product, tags)
        return product

    def update(self, instance, validated_data):
        tags = validated_data.pop("tags", None)
        validated_data.pop("stock", None)
        for name, value in validated_data.items():
            setattr(instance, name, value)
        # Seuls les champs changés sont écrits : une vente simultanée n'est jamais écrasée par un stock lu plus tôt.
        instance.save(update_fields=[*validated_data, "updated_at"])
        if tags is not None:
            product_tags.replace_tags(instance, tags)
            if hasattr(instance, "_prefetched_objects_cache"):
                instance._prefetched_objects_cache.pop("tags", None)
        return instance
