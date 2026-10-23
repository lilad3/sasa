import secrets

from django.utils.text import slugify

from .delivery import DEFAULT_ZONES, promised_hours, zone_key
from .models import MOBILE_MONEY, DeliveryZone, Membership, PaymentMethod, Role, Shop, ShopLogo, ShopPaymentMethod
from .permissions import effective_permissions


def create_shop_for_owner(user, name, plan="free"):
    base = slugify(name)[:50] or "boutique"
    slug = base
    while Shop.objects.filter(slug=slug).exists():
        slug = f"{base}-{secrets.token_hex(2)}"
    # Démo sans paiement : le plan choisi à l'inscription s'applique tout de suite.
    shop = Shop.objects.create(slug=slug, name=name, plan=plan)
    Membership.objects.create(user=user, shop=shop, role=Role.OWNER)
    seed_shop_settings(shop)
    return shop


def seed_shop_settings(shop, *, mobile_money_enabled=False):
    """
    Réglages de départ d'une boutique neuve : seul le paiement à la livraison est actif (on ne propose pas un
    Mobile Money dont le commerçant n'a pas donné le numéro), et les 15 zones de départ sont copiées.
    """
    seed_payment_methods(shop, mobile_money_enabled=mobile_money_enabled)
    seed_zones(shop)


def seed_payment_methods(shop, *, mobile_money_enabled=False):
    if ShopPaymentMethod.objects.for_shop(shop).exists():
        return
    ShopPaymentMethod.objects.bulk_create(
        ShopPaymentMethod(shop=shop, method=method, enabled=method not in MOBILE_MONEY or mobile_money_enabled)
        for method, _ in PaymentMethod.choices
    )


def seed_zones(shop):
    if DeliveryZone.objects.for_shop(shop).exists():
        return
    DeliveryZone.objects.bulk_create(
        DeliveryZone(
            shop=shop, city=zone.city, commune=zone.commune, key=zone_key(zone.city, zone.commune),
            fee=zone.fee, delay_hours=promised_hours(zone.city), position=position,
        )
        for position, zone in enumerate(DEFAULT_ZONES)
    )


def memberships_for(user):
    """Les boutiques du compte, avec le rôle et les permissions que le front utilise pour l'affichage."""
    memberships = list(Membership.objects.filter(user=user).select_related("shop").order_by("shop__name"))
    # La version du logo sert à invalider le cache des images ; l'image elle-même n'est pas chargée ici.
    logos = dict(ShopLogo.objects.filter(shop__in=[m.shop for m in memberships]).values_list("shop_id", "version"))
    return [
        {
            "slug": m.shop.slug,
            "name": m.shop.name,
            "role": m.role,
            "plan": m.shop.plan,
            # Les droits réels : ceux du rôle, plus ceux accordés à un gérant.
            "permissions": sorted(effective_permissions(m)),
            "grants": sorted(m.grants or []) if m.role == Role.MANAGER else [],
            # Le plafond de ses remises, pour régler le formulaire « Offrir une réduction » (null sans le droit).
            "discount_cap_percent": m.discount_cap_percent if m.role == Role.MANAGER else None,
            "logo_version": logos.get(m.shop_id),
        }
        for m in memberships
    ]
