import secrets

from django.utils.text import slugify

from .models import Membership, Role, Shop
from .permissions import ROLE_PERMISSIONS


def create_shop_for_owner(user, name):
    base = slugify(name)[:50] or "boutique"
    slug = base
    while Shop.objects.filter(slug=slug).exists():
        slug = f"{base}-{secrets.token_hex(2)}"
    shop = Shop.objects.create(slug=slug, name=name)
    Membership.objects.create(user=user, shop=shop, role=Role.OWNER)
    return shop


def memberships_for(user):
    """Les boutiques du compte, avec le rôle et les permissions que le front utilise pour l'affichage."""
    memberships = Membership.objects.filter(user=user).select_related("shop").order_by("shop__name")
    return [
        {
            "slug": m.shop.slug,
            "name": m.shop.name,
            "role": m.role,
            "plan": m.shop.plan,
            "permissions": sorted(ROLE_PERMISSIONS[m.role]),
        }
        for m in memberships
    ]
