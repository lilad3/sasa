from django.urls import path

from . import views

urlpatterns = [
    path("shops/<slug:slug>/dashboard", views.DashboardView.as_view()),
    path("shops/<slug:slug>/orders", views.OrderListView.as_view()),
    path("shops/<slug:slug>/orders/<uuid:order_id>", views.OrderDetailView.as_view()),
    path("shops/<slug:slug>/demo-data", views.DemoDataView.as_view()),
]
