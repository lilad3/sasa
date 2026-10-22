"""
Réductions offertes par la boutique à un client (docs/chantier-p5.md §1.3 et §1.4).

Le propriétaire offre ce qu'il veut ; un gérant à qui il a confié `discounts.give` n'offre que des
remises en %, jusqu'au plafond fixé (Membership.discount_cap_percent) ; un vendeur, jamais.
Offrir demande une confirmation renforcée : avec une session volée, on distribuerait sinon des
codes à −90 %. Annuler, au contraire, protège : pas de confirmation.
"""

from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.exceptions import ErrorDetail, NotFound, PermissionDenied
from rest_framework.response import Response

from accounts.sessions import require_reauth
from audit.services import record
from core.exceptions import ProblemError
from core.ratelimit import enforce

from .discount_codes import label, new_code
from .models import Customer, Discount, DiscountKind, Role
from .permissions import ShopScopedView
from .team import full_name

CREATE_MEMBER_LIMIT = (30, 3600)  # par membre
CREATE_SHOP_LIMIT = (200, 86400)  # par boutique
MAX_VALIDITY = timedelta(days=365)
LISTED = 20
STATUS_ORDER = {"active": 0, "used": 1, "expired": 2, "revoked": 3}


class DiscountCreateSerializer(serializers.Serializer):
    kind = serializers.ChoiceField(choices=DiscountKind.choices)
    value = serializers.IntegerField(min_value=1, max_value=1_000_000)
    ends_on = serializers.DateField()
    max_uses = serializers.IntegerField(min_value=1, max_value=10, default=1)

    def validate_ends_on(self, value):
        today = timezone.localdate()
        if value < today or value > today + MAX_VALIDITY:
            raise serializers.ValidationError("Choisissez une date entre aujourd'hui et dans un an.", code="invalid_date")
        return value

    def validate(self, attrs):
        if attrs["kind"] == DiscountKind.PERCENT and attrs["value"] > 90:
            raise serializers.ValidationError({"value": [ErrorDetail("Entre 1 et 90 %.", code="out_of_range")]})
        if attrs["kind"] == DiscountKind.AMOUNT and attrs["value"] < 100:
            raise serializers.ValidationError({"value": [ErrorDetail("Au moins 100 F.", code="out_of_range")]})
        return attrs


def is_owner(membership):
    return membership.role == Role.OWNER


def discount_payload(discount, membership, permissions, today=None):
    can_give = "discounts.give" in permissions
    mine = discount.created_by_id == membership.user_id
    return {
        "id": str(discount.pk),
        # Sans le droit d'offrir, le code est masqué : on peut dire au client qu'il en a un, pas s'en servir à sa place.
        "code": discount.code if can_give else f"{discount.code[:3]}-••••",
        "kind": discount.kind,
        "value": discount.value,
        "label": label(discount.kind, discount.value),
        "ends_on": discount.ends_on,
        "max_uses": discount.max_uses,
        "uses": discount.uses,
        "status": discount.status(today),
        "created_at": discount.created_at,
        "created_by": {"name": discount.created_by_name, "is_you": mine},
        "can_revoke": can_give and discount.revoked_at is None and (is_owner(membership) or mine),
    }


def customer_discounts(customer, membership, permissions):
    """Les 20 dernières réductions du client, celles en cours d'abord."""
    today = timezone.localdate()
    discounts = list(Discount.objects.for_shop(customer.shop).filter(customer=customer).order_by("-created_at")[:LISTED])
    discounts.sort(key=lambda d: STATUS_ORDER[d.status(today)])
    return [discount_payload(d, membership, permissions, today) for d in discounts]


class CustomerDiscountView(ShopScopedView):
    permission_by_method = {"POST": "discounts.give"}

    def post(self, request, slug, customer_id):
        customer = Customer.objects.for_shop(self.shop).filter(public_id=customer_id).first()
        if customer is None:
            raise NotFound("Client introuvable.")
        serializer = DiscountCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        # Les limites du gérant passent avant la confirmation : un refus ne doit rien coûter d'autre.
        if not is_owner(self.membership):
            if data["kind"] != DiscountKind.PERCENT:
                raise ProblemError(403, "discount_kind_forbidden", "Un gérant offre des remises en % seulement.")
            cap = self.membership.discount_cap_percent or 0
            if data["value"] > cap:
                raise ProblemError(403, "discount_cap_exceeded", f"Votre plafond de remise est de {cap} %.", limit=cap)
        require_reauth(request)
        enforce("discount_create:member", str(self.membership.pk), CREATE_MEMBER_LIMIT)
        enforce("discount_create:shop", str(self.shop.pk), CREATE_SHOP_LIMIT)

        for _ in range(3):
            try:
                with transaction.atomic():
                    discount = Discount.objects.create(
                        shop=self.shop,
                        customer=customer,
                        code=new_code(self.shop, customer.name),
                        created_by=request.user,
                        created_by_name=full_name(request.user),
                        **data,
                    )
                break
            except IntegrityError:  # deux codes identiques tirés au même instant : on retire
                continue
        else:
            raise ProblemError(503, "server_busy", "Réessayez dans un instant.")

        record(
            "discount_created", request, actor=request.user, shop=self.shop, target=("discount", discount.pk, discount.code),
            kind=discount.kind, value=discount.value, max_uses=discount.max_uses, ends_on=str(discount.ends_on),
            customer=customer.name,
        )
        payload = discount_payload(discount, self.membership, self.permissions)
        # Le numéro complet, pour préparer le message WhatsApp : la carte de fidèle n'a que le numéro masqué.
        payload["customer"] = {"name": customer.name, "phone": customer.phone}
        return Response(payload, status=status.HTTP_201_CREATED)


class DiscountDetailView(ShopScopedView):
    permission_by_method = {"DELETE": "discounts.give"}

    def delete(self, request, slug, discount_id):
        discount = Discount.objects.for_shop(self.shop).filter(pk=discount_id).first()
        if discount is None:
            raise NotFound("Réduction introuvable.")
        if not is_owner(self.membership) and discount.created_by_id != request.user.pk:
            raise PermissionDenied("Vous ne pouvez annuler que les réductions que vous avez offertes.")
        if discount.revoked_at is None:
            discount.revoked_at, discount.revoked_by = timezone.now(), request.user
            discount.save(update_fields=["revoked_at", "revoked_by"])
            record(
                "discount_revoked", request, actor=request.user, shop=self.shop,
                target=("discount", discount.pk, discount.code), uses=discount.uses,
            )
        return Response(discount_payload(discount, self.membership, self.permissions))
