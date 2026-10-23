"""
Zones de livraison et retrait sur place d'une boutique (docs/chantier-a2-paiements-livraison.md §3.3 à §3.9).
Réservé au propriétaire (`shop.manage`). Toute lecture passe par `.for_shop()`, jamais par un `shop` venu du corps.
"""

from django.db import IntegrityError, transaction
from rest_framework import serializers, status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.response import Response

from audit.services import record
from core.exceptions import ProblemError
from core.ratelimit import enforce

from . import plans
from .delivery import zone_key
from .models import DeliveryZone, Order
from .payments import fold, lock_shop
from .permissions import ShopScopedView
from .storefront import plain_text

FEE_MAX, DELAY_MIN, DELAY_MAX, PREP_MAX = 100_000, 1, 240, 168
WRITE_LIMIT = (60, 3600)  # 60 écritures par heure et par membre
MAX_PATCH = 200


class BoundedInt(serializers.Field):
    """Un entier exact (ni texte, ni flottant, ni booléen) dans des bornes, avec un code d'erreur stable."""

    def __init__(self, low, high, code, message, **kwargs):
        super().__init__(**kwargs)
        self.low, self.high, self.code, self.message = low, high, code, message

    def to_internal_value(self, data):
        if isinstance(data, bool) or not isinstance(data, int) or not self.low <= data <= self.high:
            raise serializers.ValidationError(self.message, code=self.code)
        return data

    def to_representation(self, value):
        return value


def fee_field(**kwargs):
    return BoundedInt(0, FEE_MAX, "fee_out_of_range", "Frais de 0 à 100 000 F.", **kwargs)


def delay_field(**kwargs):
    return BoundedInt(DELAY_MIN, DELAY_MAX, "delay_out_of_range", "Délai de 1 à 240 h.", **kwargs)


def place_text(value):
    value = value.strip()
    if not fold(value):
        raise serializers.ValidationError("Indiquez un nom de lieu.", code="blank")
    return value


class ZoneCreateSerializer(serializers.Serializer):
    city = serializers.CharField(max_length=60, validators=[plain_text, place_text])
    commune = serializers.CharField(max_length=60, required=False, allow_blank=True, default="", validators=[plain_text])
    fee = fee_field()
    delay_hours = delay_field()
    is_active = serializers.BooleanField(required=False, default=True)


class ZoneChangeSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    fee = fee_field(required=False)
    delay_hours = delay_field(required=False)
    is_active = serializers.BooleanField(required=False)


class ZoneBatchSerializer(serializers.Serializer):
    zones = ZoneChangeSerializer(many=True, allow_empty=False, max_length=MAX_PATCH)

    def validate_zones(self, zones):
        ids = [zone["id"] for zone in zones]
        if len(ids) != len(set(ids)):
            raise serializers.ValidationError("Une zone apparaît deux fois.", code="duplicate_item")
        return zones


class ZoneOrderSerializer(serializers.Serializer):
    ids = serializers.ListField(child=serializers.UUIDField(), max_length=500)


class PickupSerializer(serializers.Serializer):
    enabled = serializers.BooleanField()
    address = serializers.CharField(max_length=200, allow_blank=True, required=False, default="", validators=[plain_text])
    hours = serializers.CharField(max_length=160, allow_blank=True, required=False, default="", validators=[plain_text])
    prep_hours = BoundedInt(1, PREP_MAX, "prep_out_of_range", "Préparation de 1 à 168 h.")


def zone_payload(zone, used):
    return {
        "id": str(zone.pk),
        "city": zone.city,
        "commune": zone.commune,
        "label": zone.label,
        "fee": zone.fee,
        "delay_hours": zone.delay_hours,
        "is_active": zone.is_active,
        "position": zone.position,
        "used": (zone.city, zone.commune) in used,
    }


def used_places(shop):
    """Les lieux déjà servis : comparaison exacte, le serveur a écrit ces textes lui-même à partir de la zone."""
    return set(Order.objects.for_shop(shop).order_by().values_list("customer_city", "customer_commune").distinct())


def pickup_payload(shop):
    return {"enabled": shop.pickup_enabled, "address": shop.pickup_address, "hours": shop.pickup_hours, "prep_hours": shop.pickup_prep_hours}


