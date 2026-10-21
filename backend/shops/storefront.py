"""
Boutique publique — /api/v1/storefront/{slug}/ (docs/contrat-api.md §4.4).

Aucun compte : n'importe quel visiteur peut voir la vitrine et commander. Les appels passent
quand même par le BFF Next (secret partagé), qui transmet l'IP réelle pour la limitation.
"""

import re
import uuid

from rest_framework import serializers, status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import record
from core.exceptions import ProblemError
from core.ratelimit import enforce

from .checkout import fake_response, place_order
from .delivery import ZONES, find_zone
from .models import Order, PaymentMethod, Product, Shop

ORDER_LIMIT = (10, 3600)  # 10 commandes par heure et par IP (§3.3)
# Suivi de commande : 4 chiffres de téléphone, c'est 10 000 possibilités. La limite par
# référence rend l'essai systématique impossible, celle par IP freine le balayage des références.
TRACK_IP_LIMIT = (20, 3600)
TRACK_ORDER_LIMIT = (5, 3600)
MAX_QUANTITY = 99
REFERENCE_CHARS = re.compile(r"[^A-Za-z0-9]")

# Mobiles 01, 05, 07 et fixes 21, 25, 27, suivis de 8 chiffres (§2.13).
PHONE = re.compile(r"^(01|05|07|21|25|27)\d{8}$")
HTML_OR_CONTROL = re.compile(r"[<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def plain_text(value):
    """Texte brut uniquement : un nom ou un repère ne contient ni balise ni caractère de contrôle."""
    if HTML_OR_CONTROL.search(value):
        raise serializers.ValidationError("Les caractères < et > ne sont pas acceptés.", code="invalid_characters")
    return value


def normalize_phone(raw):
    digits = re.sub(r"[\s.\-()]", "", raw)
    if digits.startswith("+225"):
        digits = digits[4:]
    elif digits.startswith("00225"):
        digits = digits[5:]
    if not PHONE.match(digits):
        raise serializers.ValidationError(
            "Numéro ivoirien à 10 chiffres attendu, par exemple 07 07 12 34 56.", code="invalid_phone"
        )
    return f"+225{digits}"


class CustomerSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=120, validators=[plain_text])
    phone = serializers.CharField(max_length=24)
    city = serializers.CharField(max_length=60)
    commune = serializers.CharField(max_length=60, required=False, allow_blank=True, default="")
    landmark = serializers.CharField(max_length=160, required=False, allow_blank=True, default="", validators=[plain_text])

    def validate_phone(self, value):
        return normalize_phone(value)

    def validate(self, attrs):
        if find_zone(attrs["city"], attrs["commune"]) is None:
            raise serializers.ValidationError(
                {"city": [ErrorDetail("Nous ne livrons pas encore cette zone.", code="delivery_unavailable")]}
            )
        return attrs


class ItemSerializer(serializers.Serializer):
    product_id = serializers.UUIDField()
    quantity = serializers.IntegerField(min_value=1, max_value=MAX_QUANTITY)


class CheckoutSerializer(serializers.Serializer):
    items = ItemSerializer(many=True, allow_empty=False, max_length=30)
    customer = CustomerSerializer()
    payment_method = serializers.ChoiceField(choices=PaymentMethod.choices)
    expected_total = serializers.IntegerField(min_value=0, required=False)
    # Champ piège : invisible pour un humain, un robot le remplit.
    website = serializers.CharField(required=False, allow_blank=True, default="", max_length=200)

    def validate_items(self, items):
        ids = [item["product_id"] for item in items]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Un même article apparaît deux fois.", code="duplicate_item")
        return items


def storefront_shop(slug):
    shop = Shop.objects.filter(slug=slug).first()
    if shop is None:
        raise NotFound("Boutique introuvable.")
    return shop


def public_product(product):
    return {
        "id": str(product.pk),
        "slug": product.slug,
        "name": product.name,
        "description": product.description,
        "category": product.category,
        "price": product.price,
        "image_url": product.image_url or None,
        # Pas le stock exact : seulement ce qui sert à l'acheteur.
        "in_stock": product.stock > 0,
        "low_stock": 0 < product.stock <= product.low_stock_threshold,
        "max_quantity": min(product.stock, MAX_QUANTITY),
    }


class StorefrontView(APIView):
    """Les vues publiques n'acceptent aucun token : un visiteur connecté ou non voit la même vitrine."""

    authentication_classes = []
    permission_classes = [AllowAny]


