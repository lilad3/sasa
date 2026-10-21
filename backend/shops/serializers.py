import re

from django.utils.text import slugify
from rest_framework import serializers

from .models import Order, OrderItem, OrderNote, OrderStatus, Product
from .storefront import plain_text


class OrderItemSerializer(serializers.ModelSerializer):
    product_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = OrderItem
        fields = ["product_id", "name", "unit_price", "quantity", "line_total"]


class OrderSerializer(serializers.ModelSerializer):
    customer = serializers.SerializerMethodField()
    items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "reference", "status", "payment_method", "customer", "items",
            "subtotal", "delivery_fee", "total", "created_at",
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
    """La fiche d'une commande : la commande, et les notes internes de l'équipe."""

    notes = OrderNoteSerializer(many=True, read_only=True)

    class Meta(OrderSerializer.Meta):
        fields = [*OrderSerializer.Meta.fields, "notes"]


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


class ProductSerializer(serializers.ModelSerializer):
    name = serializers.CharField(min_length=2, max_length=120, validators=[plain_text])
    description = serializers.CharField(max_length=2000, required=False, allow_blank=True, validators=[plain_text])
    category = serializers.CharField(max_length=40, required=False, allow_blank=True, validators=[plain_text])
    price = serializers.IntegerField(min_value=1, max_value=100_000_000)
    stock = serializers.IntegerField(min_value=0, max_value=1_000_000, required=False)
    low_stock_threshold = serializers.IntegerField(min_value=0, max_value=10_000, required=False)
    image_url = serializers.URLField(max_length=200, required=False, allow_blank=True)

    class Meta:
        model = Product
        fields = [
            "id", "slug", "sku", "name", "description", "category", "price", "stock",
            "low_stock_threshold", "is_active", "image_url", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "slug", "created_at", "updated_at"]
        extra_kwargs = {"sku": {"validators": []}}

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

    def create(self, validated_data):
        shop = self.context["shop"]
        slug = unique_slug(shop, validated_data["name"], taken=self.context.get("taken_slugs"))
        return Product.objects.create(shop=shop, slug=slug, **validated_data)