def summary(zones, shop):
    active = [zone for zone in zones if zone.is_active]
    parts = []
    if active:
        parts.append(f"{len(active)} zone{'s' if len(active) > 1 else ''}")
        parts.append("dès " + f"{min(zone.fee for zone in active):,}".replace(",", " ") + " F")
    if shop.pickup_enabled:
        parts.append("Retrait sur place")
    return " · ".join(parts) or "Aucune livraison"


def delivery_payload(shop):
    shop.refresh_from_db(fields=["pickup_enabled", "pickup_address", "pickup_hours", "pickup_prep_hours"])
    zones = list(DeliveryZone.objects.for_shop(shop))
    used = used_places(shop)
    return {
        "summary": summary(zones, shop),
        "limits": {
            "zones": plans.spec(shop).delivery_zones,
            "count": len(zones),
            "fee_max": FEE_MAX,
            "delay_min": DELAY_MIN,
            "delay_max": DELAY_MAX,
            "pickup_prep_max": PREP_MAX,
        },
        "zones": [zone_payload(zone, used) for zone in zones],
        "pickup": pickup_payload(shop),
    }


def no_option():
    return ProblemError(409, "no_fulfillment_option", "Gardez au moins une zone active ou le retrait sur place.")


def has_option(shop):
    return shop.pickup_enabled or DeliveryZone.objects.for_shop(shop).filter(is_active=True).exists()


class DeliveryWriteView(ShopScopedView):
    """Les écritures partagent une limite par membre : large pour un humain, étroite pour un script."""

    def throttle(self, request):
        enforce("delivery_write:user", str(request.user.pk), WRITE_LIMIT)

    def zone_or_404(self, zone_id):
        zone = DeliveryZone.objects.for_shop(self.shop).filter(pk=zone_id).first()
        if zone is None:
            raise NotFound("Zone introuvable.")
        return zone


class DeliveryView(ShopScopedView):
    permission_by_method = {"GET": "shop.manage"}

    def get(self, request, slug):
        return Response(delivery_payload(self.shop))


class ZoneListView(DeliveryWriteView):
    permission_by_method = {"POST": "shop.manage", "PATCH": "shop.manage"}

    def post(self, request, slug):
        self.throttle(request)
        serializer = ZoneCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        commune = data["commune"].strip()
        key = zone_key(data["city"], commune)
        try:
            with transaction.atomic():
                lock_shop(self.shop)
                plans.ensure_room(self.shop, "delivery_zones")
                if DeliveryZone.objects.for_shop(self.shop).filter(key=key).exists():
                    raise ProblemError(409, "zone_duplicate", "Cette zone existe déjà.")
                last = DeliveryZone.objects.for_shop(self.shop).order_by("-position").values_list("position", flat=True).first()
                zone = DeliveryZone.objects.create(
                    shop=self.shop,
                    city=data["city"],
                    commune=commune,
                    key=key,
                    fee=data["fee"],
                    delay_hours=data["delay_hours"],
                    is_active=data["is_active"],
                    position=0 if last is None else last + 1,
                )
        except IntegrityError:
            raise ProblemError(409, "zone_duplicate", "Cette zone existe déjà.") from None
        record(
            "delivery_settings_changed", request, actor=request.user, shop=self.shop,
            target=("delivery_zone", zone.pk, zone.label), change="zone_added", zone=zone.label, fee=zone.fee, hours=zone.delay_hours,
        )
        return Response(zone_payload(zone, set()), status=status.HTTP_201_CREATED)

    def patch(self, request, slug):
        self.throttle(request)
        raw = request.data.get("zones") if hasattr(request.data, "get") else None
        if isinstance(raw, list):
            # Ville, commune et position ne se modifient pas : on désactive et on recrée.
            errors = {
                f"zones.{index}.{field}": [ErrorDetail("Ce champ ne peut pas être modifié.", code="field_not_editable")]
                for index, item in enumerate(raw)
                if isinstance(item, dict)
                for field in item
                if field not in ("id", "fee", "delay_hours", "is_active")
            }
            if errors:
                raise ValidationError(errors)
        serializer = ZoneBatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        changes = serializer.validated_data["zones"]
        events = []
        with transaction.atomic():
            shop = lock_shop(self.shop)
            zones = {zone.pk: zone for zone in DeliveryZone.objects.for_shop(self.shop).filter(pk__in=[c["id"] for c in changes])}
            if len(zones) != len(changes):
                # Un identifiant d'une autre boutique ou inconnu : même réponse, et rien n'est appliqué.
                raise NotFound("Zone introuvable.")
            for change in changes:
                zone = zones[change["id"]]
                fields = {k: v for k, v in change.items() if k != "id" and getattr(zone, k) != v}
                if not fields:
                    continue
                details = {}
                if "fee" in fields:
                    details.update(previous_fee=zone.fee, fee=fields["fee"])
                if "delay_hours" in fields:
                    details.update(previous_hours=zone.delay_hours, hours=fields["delay_hours"])
                kind = "zone_updated"
                if "is_active" in fields:
                    kind = "zone_enabled" if fields["is_active"] else "zone_disabled"
                for key, value in fields.items():
                    setattr(zone, key, value)
                zone.save(update_fields=[*fields, "updated_at"])
                events.append((zone, kind, details))
            if events and not has_option(shop):
                raise no_option()
        for zone, kind, details in events:
            record(
                "delivery_settings_changed", request, actor=request.user, shop=self.shop,
                target=("delivery_zone", zone.pk, zone.label), change=kind, zone=zone.label, **details,
            )
        return Response(delivery_payload(self.shop))


