from django.urls import path

from . import activity, api_keys, catalog, shop_settings, storefront, team, views

urlpatterns = [
    path("shops/<slug:slug>/dashboard", views.DashboardView.as_view()),
    path("shops/<slug:slug>/orders", views.OrderListView.as_view()),
    path("shops/<slug:slug>/orders/counts", views.OrderCountsView.as_view()),
    path("shops/<slug:slug>/orders/export", views.OrderExportView.as_view()),
    path("shops/<slug:slug>/orders/<uuid:order_id>", views.OrderDetailView.as_view()),
    path("shops/<slug:slug>/orders/<uuid:order_id>/notes", views.OrderNoteView.as_view()),
    path("shops/<slug:slug>/demo-data", views.DemoDataView.as_view()),
    # Catalogue
    path("shops/<slug:slug>/products", catalog.ProductListView.as_view()),
    path("shops/<slug:slug>/products/overview", catalog.ProductOverviewView.as_view()),
    path("shops/<slug:slug>/products/import", catalog.ProductImportView.as_view()),
    path("shops/<slug:slug>/products/<uuid:product_id>", catalog.ProductDetailView.as_view()),
    # Équipe et mot du patron
    path("shops/<slug:slug>/members", team.MemberListView.as_view()),
    path("shops/<slug:slug>/members/<uuid:user_id>", team.MemberDetailView.as_view()),
    path("shops/<slug:slug>/members/<uuid:user_id>/temporary-password", team.MemberPasswordView.as_view()),
    path("shops/<slug:slug>/notes", team.TeamNoteListView.as_view()),
    path("shops/<slug:slug>/notes/<uuid:note_id>", team.TeamNoteDetailView.as_view()),
    path("shops/<slug:slug>/notes/<uuid:note_id>/read", team.TeamNoteReadView.as_view()),
    # Paramètres, plan, clés API
    path("shops/<slug:slug>/settings", shop_settings.ShopSettingsView.as_view()),
    path("shops/<slug:slug>/plans", shop_settings.PlanListView.as_view()),
    path("shops/<slug:slug>/plan", shop_settings.PlanChangeView.as_view()),
    path("shops/<slug:slug>/api-keys", api_keys.ApiKeyListView.as_view()),
    path("shops/<slug:slug>/api-keys/<uuid:key_id>", api_keys.ApiKeyDetailView.as_view()),
    path("shops/<slug:slug>/activity", activity.ShopActivityView.as_view()),
    path("shops/<slug:slug>/security-overview", activity.SecurityOverviewView.as_view()),
    # Boutique publique, sans compte
    path("storefront/<slug:slug>", storefront.StorefrontDetailView.as_view()),
    path("storefront/<slug:slug>/products", storefront.StorefrontProductListView.as_view()),
    path("storefront/<slug:slug>/products/<slug:product_slug>", storefront.StorefrontProductDetailView.as_view()),
    path("storefront/<slug:slug>/orders", storefront.StorefrontOrderView.as_view()),
    path("storefront/<slug:slug>/track", storefront.StorefrontTrackView.as_view()),
]
