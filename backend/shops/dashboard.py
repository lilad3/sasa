"""Chiffres du dashboard. Une commande annulée ne compte ni dans le CA ni dans le nombre de commandes."""

from datetime import datetime, time, timedelta

from django.db.models import Count, F, Max, Sum
from django.db.models.functions import ExtractHour, ExtractIsoWeekDay, TruncDate
from django.utils import timezone

from .models import Order, OrderItem, OrderStatus, Product
from .serializers import OrderSerializer

PERIODS = {"7d": 7, "30d": 30, "90d": 90}


def dashboard_summary(shop, label):
    days = PERIODS[label]
    today = timezone.localdate()
    start = today - timedelta(days=days - 1)
    previous_start = start - timedelta(days=days)
    placed = _placed_orders(shop, start, today + timedelta(days=1))
    current = placed.exclude(status=OrderStatus.CANCELLED)
    previous = _placed_orders(shop, previous_start, start).exclude(status=OrderStatus.CANCELLED)

    now_totals, before_totals = _totals(current), _totals(previous)
    counts = order_counts(shop)
    return {
        "period": {"from": start.isoformat(), "to": today.isoformat(), "label": label},
        "currency": "XOF",
        "kpis": {name: {"value": now_totals[name], "previous": before_totals[name]} for name in now_totals},
        "revenue_series": _daily_series(current, start, days),
        "previous_series": _daily_series(previous, previous_start, days),
        "top_products": _top_products(current),
        "recent_orders": OrderSerializer(
            Order.objects.for_shop(shop).prefetch_related("items")[:5], many=True
        ).data,
        # Le travail en attente ne dépend pas de la période : une commande d'il y a 10 jours reste à traiter.
        "to_process": {status: counts[status] for status in ("pending", "confirmed", "shipped")},
        "statuses": _status_counts(placed),
        "payment_methods": _by_payment(current),
        "places": _by_place(current),
        "order_hours": _order_hours(current),
        "customers": _customer_split(shop, current, start),
        "top_customers": _top_customers(current),
        "low_stock": low_stock(shop),
    }


def low_stock(shop, limit=6):
    """Produits en vente arrivés à leur seuil d'alerte : les plus bas d'abord, ruptures comprises."""
    products = Product.objects.for_shop(shop).filter(is_active=True, stock__lte=F("low_stock_threshold"))
    return {
        "count": products.count(),
        "items": [
            {"id": str(p.pk), "name": p.name, "sku": p.sku, "stock": p.stock, "threshold": p.low_stock_threshold}
            for p in products.order_by("stock", "name")[:limit]
        ],
    }


def order_counts(shop):
    """Nombre de commandes de la boutique par statut, toutes dates confondues."""
    return _status_counts(Order.objects.for_shop(shop))


def _placed_orders(shop, first_day, end_day):
    """Toutes les commandes passées entre deux dates locales (fin exclue), annulées comprises."""
    return Order.objects.for_shop(shop).filter(created_at__gte=_midnight(first_day), created_at__lt=_midnight(end_day))


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


def _status_counts(orders):
    counts = dict(orders.order_by().values_list("status").annotate(n=Count("id")))
    return {status: counts.get(status, 0) for status in OrderStatus.values}


def _by_payment(orders):
    rows = orders.order_by().values("payment_method").annotate(orders=Count("id"), revenue=Sum("total")).order_by("-revenue")
    return [{"method": row["payment_method"], "orders": row["orders"], "revenue": row["revenue"]} for row in rows]


def _by_place(orders):
    """CA par lieu de livraison. Les lieux viennent des zones de livraison : la liste reste courte."""
    rows = (
        orders.order_by()
        .values("customer_city", "customer_commune")
        .annotate(orders=Count("id"), revenue=Sum("total"))
        .order_by("-revenue")
    )
    return [
        {"city": row["customer_city"], "commune": row["customer_commune"], "orders": row["orders"], "revenue": row["revenue"]}
        for row in rows
    ]


def _order_hours(orders):
    """Commandes par jour de la semaine (lundi d'abord) et par heure, à l'heure d'Abidjan : 7 lignes de 24 cases."""
    grid = [[0] * 24 for _ in range(7)]
    rows = (
        orders.order_by()
        .annotate(weekday=ExtractIsoWeekDay("created_at"), hour=ExtractHour("created_at"))
        .values("weekday", "hour")
        .annotate(n=Count("id"))
    )
    for row in rows:
        grid[row["weekday"] - 1][row["hour"]] = row["n"]
    return grid


def _customer_split(shop, orders, start):
    """Clients de la période : nouveaux, ou déjà venus avant. Un client est reconnu à son numéro de téléphone."""
    phones = orders.order_by().values("customer_phone").distinct()
    returning = (
        Order.objects.for_shop(shop)
        .exclude(status=OrderStatus.CANCELLED)
        .filter(created_at__lt=_midnight(start), customer_phone__in=phones)
        .order_by()
        .values("customer_phone")
        .distinct()
        .count()
    )
    return {"new": phones.count() - returning, "returning": returning}


def _top_customers(orders):
    # Le numéro sert à regrouper, mais ne sort pas : le dashboard n'en a pas besoin.
    rows = (
        orders.order_by()
        .values("customer_phone")
        .annotate(
            name=Max("customer_name"),
            city=Max("customer_city"),
            commune=Max("customer_commune"),
            orders=Count("id"),
            revenue=Sum("total"),
        )
        .order_by("-revenue", "-orders")[:5]
    )
    return [
        {"name": row["name"], "city": row["city"], "commune": row["commune"], "orders": row["orders"], "revenue": row["revenue"]}
        for row in rows
    ]