class ZoneDetailView(DeliveryWriteView):
    permission_by_method = {"DELETE": "shop.manage"}

    def delete(self, request, slug, zone_id):
        self.throttle(request)
        with transaction.atomic():
            shop = lock_shop(self.shop)
            zone = self.zone_or_404(zone_id)
            if (zone.city, zone.commune) in used_places(self.shop):
                raise ProblemError(
                    409, "zone_in_use", "Cette zone a déjà servi. Désactivez-la plutôt : les anciennes commandes la gardent."
                )
            if zone.is_active and not shop.pickup_enabled and not DeliveryZone.objects.for_shop(self.shop).filter(is_active=True).exclude(pk=zone.pk).exists():
                raise no_option()
            label, pk = zone.label, zone.pk
            zone.delete()
            for position, other in enumerate(DeliveryZone.objects.for_shop(self.shop)):
                if other.position != position:
                    DeliveryZone.objects.filter(pk=other.pk).update(position=position)
        record("delivery_settings_changed", request, actor=request.user, shop=self.shop, target=("delivery_zone", pk, label), change="zone_deleted", zone=label)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ZoneOrderView(DeliveryWriteView):
    permission_by_method = {"PUT": "shop.manage"}

    def put(self, request, slug):
        self.throttle(request)
        serializer = ZoneOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ids = serializer.validated_data["ids"]
        with transaction.atomic():
            lock_shop(self.shop)
            existing = set(DeliveryZone.objects.for_shop(self.shop).values_list("pk", flat=True))
            if len(ids) != len(set(ids)) or set(ids) != existing:
                raise ProblemError(400, "order_mismatch", "La liste doit contenir toutes les zones de la boutique, une fois chacune.")
            for position, zone_id in enumerate(ids):
                DeliveryZone.objects.for_shop(self.shop).filter(pk=zone_id).update(position=position)
        return Response(delivery_payload(self.shop))


class PickupView(DeliveryWriteView):
    permission_by_method = {"PUT": "shop.manage"}

    def put(self, request, slug):
        self.throttle(request)
        serializer = PickupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        address, hours = data["address"].strip(), data["hours"].strip()
        if data["enabled"] and not address:
            raise ValidationError({"address": [ErrorDetail("Indiquez l'adresse de retrait.", code="pickup_address_required")]})
        with transaction.atomic():
            shop = lock_shop(self.shop)
            if not data["enabled"] and not DeliveryZone.objects.for_shop(shop).filter(is_active=True).exists():
                raise no_option()
            new = {"pickup_enabled": data["enabled"], "pickup_address": address, "pickup_hours": hours, "pickup_prep_hours": data["prep_hours"]}
            changed = {field: value for field, value in new.items() if getattr(shop, field) != value}
            if changed:
                for field, value in changed.items():
                    setattr(shop, field, value)
                shop.save(update_fields=list(changed))
        if changed:
            record("delivery_settings_changed", request, actor=request.user, shop=self.shop, change="pickup_changed", pickup_enabled=shop.pickup_enabled)
        return Response(delivery_payload(self.shop))
