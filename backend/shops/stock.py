"""
Le seul endroit qui écrit `Product.stock` (docs/chantier-a2-produits.md §A2.7).

Chaque variation a son mouvement, dans la même transaction : pour tout produit, stock == somme des delta.
Un test de garde échoue si une autre source du projet écrit le stock.
"""

from django.db import connection
from django.db.models import F, Sum
from django.utils import timezone

from core.exceptions import ProblemError

from .models import OrderStatus, Product, ProductStatus, StockMovement, StockReason

MAX_STOCK = 1_000_000

# Les raisons de la route marchande et leur signe : « + » entrée, « - » sortie, « ± » les deux.
MANUAL_REASONS = {
    StockReason.RECEIVED: "+",
    StockReason.RETURNED: "+",
    StockReason.DAMAGED: "-",
    StockReason.CORRECTION: "±",
}


class StockError(ProblemError):
    """Codes : stock_below_zero (409), stock_too_high (409), product_unavailable (400)."""


def _require_transaction():
    if not connection.in_atomic_block:
        raise RuntimeError("Le stock ne se modifie que dans une transaction.")


def lock_product(product_id, shop):
    """La ligne produit, verrouillée jusqu'à la fin de la transaction (SQLite verrouille déjà tout en IMMEDIATE)."""
    _require_transaction()
    return Product.objects.for_shop(shop).select_for_update().filter(pk=product_id).first()


def apply(product_id, delta, reason, *, shop, actor=None, order=None, note="", require_active=False):
    """Ajoute `delta` au stock et écrit le mouvement. Mise à jour conditionnelle : jamais sous zéro, jamais au-delà du plafond."""
    _require_transaction()
    if delta == 0:
        raise ValueError("Un mouvement de stock n'est jamais nul.")
    if lock_product(product_id, shop) is None:
        raise StockError(400, "product_unavailable", "Cet article n'est plus en vente.")
    rows = Product.objects.for_shop(shop).filter(pk=product_id)
    if require_active:
        rows = rows.filter(status=ProductStatus.ACTIVE)
    if delta < 0:
        rows = rows.filter(stock__gte=-delta)
    elif reason != StockReason.CANCELLED:
        # Une annulation ignore le plafond : elle ne peut pas échouer.
        rows = rows.filter(stock__lte=MAX_STOCK - delta)
    if rows.update(stock=F("stock") + delta) != 1:
        current = Product.objects.for_shop(shop).filter(pk=product_id).values_list("stock", "status").first()
        if current is None or (require_active and current[1] != ProductStatus.ACTIVE):
            raise StockError(400, "product_unavailable", "Cet article n'est plus en vente.")
        if delta < 0:
            raise StockError(409, "stock_below_zero", f"Il n'y en a que {current[0]}.", available=current[0])
        raise StockError(409, "stock_too_high", f"Le stock ne peut pas dépasser {MAX_STOCK:,}.".replace(",", " "), available=current[0])
    stock_after = Product.objects.for_shop(shop).filter(pk=product_id).values_list("stock", flat=True).get()
    return StockMovement.objects.create(
        shop=shop,
        product_id=product_id,
        delta=delta,
        stock_after=stock_after,
        reason=reason,
        order=order,
        order_reference=order.reference if order else "",
        actor=actor,
        actor_name=_name(actor),
        note=note,
        created_at=timezone.now(),
    )


def set_to(product_id, count, reason, *, shop, actor=None, note=""):
    """Fixe le stock à `count` (« j'ai compté 12 ») : le delta se calcule sous le même verrou. Rien si rien ne change."""
    product = lock_product(product_id, shop)
    if product is None:
        raise StockError(400, "product_unavailable", "Cet article n'est plus en vente.")
    if count < 0:
        raise StockError(409, "stock_below_zero", "Le stock ne peut pas descendre sous zéro.", available=product.stock)
    delta = count - product.stock
    if delta == 0:
        return None
    return apply(product_id, delta, reason, shop=shop, actor=actor, note=note)


def sell(product_id, quantity, *, shop, order):
    """
    Prélève une ligne de commande sous verrou de ligne. Renvoie (part prélevée, délai de précommande promis).
    Sans l'option, tout doit venir du stock ; avec, le reste est de la précommande, dans la limite du plafond.
    """
    product = lock_product(product_id, shop)
    if product is None or product.status != ProductStatus.ACTIVE:
        raise StockError(400, "product_unavailable", "Cet article n'est plus en vente.")
    if product.one_of_a_kind and quantity > 1:
        raise StockError(409, "out_of_stock", "Il n'en reste qu'un.", available=1)
    taken = min(product.stock, quantity)
    waiting = quantity - taken
    if waiting and not product.allow_backorder:
        raise StockError(
            409, "out_of_stock", f"Il en reste {product.stock}." if product.stock else "Épuisé.", available=product.stock
        )
    if waiting:
        pending = pending_backorder(product)
        if pending + waiting > product.backorder_limit:
            room = max(product.backorder_limit - pending, 0)
            raise StockError(409, "out_of_stock", "Plus de précommande possible pour cet article.", available=product.stock + room)
    if taken:
        apply(product_id, -taken, StockReason.SOLD, shop=shop, order=order, require_active=True)
    return taken, (product.backorder_days or 0) if waiting else 0


def pending_backorder(product):
    """Unités déjà promises en précommande et pas encore prêtes (commandes en attente ou confirmées)."""
    from .models import OrderItem

    rows = OrderItem.objects.filter(product=product, order__status__in=[OrderStatus.PENDING, OrderStatus.CONFIRMED]).aggregate(
        total=Sum("quantity"), taken=Sum("from_stock")
    )
    return (rows["total"] or 0) - (rows["taken"] or 0)


def restore_for_order(order, actor):
    """
    Annulation : remet au stock la part prélevée de chaque ligne, une seule fois (la contrainte unique
    (commande, produit, raison) l'interdit même pour deux annulations simultanées). Une précommande n'a rien pris.
    """
    _require_transaction()
    if order.status != OrderStatus.CANCELLED:
        raise ValueError("Seule une commande annulée remet son stock.")
    moves = []
    lines = sorted(
        ((item.product_id, item.from_stock) for item in order.items.all() if item.product_id and item.from_stock),
        key=lambda line: str(line[0]),
    )
    for product_id, from_stock in lines:
        moves.append(
            apply(product_id, from_stock, StockReason.CANCELLED, shop=order.shop, actor=actor, order=order)
        )
    return moves


def _name(actor):
    if actor is None:
        return ""
    from .team import full_name

    return full_name(actor)[:160]
