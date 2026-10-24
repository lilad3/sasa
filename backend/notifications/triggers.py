"""
Les déclencheurs, appelés par `transaction.on_commit` après la validation d'une commande ou d'une annulation.
Tout le try/except est ici : une panne d'e-mail, un bug de gabarit ou de base ne peut jamais changer la réponse
faite au client ni la commande déjà enregistrée. Les journaux ne portent que des identifiants et des compteurs.
"""

import logging

from django.db.models import F

from shops.models import Order, OrderStatus, Product, Shop

from . import compose
from .events import EVENTS
from .models import NotificationState
from .recipients import recipients
from .send import Budget, Pending, breaker_open, ensure_state, enabled, hold, restore, send_all, take_window, under_daily_cap

logger = logging.getLogger("akwaba.notifications")


def collect(shop, event_id, refs, build, budget, pendings):
    """
    Pour chaque destinataire de `event_id` : envoie maintenant (fenêtre prise) ou retient. `build(recipient, count, refs, since)`
    renvoie le message, avec `count` événements (celui-ci et les retenus) et leurs références.
    """
    event = EVENTS[event_id]
    for recipient in recipients(shop, event):
        state = ensure_state(recipient.membership, event_id)
        if breaker_open() or budget.spent or not under_daily_cap(shop):
            hold(state.pk, refs)
            continue
        taken = take_window(state)
        if taken is None:
            hold(state.pk, refs)
            continue
        held, held_refs, since = taken
        all_refs = (held_refs + [ref for ref in refs if ref not in held_refs])
        try:
            message = build(recipient, held + 1, all_refs, since)
        except Exception as exc:
            logger.error("notifications: message impossible event=%s membership_id=%s (%s)", event_id, recipient.membership.pk, type(exc).__name__)
            message = None
        if message is None:
            hold(state.pk, all_refs, held + 1)
            continue
        pendings.append(Pending(state=state, message=message, refs=all_refs, held_count=held + 1))


def flush(pendings, budget):
    send_all(pendings, budget)
    failed = [pending for pending in pendings if pending.failed]
    for pending in failed:
        restore(pending)
    if failed:
        logger.warning("notifications: %s message(s) retenu(s) après échec", len(failed))


def guarded(name, work):
    """Exécute un déclencheur sans jamais laisser remonter une erreur."""
    if not enabled():
        return
    try:
        work()
    except Exception as exc:
        logger.error("notifications: déclencheur %s en échec (%s)", name, type(exc).__name__)


def _with_articles(order):
    order.articles = sum(item.quantity for item in order.items.all())
    return order


def notify_order_placed(shop_id, order_id, low_stock_ids=()):
    """Une commande vient d'être validée : « nouvelle commande », et « stock bas » pour les produits qui ont franchi leur seuil."""
    guarded("order_placed", lambda: _order_placed(shop_id, order_id, list(low_stock_ids)))


def _order_placed(shop_id, order_id, low_stock_ids):
    shop = Shop.objects.get(pk=shop_id)
    order = _with_articles(Order.objects.for_shop(shop).prefetch_related("items").get(pk=order_id))
    if order.is_demo:
        return
    budget = Budget()
    pendings = []

    def build_order(recipient, count, refs, since):
        return compose.orders_message(recipient, shop, "new_order", order=order, count=count, refs=refs, since=since)

    collect(shop, "new_order", [order.reference], build_order, budget, pendings)
    if low_stock_ids:
        ids = [str(pk) for pk in low_stock_ids]

        def build_stock(recipient, count, refs, since):
            return _stock_message(recipient, shop, refs)

        collect(shop, "low_stock", ids, build_stock, budget, pendings)
    flush(pendings, budget)


def notify_order_cancelled(shop_id, order_id, previous_status):
    guarded("order_cancelled", lambda: _order_cancelled(shop_id, order_id, previous_status))


def _order_cancelled(shop_id, order_id, previous_status):
    shop = Shop.objects.get(pk=shop_id)
    order = _with_articles(Order.objects.for_shop(shop).prefetch_related("items").get(pk=order_id))
    if order.is_demo or order.status != OrderStatus.CANCELLED:
        return
    order.previous_label = OrderStatus(previous_status).label.lower()
    budget = Budget()
    pendings = []

    def build(recipient, count, refs, since):
        return compose.orders_message(recipient, shop, "order_cancelled", order=order, count=count, refs=refs, since=since)

    collect(shop, "order_cancelled", [order.reference], build, budget, pendings)
    flush(pendings, budget)


def _stock_message(recipient, shop, product_ids):
    """Le nom et le stock sont relus à l'envoi : seuls les produits encore sous leur seuil figurent dans le message."""
    products = list(
        Product.objects.for_shop(shop)
        .filter(pk__in=product_ids, is_active=True, stock__lte=F("low_stock_threshold"))
        .order_by("stock", "name")
        .values_list("name", "stock", "low_stock_threshold")
    )
    return compose.low_stock_message(recipient, shop, products) if products else None
