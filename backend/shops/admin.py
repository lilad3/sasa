from django.contrib import admin

from .models import Membership, Order, OrderItem, Product, Shop, StockMovement


class MembershipInline(admin.TabularInline):
    model = Membership
    extra = 0
    autocomplete_fields = ("user",)


@admin.register(Shop)
class ShopAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "plan", "created_at")
    search_fields = ("name", "slug")
    inlines = [MembershipInline]


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "shop", "sku", "price", "stock", "status")
    list_filter = ("shop", "status")
    search_fields = ("name", "sku")
    # Le coût révèle la marge : jamais dans l'admin. Le stock ne se change que par shops/stock.py (historique).
    exclude = ("cost", "legacy_is_active")
    readonly_fields = ("stock",)

    def has_delete_permission(self, request, obj=None):
        # Un produit qui a un historique de stock autre que « initial » ne se supprime pas : on l'archive.
        if obj is not None and obj.movements.exclude(reason="initial").exists():
            return False
        return super().has_delete_permission(request, obj)


@admin.register(StockMovement)
class StockMovementAdmin(admin.ModelAdmin):
    """Le journal du stock, en lecture seule pour tout le monde."""

    list_display = ("created_at", "shop", "product", "delta", "stock_after", "reason", "actor_name")
    list_filter = ("shop", "reason")

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("reference", "shop", "status", "total", "customer_name", "created_at")
    list_filter = ("shop", "status", "payment_method")
    search_fields = ("reference", "customer_name", "customer_phone")
    inlines = [OrderItemInline]
