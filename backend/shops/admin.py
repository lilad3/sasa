from django.contrib import admin

from .models import Membership, Order, OrderItem, Product, Shop


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
    list_display = ("name", "shop", "sku", "price", "stock", "is_active")
    list_filter = ("shop", "is_active")
    search_fields = ("name", "sku")


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = ("reference", "shop", "status", "total", "customer_name", "created_at")
    list_filter = ("shop", "status", "payment_method")
    search_fields = ("reference", "customer_name", "customer_phone")
    inlines = [OrderItemInline]
