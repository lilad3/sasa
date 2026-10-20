from django.contrib.auth import password_validation
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail

from audit.models import AuditEvent

from . import mfa
from .models import User, UserSession

# Assez large pour ne pas tronquer, assez court pour borner la requête.
# La vraie limite (128) est un validateur de mot de passe, avec son propre code d'erreur.
PASSWORD_FIELD = {"max_length": 4096, "trim_whitespace": False}
CODE_FIELD = {"max_length": 32}


def validate_new_password(password, user, field="password"):
    """Applique AUTH_PASSWORD_VALIDATORS et renvoie leurs codes au format du contrat."""
    try:
        password_validation.validate_password(password, user)
    except DjangoValidationError as exc:
        raise serializers.ValidationError(
            {field: [ErrorDetail(e.message % e.params if e.params else e.message, code=e.code) for e in exc.error_list]}
        )


class EmailField(serializers.EmailField):
    def to_internal_value(self, data):
        return super().to_internal_value(data).strip().lower()


class SignupSerializer(serializers.Serializer):
    email = EmailField(max_length=254)
    first_name = serializers.CharField(max_length=80)
    last_name = serializers.CharField(max_length=80)
    shop_name = serializers.CharField(min_length=2, max_length=60)


class SignupCompleteSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=2000)
    password = serializers.CharField(**PASSWORD_FIELD)


class LoginSerializer(serializers.Serializer):
    email = EmailField(max_length=254)
    password = serializers.CharField(**PASSWORD_FIELD)
    shared_device = serializers.BooleanField(default=False)


class LoginMfaSerializer(serializers.Serializer):
    mfa_token = serializers.CharField(max_length=2000)
    code = serializers.CharField(**CODE_FIELD)


class RefreshSerializer(serializers.Serializer):
    refresh = serializers.CharField(max_length=2000)


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField(max_length=2000, required=False)


class TokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=2000)


class ForgotPasswordSerializer(serializers.Serializer):
    email = EmailField(max_length=254)


class ResetPasswordSerializer(serializers.Serializer):
    uid = serializers.CharField(max_length=64)
    token = serializers.CharField(max_length=128)
    password = serializers.CharField(**PASSWORD_FIELD)


class PasswordChangeSerializer(serializers.Serializer):
    current_password = serializers.CharField(**PASSWORD_FIELD)
    password = serializers.CharField(**PASSWORD_FIELD)


class ReauthSerializer(serializers.Serializer):
    """Mot de passe, ou code 2FA si la 2FA est active : la preuve la plus forte dont le compte dispose."""

    password = serializers.CharField(required=False, **PASSWORD_FIELD)
    code = serializers.CharField(required=False, **CODE_FIELD)

    def validate(self, data):
        field = "code" if mfa.is_enabled(self.context["user"]) else "password"
        if not data.get(field):
            message = "Saisissez le code de votre application." if field == "code" else "Saisissez votre mot de passe."
            raise serializers.ValidationError({field: [ErrorDetail(message, code="required")]})
        return {"field": field, "value": data[field]}


class MfaCodeSerializer(serializers.Serializer):
    code = serializers.CharField(**CODE_FIELD)


class MeSerializer(serializers.ModelSerializer):
    mfa_enabled = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "first_name", "last_name", "mfa_enabled", "is_demo", "date_joined"]
        read_only_fields = fields

    def get_mfa_enabled(self, user):
        return mfa.is_enabled(user)


class MeUpdateSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["first_name", "last_name"]
        extra_kwargs = {"first_name": {"max_length": 80}, "last_name": {"max_length": 80}}


class SessionSerializer(serializers.ModelSerializer):
    current = serializers.SerializerMethodField()

    class Meta:
        model = UserSession
        fields = ["id", "device_label", "ip", "shared_device", "current", "created_at", "last_seen_at"]

    def get_current(self, session):
        return session.pk == self.context["current"].pk


class SecurityEventSerializer(serializers.ModelSerializer):
    id = serializers.UUIDField(source="public_id")
    type = serializers.CharField(source="action")
    label = serializers.CharField(source="get_action_display")

    class Meta:
        model = AuditEvent
        fields = ["id", "type", "label", "severity", "ip", "device_label", "created_at"]
