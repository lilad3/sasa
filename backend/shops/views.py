from django.db import transaction
from django.db.models import Q
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.response import Response

from audit.services import record
from core.exceptions import ProblemError
from core.pagination import PagePagination

from .dashboard import PERIODS, dashboard_summary
from .demo import generate_demo_data
from .models import Order, OrderStatus
from .permissions import ShopScopedView
from .serializers import OrderSerializer, OrderStatusSerializer


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


class OrderDetailView(ShopScopedView):
    permission_by_method = {"GET": "orders.view", "PATCH": "orders.manage"}

    def get(self, request, slug, order_id):
        return Response(OrderSerializer(self._order(order_id)).data)

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
        return Response(OrderSerializer(order).data)

    def _order(self, order_id):
        # Une commande d'une autre boutique donne 404, comme une commande inexistante.
        order = Order.objects.for_shop(self.shop).prefetch_related("items").filter(pk=order_id).first()
        if order is None:
            raise NotFound("Commande introuvable.")
        return order


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
