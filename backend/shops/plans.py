"""
Plans simulés (pas encore de paiement). Ce sont les mêmes que sur la landing, et c'est ici,
côté serveur, que leurs limites s'appliquent : le front ne fait que les afficher.
"""

from dataclasses import asdict, dataclass

from django.db import connection
from django.utils import timezone

from core.exceptions import ProblemError

from .models import ApiKey, Membership, Order, Product, ProductStatus, Shop


@dataclass(frozen=True)
class PlanSpec:
    id: str
    name: str
    price: int  # FCFA par mois
    products: int | None  # None : sans limite
    members: int | None  # propriétaire compris
    monthly_orders: int | None  # indicatif : on ne refuse jamais la commande d'un client
    api_keys: bool
    csv_import: bool
    custom_accent: bool


PLANS = {
    "free": PlanSpec("free", "Gratuit", 0, 25, 1, 100, api_keys=False, csv_import=False, custom_accent=False),
    "pro": PlanSpec("pro", "Pro", 9900, 500, 5, 2000, api_keys=True, csv_import=True, custom_accent=True),
    "business": PlanSpec("business", "Business", 29900, None, 20, None, api_keys=True, csv_import=True, custom_accent=True),
}

FEATURE_LABELS = {
    "api_keys": "Les clés API",
    "csv_import": "L'import de produits",
    "custom_accent": "Le choix de la couleur de la vitrine",
}
RESOURCE_LABELS = {"products": "produits", "members": "personnes dans l'équipe"}


def spec(shop):
    return PLANS[shop.plan]


def require_feature(shop, feature):
    if not getattr(spec(shop), feature):
        raise ProblemError(
            403, "plan_limit_reached", f"{FEATURE_LABELS[feature]} : à partir du plan Pro.", feature=feature
        )


# Plafond technique : « archiver puis recréer » ne contourne pas le plan à l'infini.
ARCHIVE_LIMIT = 2000


def lock_shop(shop):
    """
    Verrou de la boutique, à prendre dans la transaction avant de compter puis d'ajouter : deux créations
    simultanées ne dépassent plus la limite d'une unité (SQLite verrouille déjà tout en IMMEDIATE).
    """
    if not connection.in_atomic_block:
        raise RuntimeError("Le verrou de la boutique se prend dans une transaction.")
    Shop.objects.select_for_update().filter(pk=shop.pk).first()


def ensure_archive_room(shop, adding=1):
    if Product.objects.for_shop(shop).filter(status=ProductStatus.ARCHIVED).count() + adding > ARCHIVE_LIMIT:
        raise ProblemError(409, "archive_limit", f"{ARCHIVE_LIMIT} produits archivés au plus : supprimez-en d'abord.")


def ensure_room(shop, resource, adding=1):
    """Refuse d'ajouter des produits ou des personnes au-delà de la limite du plan."""
    limit = getattr(spec(shop), resource)
    if limit is not None and count(shop, resource) + adding > limit:
        raise ProblemError(
            403,
            "plan_limit_reached",
            f"Votre plan {spec(shop).name} permet {limit} {RESOURCE_LABELS[resource]}.",
            limit=limit,
        )


def count(shop, resource):
    if resource == "products":
        # Un archivé ne compte pas : archiver libère de la place sans perdre l'historique.
        return Product.objects.for_shop(shop).exclude(status=ProductStatus.ARCHIVED).count()
    return Membership.objects.filter(shop=shop).count()


def usage(shop):
    month_start = timezone.localdate().replace(day=1)
    return {
        "products": count(shop, "products"),
        "members": count(shop, "members"),
        "orders_this_month": Order.objects.for_shop(shop).filter(created_at__date__gte=month_start).count(),
        "active_api_keys": ApiKey.objects.for_shop(shop).filter(revoked_at__isnull=True).count(),
    }


def plans_payload(shop):
    return {"current": shop.plan, "plans": [asdict(plan) for plan in PLANS.values()], "usage": usage(shop)}


def downgrade_blockers(shop, target):
    """Ce qui empêche de passer au plan `target` : on ne supprime rien à la place du marchand."""
    plan, current = PLANS[target], usage(shop)
    blockers = []
    if plan.products is not None and current["products"] > plan.products:
        blockers.append(f"{current['products']} produits pour {plan.products} autorisés")
    if plan.members is not None and current["members"] > plan.members:
        blockers.append(f"{current['members']} personnes dans l'équipe pour {plan.members} autorisées")
    if not plan.api_keys and current["active_api_keys"]:
        blockers.append("des clés API actives (révoquez-les d'abord)")
    return blockers
