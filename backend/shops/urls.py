from django.urls import path

from . import storefront, views

urlpatterns = [
    path("shops/<slug:slug>/dashboard", views.DashboardView.as_view()),
    path("shops/<slug:slug>/orders", views.OrderListView.as_view()),
    path("shops/<slug:slug>/orders/<uuid:order_id>", views.OrderDetailView.as_view()),
    path("shops/<slug:slug>/demo-data", views.DemoDataView.as_view()),
    # Boutique publique, sans compte
    path("storefront/<slug:slug>", storefront.StorefrontDetailView.as_view()),
    path("storefront/<slug:slug>/products", storefront.StorefrontProductListView.as_view()),
    path("storefront/<slug:slug>/products/<slug:product_slug>", storefront.StorefrontProductDetailView.as_view()),
    path("storefront/<slug:slug>/orders", storefront.StorefrontOrderView.as_view()),
]
