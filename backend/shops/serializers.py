from rest_framework import serializers

from .models import Order, OrderItem, OrderStatus


class OrderItemSerializer(serializers.ModelSerializer):
    product_id = serializers.UUIDField(read_only=True)

    class Meta:
        model = OrderItem
        fields = ["product_id", "name", "unit_price", "quantity", "line_total"]


class OrderSerializer(serializers.ModelSerializer):
    customer = serializers.SerializerMethodField()
    items = OrderItemSerializer(many=True, read_only=True)

    class Meta:
        model = Order
        fields = [
            "id", "reference", "status", "payment_method", "customer", "items",
            "subtotal", "delivery_fee", "total", "created_at",
        ]

    def get_customer(self, order):
        return {
            "name": order.customer_name,
            "phone": order.customer_phone,
            "city": order.customer_city,
            "commune": order.customer_commune,
            "landmark": order.customer_landmark,
        }


class OrderStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=OrderStatus.choices)