class StorefrontDetailView(StorefrontView):
    def get(self, request, slug):
        shop = storefront_shop(slug)
        return Response(
            {
                "slug": shop.slug,
                "name": shop.name,
                "description": shop.description,
                "city": shop.city,
                "accent": shop.accent,
                "currency": "XOF",
                "vacation": {
                    "active": shop.on_vacation(),
                    "message": shop.vacation_message if shop.on_vacation() else "",
                    "until": shop.vacation_until if shop.on_vacation() else None,
                },
                "product_count": Product.objects.for_shop(shop).filter(is_active=True).count(),
                "delivery_zones": [
                    {"id": zone.id, "city": zone.city, "commune": zone.commune, "label": zone.label, "fee": zone.fee}
                    for zone in ZONES
                ],
                "payment_methods": [{"id": value, "label": label} for value, label in PaymentMethod.choices],
            }
        )


class StorefrontProductListView(StorefrontView):
    def get(self, request, slug):
        shop = storefront_shop(slug)
        products = Product.objects.for_shop(shop).filter(is_active=True).order_by("category", "name")
        return Response([public_product(product) for product in products])


class StorefrontProductDetailView(StorefrontView):
    def get(self, request, slug, product_slug):
        shop = storefront_shop(slug)
        product = Product.objects.for_shop(shop).filter(slug=product_slug, is_active=True).first()
        if product is None:
            raise NotFound("Article introuvable.")
        return Response(public_product(product))


class StorefrontOrderView(StorefrontView):
    def post(self, request, slug):
        enforce("storefront_order", request.client_ip or "-", ORDER_LIMIT)
        shop = storefront_shop(slug)
        if shop.on_vacation():
            raise ProblemError(409, "shop_on_vacation", "La boutique est en congé : elle ne prend pas de commande pour le moment.")
        key = _idempotency_key(request)

        serializer = CheckoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        if data["website"]:
            # 201 comme une vraie commande : le robot ne sait pas qu'il a été repéré.
            record("checkout_bot_blocked", request, shop=shop)
            return Response(fake_response(data), status=status.HTTP_201_CREATED)

        response, order = place_order(shop, _canonical(data), key)
        if order is not None:
            record(
                "order_placed",
                request,
                shop=shop,
                target=("order", order.pk, order.reference),
                total=order.total,
                payment_method=order.payment_method,
            )
        return Response(response, status=status.HTTP_201_CREATED)


class TrackSerializer(serializers.Serializer):
    reference = serializers.CharField(max_length=12)
    phone_last4 = serializers.RegexField(r"^\d{4}$", error_messages={"invalid": "Les 4 derniers chiffres du numéro."})

    def validate_reference(self, value):
        chars = REFERENCE_CHARS.sub("", value).upper()
        if len(chars) != 6:
            raise serializers.ValidationError("Référence à 6 caractères attendue, par exemple K7F-92Q.", code="invalid_reference")
        return f"{chars[:3]}-{chars[3:]}"


class StorefrontTrackView(StorefrontView):
    """
    Le client suit sa commande avec sa référence et les 4 derniers chiffres de son téléphone.
    Il ne voit que l'état de la commande : ni son adresse, ni son numéro, ni ceux d'un autre.
    """

    def post(self, request, slug):
        enforce("track_order:ip", request.client_ip or "-", TRACK_IP_LIMIT)
        shop = storefront_shop(slug)
        serializer = TrackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        reference = serializer.validated_data["reference"]
        enforce("track_order:ref", f"{shop.pk}:{reference}", TRACK_ORDER_LIMIT)

        order = Order.objects.for_shop(shop).filter(reference=reference).prefetch_related("items").first()
        # Même réponse pour une référence inconnue et un numéro qui ne correspond pas.
        if order is None or not order.customer_phone.endswith(serializer.validated_data["phone_last4"]):
            raise NotFound("Aucune commande ne correspond à cette référence et à ce numéro.")
        return Response(
            {
                "reference": order.reference,
                "status": order.status,
                "created_at": order.created_at,
                "updated_at": order.updated_at,
                "total": order.total,
                "payment_method": order.payment_method,
                "items": [{"name": item.name, "quantity": item.quantity} for item in order.items.all()],
                "delivery": {"city": order.customer_city, "commune": order.customer_commune},
            }
        )


def _idempotency_key(request):
    raw = request.headers.get("Idempotency-Key", "")
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise ValidationError(
            {"Idempotency-Key": [ErrorDetail("En-tête Idempotency-Key (UUID) obligatoire.", code="idempotency_key_required")]}
        ) from None


def _canonical(data):
    """Données validées, en types simples : c'est ce contenu que l'empreinte d'idempotence compare."""
    return {
        "items": [{"product_id": str(item["product_id"]), "quantity": item["quantity"]} for item in data["items"]],
        "customer": dict(data["customer"]),
        "payment_method": data["payment_method"],
        "expected_total": data.get("expected_total"),
    }
