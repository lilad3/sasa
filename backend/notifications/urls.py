from django.urls import path

from . import views

urlpatterns = [
    path("shops/<slug:slug>/notifications", views.NotificationsView.as_view()),
    path("shops/<slug:slug>/notifications/test", views.NotificationsTestView.as_view()),
]
