"""Ce que les commandes de gestion font : envoyer les messages retenus et le résumé du jour (contrat §5.6)."""

import logging
from dataclasses import dataclass
from datetime import datetime, time, timedelta

from django.db.models import Count, F, Q, Sum
from django.utils import timezone

from shops.models import Order, OrderStatus, Product, Shop

from . import compose
from .events import EVENTS
from .models import NotificationState
from .recipients import recipients
from .send import WINDOW, Budget, Pending, ensure_state, restore, send_all, take_window, under_daily_cap, breaker_open
from .triggers import _stock_message

logger = logging.getLogger("akwaba.notifications")

# Un lot de nuit n'est pas une requête de client : plus de temps, toujours borné.
JOB_BUDGET = 120


@dataclass
class Counts:
    sent: int = 0
    failed: int = 0
    skipped: int = 0

    @property
    def attempted(self):
        return self.sent + self.failed


def flush_held(*, shop_slug=None, now=None, dry_run=False):
    """Envoie, groupés, les messages retenus dont la fenêtre est terminée. Renvoie des compteurs."""
    now = now or timezone.now()
    counts = Counts()
    states = (
        NotificationState.objects.filter(held_count__gt=0, last_sent_at__lte=now - WINDOW)
        .exclude(event="daily_summary")
        .select_related("membership__shop")
        .order_by("membership__shop_id", "pk")
    )
    if shop_slug:
        states = states.filter(membership__shop__slug=shop_slug)
    by_shop = {}
    for state in states:
        by_shop.setdefault(state.membership.shop, []).append(state)
    for shop, shop_states in by_shop.items():
        budget = Budget(JOB_BUDGET)
        allowed = {}
        pendings = []
        for state in shop_states:
            event = EVENTS.get(state.event)
            if event is None or not event.ready:
                counts.skipped += 1
                continue
            if event.id not in allowed:
                allowed[event.id] = {r.membership.pk: r for r in recipients(shop, event)}
            recipient = allowed[event.id].get(state.membership_id)
            if recipient is None:
                # Plus de droit, événement désactivé ou compte retiré : ce qui était retenu n'a plus lieu d'être envoyé.
                if not dry_run:
                    NotificationState.objects.filter(pk=state.pk).update(held_count=0, held_refs=[])
                counts.skipped += 1
                continue
            if dry_run:
                counts.sent += 1
                continue
            if breaker_open() or budget.spent or not under_daily_cap(shop):
                counts.skipped += 1
                continue
            taken = take_window(state, now)
            if taken is None:
                counts.skipped += 1
                continue
            held, refs, since = taken
            try:
                if event.id == "low_stock":
                    message = _stock_message(recipient, shop, refs)
                else:
                    message = compose.orders_message(recipient, shop, event.id, order=None, count=held, refs=refs, since=since)
            except Exception as exc:
                logger.error("notifications: message retenu impossible membership_id=%s (%s)", state.membership_id, type(exc).__name__)
                message = None
            if message is None:
                continue
            pendings.append(Pending(state=state, message=message, refs=refs, held_count=held))
        send_all(pendings, budget)
        for pending in pendings:
            if pending.failed:
                restore(pending)
                counts.failed += 1
            else:
                counts.sent += 1
    return counts


def day_bounds(day):
    zone = timezone.get_current_timezone()
    start = datetime.combine(day, time.min, tzinfo=zone)
    return start, start + timedelta(days=1)


def day_figures(shop, day):
    """Les chiffres du jour (heure d'Abidjan), commandes de démonstration exclues. Le CA ne compte pas les annulées."""
    start, end = day_bounds(day)
    real = Order.objects.for_shop(shop).filter(is_demo=False)
    placed = real.filter(created_at__gte=start, created_at__lt=end)
    kept = placed.exclude(status=OrderStatus.CANCELLED)
    agg = placed.aggregate(received=Count("id"), cancelled=Count("id", filter=Q(status=OrderStatus.CANCELLED)))
    return {
        "received": agg["received"],
        "cancelled": agg["cancelled"],
        "to_process": real.filter(status__in=[OrderStatus.PENDING, OrderStatus.CONFIRMED]).count(),
        "delivered": real.filter(delivered_at__gte=start, delivered_at__lt=end).count(),
        "low_stock": Product.objects.for_shop(shop).filter(is_active=True, stock__lte=F("low_stock_threshold")).count(),
        "revenue": kept.aggregate(total=Sum("total"))["total"] or 0,
    }


def send_summaries(day, *, shop_slug=None, dry_run=False, lines=None):
    """
    Le résumé du jour, une fois par jour et par personne. Un envoi qui échoue remet la date d'avant : une relance
    le renvoie. `lines` reçoit, en dry-run, « boutique : nombre de destinataires » (jamais d'adresse).
    """
    counts = Counts()
    shops = Shop.objects.all().order_by("slug")
    if shop_slug:
        shops = shops.filter(slug=shop_slug)
    event = EVENTS["daily_summary"]
    for shop in shops:
        budget = Budget(JOB_BUDGET)
        figures = None
        pendings = []
        for recipient in recipients(shop, event):
            if figures is None:
                figures = day_figures(shop, day)
            # Pas de message vide : rien reçu ce jour-là et rien à traiter.
            if figures["received"] == 0 and figures["to_process"] == 0:
                counts.skipped += 1
                continue
            state = ensure_state(recipient.membership, event.id)
            if dry_run:
                if state.last_summary_on is None or state.last_summary_on < day:
                    counts.sent += 1
                    if lines is not None:
                        lines.append(f"{shop.slug} : {recipient.membership.role} recevrait le résumé")
                else:
                    counts.skipped += 1
                continue
            if breaker_open() or budget.spent or not under_daily_cap(shop):
                counts.skipped += 1
                continue
            previous = state.last_summary_on
            claimed = NotificationState.objects.filter(pk=state.pk).filter(
                Q(last_summary_on__isnull=True) | Q(last_summary_on__lt=day)
            ).update(last_summary_on=day)
            if claimed != 1:
                counts.skipped += 1
                continue

            def undo(pk=state.pk, previous=previous, day=day):
                NotificationState.objects.filter(pk=pk, last_summary_on=day).update(last_summary_on=previous)

            try:
                message = compose.summary_message(recipient, shop, day, figures)
            except Exception as exc:
                logger.error("notifications: résumé impossible membership_id=%s (%s)", state.membership_id, type(exc).__name__)
                undo()
                counts.failed += 1
                continue
            pendings.append(Pending(state=state, message=message, refs=[], held_count=0, undo=undo))
        send_all(pendings, budget)
        for pending in pendings:
            if pending.failed:
                restore(pending)
                counts.failed += 1
            else:
                counts.sent += 1
    return counts
