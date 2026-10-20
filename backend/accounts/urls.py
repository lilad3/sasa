from django.urls import path

from . import views

urlpatterns = [
    path("auth/signup", views.SignupView.as_view()),
    path("auth/signup/complete", views.SignupCompleteView.as_view()),
    path("auth/login", views.LoginView.as_view()),
    path("auth/login/2fa", views.LoginMfaView.as_view()),
    path("auth/token/refresh", views.TokenRefreshView.as_view()),
    path("auth/logout", views.LogoutView.as_view()),
    path("auth/unlock", views.UnlockView.as_view()),
    path("auth/reauth", views.ReauthView.as_view()),
    path("auth/password/forgot", views.ForgotPasswordView.as_view()),
    path("auth/password/reset", views.ResetPasswordView.as_view()),
    path("me", views.MeView.as_view()),
    path("me/shops", views.MyShopsView.as_view()),
    path("me/password", views.PasswordChangeView.as_view()),
    path("me/sessions", views.SessionListView.as_view()),
    path("me/sessions/revoke-others", views.RevokeOtherSessionsView.as_view()),
    path("me/sessions/<uuid:session_id>", views.SessionDetailView.as_view()),
    path("me/security-events", views.SecurityEventsView.as_view()),
    path("me/2fa/setup", views.MfaSetupView.as_view()),
    path("me/2fa/confirm", views.MfaConfirmView.as_view()),
    path("me/2fa/disable", views.MfaDisableView.as_view()),
    path("me/2fa/recovery-codes", views.RecoveryCodesView.as_view()),
]
