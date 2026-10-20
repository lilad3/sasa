"""Chiffres du dashboard. Une commande annulée ne compte ni dans le CA ni dans le nombre de commandes."""

from datetime import datetime, time, timedelta

from django.db.models import Count, Max, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from .models import Order, OrderItem, OrderStatus
from .serializers import OrderSerializer

PERIODS = {"7d": 7, "30d": 30, "90d": 90}


def dashboard_summary(shop, label):
    days = PERIODS[label]
    today = timezone.localdate()
    start = today - timedelta(days=days - 1)
    previous_start = start - timedelta(days=days)
    current = _counted_orders(shop, start, today + timedelta(days=1))
    previous = _counted_orders(shop, previous_start, start)

    now_totals, before_totals = _totals(current), _totals(previous)
    return {
        "period": {"from": start.isoformat(), "to": today.isoformat(), "label": label},
        "currency": "XOF",
        "kpis": {name: {"value": now_totals[name], "previous": before_totals[name]} for name in now_totals},
        "revenue_series": _daily_series(current, start, days),
        "top_products": _top_products(current),
        "recent_orders": OrderSerializer(
            Order.objects.for_shop(shop).prefetch_related("items")[:5], many=True
        ).data,
    }


def _counted_orders(shop, first_day, end_day):
    """Commandes non annulées entre deux dates locales (fin exclue)."""
    return (
        Order.objects.for_shop(shop)
        .exclude(status=OrderStatus.CANCELLED)
        .filter(created_at__gte=_midnight(first_day), created_at__lt=_midnight(end_day))
    )


def _midnight(day):
    return datetime.combine(day, time.min, tzinfo=timezone.get_current_timezone())


def _totals(orders):
    agg = orders.aggregate(revenue=Sum("total"), count=Count("id"), customers=Count("customer_phone", distinct=True))
    revenue, count = agg["revenue"] or 0, agg["count"]
    return {
        "revenue": revenue,
        "orders": count,
        "average_basket": (revenue + count // 2) // count if count else 0,
        "customers": agg["customers"],
    }


def _daily_series(orders, start, days):
    rows = orders.annotate(day=TruncDate("created_at")).values("day").annotate(revenue=Sum("total"), orders=Count("id"))
    by_day = {row["day"]: row for row in rows}
    series = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        row = by_day.get(day, {})
        series.append({"date": day.isoformat(), "revenue": row.get("revenue", 0), "orders": row.get("orders", 0)})
    return series


def _top_products(orders):
    rows = (
        OrderItem.objects.filter(order__in=orders, product__isnull=False)
        .values("product_id")
        .annotate(name=Max("name"), units=Sum("quantity"), revenue=Sum("line_total"))
        .order_by("-revenue")[:5]
    )
    return [
        {"id": str(row["product_id"]), "name": row["name"], "units": row["units"], "revenue": row["revenue"]}
        for row in rows
    ]
