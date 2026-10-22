from datetime import date, datetime, time, timedelta

from django.db import transaction
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.response import Response

from accounts.sessions import require_reauth
from audit.services import record
from core.exceptions import ProblemError
from core.pagination import PagePagination
from core.ratelimit import enforce
from core.spreadsheet import excel_csv

from .dashboard import PERIODS, dashboard_summary, order_counts
from .demo import generate_demo_data
from .models import Channel, Order, OrderNote, OrderStatus, PaymentMethod
from .permissions import ShopScopedView
from .serializers import OrderDetailSerializer, OrderNoteSerializer, OrderSerializer, OrderStatusSerializer
from .team import full_name

EXPORT_MAX_DAYS = 366
ORDER_NOTE_LIMIT = (60, 3600)  # par compte


class DashboardView(ShopScopedView):
    permission_by_method = {"GET": "dashboard.view"}

    def get(self, request, slug):
        period = request.query_params.get("period", "30d")
        if period not in PERIODS:
            raise ValidationError({"period": [ErrorDetail("Période attendue : 7d, 30d ou 90d.", code="invalid_choice")]})
        return Response(dashboard_summary(self.shop, period))


class OrderListView(ShopScopedView):
    permission_by_method = {"GET": "orders.view"}

    def get(self, request, slug):
        orders = Order.objects.for_shop(self.shop).prefetch_related("items")
        wanted_status = request.query_params.get("status")
        if wanted_status:
            if wanted_status not in OrderStatus.values:
                raise ValidationError({"status": [ErrorDetail("Statut inconnu.", code="invalid_choice")]})
            orders = orders.filter(status=wanted_status)
        query = request.query_params.get("q", "").strip()[:60]
        if query:
            orders = orders.filter(
                Q(reference__icontains=query)
                | Q(customer_name__icontains=query)
                | Q(customer_phone__contains=query.replace(" ", ""))
            )
        paginator = PagePagination()
        page = paginator.paginate_queryset(orders, request, view=self)
        return paginator.get_paginated_response(OrderSerializer(page, many=True).data)


class OrderCountsView(ShopScopedView):
    """Nombre de commandes par statut : les onglets de la liste et le travail à faire, pour tous les rôles."""

    permission_by_method = {"GET": "orders.view"}

    def get(self, request, slug):
        return Response(order_counts(self.shop))


class OrderDetailView(ShopScopedView):
    permission_by_method = {"GET": "orders.view", "PATCH": "orders.manage"}

    def get(self, request, slug, order_id):
        return Response(OrderDetailSerializer(self._order(order_id)).data)

    def patch(self, request, slug, order_id):
        serializer = OrderStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        new_status = serializer.validated_data["status"]
        with transaction.atomic():
            order = self._order(order_id)
            if new_status != order.status:
                if not order.can_become(new_status):
                    raise ProblemError(
                        409,
                        "invalid_transition",
                        f"Une commande « {order.get_status_display().lower()} » ne peut pas passer "
                        f"à « {OrderStatus(new_status).label.lower()} ».",
                    )
                previous_status = order.status
                order.status = new_status
                order.save(update_fields=["status", "updated_at"])
                record(
                    "order_status_changed",
                    request,
                    actor=request.user,
                    shop=self.shop,
                    target=("order", order.pk, order.reference),
                    previous_status=previous_status,
                    new_status=new_status,
                )
        return Response(OrderDetailSerializer(order).data)

    def _order(self, order_id):
        return shop_order(self.shop, order_id)


def shop_order(shop, order_id):
    # Une commande d'une autre boutique donne 404, comme une commande inexistante.
    order = Order.objects.for_shop(shop).prefetch_related("items", "notes").filter(pk=order_id).first()
    if order is None:
        raise NotFound("Commande introuvable.")
    return order


class OrderNoteView(ShopScopedView):
    """Note interne sur une commande. On n'en supprime pas : c'est le fil de ce qui s'est passé."""

    permission_by_method = {"POST": "orders.manage"}

    def post(self, request, slug, order_id):
        enforce("order_note", str(request.user.pk), ORDER_NOTE_LIMIT)
        order = shop_order(self.shop, order_id)
        serializer = OrderNoteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        note = OrderNote.objects.create(
            order=order, author=request.user, author_name=full_name(request.user), body=serializer.validated_data["body"]
        )
        return Response(OrderNoteSerializer(note).data, status=status.HTTP_201_CREATED)


class OrderExportView(ShopScopedView):
    """
    Export des ventes en CSV pour Excel. Toute la clientèle et ses téléphones sortent d'un coup :
    confirmation renforcée, journal, et formules neutralisées (« =CMD() » reste du texte).
    """

    permission_by_method = {"GET": "orders.export"}

    def get(self, request, slug):
        first, last = _export_range(request.query_params)
        require_reauth(request)
        tz = timezone.get_current_timezone()
        orders = (
            Order.objects.for_shop(self.shop)
            .filter(
                created_at__gte=datetime.combine(first, time.min, tzinfo=tz),
                created_at__lt=datetime.combine(last + timedelta(days=1), time.min, tzinfo=tz),
            )
            .prefetch_related("items")
            .order_by("created_at")
        )
        payments = dict(PaymentMethod.choices)
        statuses = dict(OrderStatus.choices)
        channels = dict(Channel.choices)
        rows = [
            [
                order.reference,
                timezone.localtime(order.created_at).strftime("%d/%m/%Y %H:%M"),
                statuses[order.status],
                order.customer_name,
                order.customer_phone,
                order.customer_city,
                order.customer_commune,
                order.customer_landmark,
                payments[order.payment_method],
                " | ".join(f"{item.quantity} × {item.name}" for item in order.items.all()),
                order.subtotal,
                order.discount_amount,
                order.delivery_fee,
                order.total,
                order.discount_code,
                channels.get(order.channel, order.channel),
            ]
            for order in orders
        ]
        header = ["Référence", "Date", "Statut", "Client", "Téléphone", "Ville", "Commune", "Repère", "Paiement",
                  "Articles", "Sous-total (F)", "Remise (F)", "Livraison (F)", "Total (F)", "Code de réduction", "Canal"]
        record("orders_exported", request, actor=request.user, shop=self.shop, rows=len(rows), first=str(first), last=str(last))
        response = HttpResponse(excel_csv(header, rows), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="akwaba-{self.shop.slug}-{first}-{last}.csv"'
        return response


def _export_range(params):
    today = timezone.localdate()
    try:
        first = date.fromisoformat(params.get("from") or (today - timedelta(days=29)).isoformat())
        last = date.fromisoformat(params.get("to") or today.isoformat())
    except ValueError:
        raise ValidationError({"from": [ErrorDetail("Dates attendues au format AAAA-MM-JJ.", code="invalid_date")]}) from None
    if first > last:
        raise ValidationError({"from": [ErrorDetail("La date de début est après la date de fin.", code="invalid_range")]})
    if (last - first).days >= EXPORT_MAX_DAYS:
        raise ValidationError({"from": [ErrorDetail("Un an au maximum par export.", code="range_too_long")]})
    return first, last


class DemoDataView(ShopScopedView):
    permission_by_method = {"POST": "shop.manage"}

    def post(self, request, slug):
        if Order.objects.for_shop(self.shop).filter(is_demo=False).exists():
            raise ProblemError(
                409,
                "shop_not_empty",
                "Cette boutique a déjà de vraies commandes : les données de démo ne sont pas ajoutées.",
            )
        summary = generate_demo_data(self.shop)
        record("demo_data_generated", request, actor=request.user, shop=self.shop, **summary)
        return Response(summary, status=status.HTTP_201_CREATED)
