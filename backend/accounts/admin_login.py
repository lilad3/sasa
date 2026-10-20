from django import forms
from django.contrib.admin.forms import AdminAuthenticationForm
from django.core.exceptions import ValidationError

from audit.services import record
from core.ratelimit import hit

from . import lockout, mfa, policy


class AdminLoginForm(AdminAuthenticationForm):
    """
    Connexion à l'administration de la plateforme : mot de passe ET code 2FA, sans exception.
    Mêmes protections que l'API (verrou par e-mail, limite par IP), et tout passe au journal.
    """

    otp_code = forms.CharField(
        label="Code de double authentification",
        max_length=32,
        widget=forms.TextInput(attrs={"autocomplete": "one-time-code", "inputmode": "numeric"}),
    )

    def clean(self):
        email = (self.cleaned_data.get("username") or "").strip().lower()
        self.cleaned_data["username"] = email

        if retry_after := hit("admin_login:ip", getattr(self.request, "client_ip", ""), policy.LOGIN_IP_LIMIT):
            raise ValidationError(f"Trop de tentatives depuis cette adresse. Réessayez dans {retry_after // 60 + 1} min.")
        if seconds := lockout.locked_for(email):
            raise ValidationError(f"Trop de tentatives. Réessayez dans {seconds // 60 + 1} min.")

        try:
            super().clean()  # mot de passe, compte actif, compte staff
        except ValidationError:
            lockout.record_failure(email, self.request, "admin_login_failed")
            raise

        user = self.get_user()
        if not mfa.is_enabled(user):
            record("admin_login_failed", self.request, actor=user, reason="2fa_absente")
            raise ValidationError(
                "La double authentification est obligatoire pour l'administration. "
                "Activez-la d'abord : python manage.py setup_2fa " + email
            )
        if mfa.verify(user, self.cleaned_data.get("otp_code", ""), self.request) is None:
            lockout.record_failure(email, self.request, "admin_login_failed")
            raise ValidationError("Code de double authentification invalide.")

        lockout.reset_failures(email)
        record("admin_login_succeeded", self.request, actor=user)
        return self.cleaned_data
