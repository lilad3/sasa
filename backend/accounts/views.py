import secrets

from django.conf import settings
from django.contrib.auth import authenticate
from django.contrib.auth.tokens import default_token_generator
from django.core import signing
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework import status
from rest_framework.exceptions import AuthenticationFailed, ErrorDetail, NotFound, ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from audit.actions import Category
from audit.models import AuditEvent
from audit.services import record
from core.exceptions import ProblemError
from core.pagination import PagePagination
from core.ratelimit import enforce, fingerprint, incr
from shops.services import create_shop_for_owner, memberships_for

from . import emails, lockout, mfa, policy
from .authentication import SessionJWTAuthentication
from .devices import note_device
from .models import User, UserSession
from .serializers import (
    DirectSignupSerializer,
    ForgotPasswordSerializer,
    LoginMfaSerializer,
    LoginSerializer,
    LogoutSerializer,
    MeSerializer,
    MeUpdateSerializer,
    MfaCodeSerializer,
    PasswordChangeSerializer,
    ReauthSerializer,
    RefreshSerializer,
    ResetPasswordSerializer,
    SecurityEventSerializer,
    SessionSerializer,
    SignupCompleteSerializer,
    SignupSerializer,
    TokenSerializer,
    validate_new_password,
)
from .sessions import find_session, open_session, require_reauth, revoke, revoke_all, rotate_refresh

SIGNUP_SALT = "akwaba.signup"
MFA_SALT = "akwaba.mfa"
LOCK_SECONDS = int(policy.LOGIN_LOCK_DURATION.total_seconds())


def link_error():
    return ProblemError(400, "token_invalid_or_expired", "Ce lien n'est plus valable. Demandez-en un nouveau.")


def demo_error():
    return ProblemError(403, "demo_restricted", "Action désactivée sur les comptes de démonstration.")


def mfa_token_error():
    return ProblemError(401, "mfa_token_expired", "Cette étape a expiré. Saisissez à nouveau votre mot de passe.")


def code_error(message="Code incorrect. Vérifiez l'heure de votre téléphone."):
    return ValidationError({"code": [ErrorDetail(message, code="mfa_invalid_code")]})


def auth_result(user, tokens):
    return {"status": "authenticated", **tokens, "user": MeSerializer(user).data, "shops": memberships_for(user)}


def complete_login(user, request, *, shared_device):
    """Dernière étape, commune au mot de passe seul et au mot de passe + 2FA."""
    lockout.reset_failures(user.email)
    session, tokens = open_session(user, request, shared_device=shared_device)
    user.last_login = timezone.now()
    user.save(update_fields=["last_login"])
    record("login_succeeded", request, actor=user, shared_device=shared_device)
    note_device(user, session, request)
    return auth_result(user, tokens)


class PublicAuthView(APIView):
    """Routes appelées sans être connecté : elles ont leurs propres limites de débit."""

    authentication_classes = []
    permission_classes = [AllowAny]


def email_taken():
    return ProblemError(409, "email_taken", "Cette adresse a déjà un compte. Connectez-vous, ou réinitialisez votre mot de passe.")


def open_account(request, pending, password, conflict, *, email_verified):
    """
    Crée le compte, sa boutique et sa première session : fin commune des deux inscriptions
    (en une étape, ou après le lien de confirmation). `conflict` est l'erreur si l'adresse est prise ;
    `email_verified` dit au journal si la personne a prouvé qu'elle contrôle la boîte mail.
    """
    if User.objects.filter(email=pending["email"]).exists():
        raise conflict()
    user = User(email=pending["email"], first_name=pending["first_name"], last_name=pending["last_name"])
    user.shop_name = pending["shop_name"]  # lu par le validateur de similarité
    validate_new_password(password, user)
    try:
        with transaction.atomic():
            user.set_password(password)
            user.save()
            shop = create_shop_for_owner(user, pending["shop_name"], pending.get("plan", "free"))
    except IntegrityError:  # deux envois simultanés pour la même adresse
        raise conflict()

    record("signup_completed", request, actor=user, email_verified=email_verified)
    record("shop_created", request, actor=user, shop=shop, plan=shop.plan)
    session, tokens = open_session(user, request)
    note_device(user, session, request)
    return Response(auth_result(user, tokens), status=status.HTTP_201_CREATED)


class SignupView(PublicAuthView):
    """
    Deux modes, choisis par SIGNUP_EMAIL_VERIFICATION (contrat §2.5) :
    - avec e-mail : étape 1 de l'inscription. La réponse est toujours 202, que l'adresse soit libre
      ou non : l'inscription ne permet pas de savoir qui a un compte. Seul le contenu de l'e-mail diffère ;
    - sans e-mail : le compte est créé tout de suite (201), avec le mot de passe du formulaire.
    """

    def get(self, request):
        # Le front demande quel formulaire afficher : avec ou sans mot de passe.
        return Response({"email_verification": settings.SIGNUP_EMAIL_VERIFICATION})

    def post(self, request):
        if not settings.SIGNUP_EMAIL_VERIFICATION:
            return self.direct(request)
        enforce("signup:ip", request.client_ip, policy.SIGNUP_IP_LIMIT)
        serializer = SignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        enforce("signup:email", fingerprint(data["email"]), policy.SIGNUP_EMAIL_LIMIT)

        if User.objects.filter(email=data["email"]).exists():
            emails.send_signup_existing(data["email"])
        else:
            # Rien n'est stocké tant que le lien n'est pas ouvert : les données vivent dans le jeton signé.
            token = signing.dumps(data, salt=SIGNUP_SALT, compress=True)
            emails.send_signup_link(data["email"], data["first_name"], token)

        return Response(
            {"detail": "Si cette adresse peut être utilisée, un e-mail vient de partir. Le lien est valable 24 h."},
            status=status.HTTP_202_ACCEPTED,
        )

    def direct(self, request):
        """
        Sans e-mail, on ne peut plus taire qu'une adresse est prise : la réponse 409 le dit.
        Le mot de passe est vérifié avant les compteurs (un mot de passe trop faible ne coûte pas
        un essai), puis 5 inscriptions par heure et par IP, 3 par adresse, freinent le balayage.
        """
        serializer = DirectSignupSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        candidate = User(email=data["email"], first_name=data["first_name"], last_name=data["last_name"])
        candidate.shop_name = data["shop_name"]
        validate_new_password(data["password"], candidate)

        enforce("signup:ip", request.client_ip, policy.SIGNUP_IP_LIMIT)
        enforce("signup:email", fingerprint(data["email"]), policy.SIGNUP_EMAIL_LIMIT)
        return open_account(request, data, data["password"], email_taken, email_verified=False)


class SignupCompleteView(PublicAuthView):
    """
    Étape 2 : le mot de passe est choisi par la personne qui a ouvert le lien, donc qui contrôle
    la boîte mail. Un attaquant ne peut pas pré-créer un compte au nom de quelqu'un d'autre.
    """

    def post(self, request):
        enforce("signup_complete:ip", request.client_ip, policy.SIGNUP_COMPLETE_IP_LIMIT)
        serializer = SignupCompleteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            pending = signing.loads(
                serializer.validated_data["token"],
                salt=SIGNUP_SALT,
                max_age=policy.SIGNUP_TOKEN_MAX_AGE,
            )
        except signing.BadSignature:
            raise link_error()
        # Adresse prise entre-temps, ou lien déjà utilisé (deux onglets) : le lien ne sert plus.
        return open_account(request, pending, serializer.validated_data["password"], link_error, email_verified=True)


class LoginView(PublicAuthView):
    def post(self, request):
        enforce("login:ip", request.client_ip, policy.LOGIN_IP_LIMIT)
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        shared_device = serializer.validated_data["shared_device"]
        lockout.ensure_not_locked(email)

        # Pour un e-mail inconnu, Django hache quand même un mot de passe factice :
        # le temps de réponse ne trahit pas l'existence du compte.
        user = authenticate(request._request, email=email, password=serializer.validated_data["password"])
        if user is None:
            remaining = lockout.record_failure(email, request, "login_failed")
            if remaining == 0:
                raise lockout.locked_error(LOCK_SECONDS)
            raise ProblemError(
                401,
                "invalid_credentials",
                "E-mail ou mot de passe incorrect.",
                attempts_remaining=remaining if remaining <= policy.LOGIN_WARNING_FROM else None,
            )

        expires = user.temporary_password_expires_at
        if user.must_change_password and expires is not None and expires < timezone.now():
            # Le mot de passe est juste : le dire ne renseigne personne. Il faut en demander un nouveau.
            raise ProblemError(
                401,
                "temporary_password_expired",
                "Ce mot de passe provisoire a expiré. Demandez-en un nouveau au propriétaire de la boutique.",
            )

        if mfa.is_enabled(user):
            # Le compteur d'échecs n'est pas remis à zéro ici : connaître le mot de passe
            # ne doit pas permettre de deviner les codes 2FA à l'infini.
            token = signing.dumps(
                {"uid": str(user.pk), "nonce": secrets.token_urlsafe(12), "shared": shared_device}, salt=MFA_SALT
            )
            return Response(
                {
                    "status": "mfa_required",
                    "mfa_token": token,
                    "methods": ["totp", "recovery_code"],
                    "expires_in": int(policy.MFA_TOKEN_MAX_AGE.total_seconds()),
                }
            )
        return Response(complete_login(user, request, shared_device=shared_device))


class LoginMfaView(PublicAuthView):
    """
    Étape 2 du login avec 2FA. Le mfa_token dure 5 min, sert une seule fois et accepte
    3 essais. Chaque code faux compte aussi dans le verrou du compte.
    """

    def post(self, request):
        enforce("login_mfa:ip", request.client_ip, policy.LOGIN_MFA_IP_LIMIT)
        serializer = LoginMfaSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            payload = signing.loads(
                serializer.validated_data["mfa_token"], salt=MFA_SALT, max_age=policy.MFA_TOKEN_MAX_AGE
            )
        except signing.BadSignature:
            raise mfa_token_error()
        user = User.objects.filter(pk=payload["uid"], is_active=True).first()
        if user is None:
            raise mfa_token_error()
        lockout.ensure_not_locked(user.email)

        used_key, attempts_key = f"mfa:used:{payload['nonce']}", f"mfa:attempts:{payload['nonce']}"
        ttl = int(policy.MFA_TOKEN_MAX_AGE.total_seconds())
        if cache.get(used_key):
            raise mfa_token_error()
        attempts = incr(attempts_key, ttl)
        if attempts > policy.MFA_TOKEN_ATTEMPTS:
            raise mfa_token_error()

        if mfa.verify(user, serializer.validated_data["code"], request) is None:
            remaining = lockout.record_failure(user.email, request, "mfa_failed")
            if remaining == 0:
                raise lockout.locked_error(LOCK_SECONDS)
            left = policy.MFA_TOKEN_ATTEMPTS - attempts
            if left == 0:
                raise mfa_token_error()
            raise ProblemError(401, "mfa_invalid_code", "Code incorrect.", attempts_remaining=min(left, remaining))

        # Un mfa_token ne sert qu'une fois, même si deux requêtes arrivent en même temps.
        if not cache.add(used_key, 1, timeout=ttl):
            raise mfa_token_error()
        return Response(complete_login(user, request, shared_device=payload["shared"]))


class TokenRefreshView(PublicAuthView):
    def post(self, request):
        serializer = RefreshSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        return Response(rotate_refresh(serializer.validated_data["refresh"], request))


class LogoutView(PublicAuthView):
    """
    Révoque la session, que l'access token soit encore valable ou que seul le refresh
    soit fourni. Toujours 204 : se déconnecter deux fois n'est pas une erreur.
    """

    def post(self, request):
        serializer = LogoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        session = None
        try:
            authenticated = SessionJWTAuthentication().authenticate(request)
            session = authenticated[1] if authenticated else None
        except AuthenticationFailed:
            pass
        if session is None and "refresh" in serializer.validated_data:
            try:
                token = RefreshToken(serializer.validated_data["refresh"])
                session = find_session(token.get("sid"), token.get(api_settings.USER_ID_CLAIM))
            except TokenError:
                pass
        if session is not None and session.revoked_at is None:
            revoke(session, UserSession.RevokeReason.LOGOUT)
            record("logged_out", request, actor=session.user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class UnlockView(PublicAuthView):
    """Lien « Débloquer mon compte » de l'e-mail de verrou."""

    def post(self, request):
        enforce("unlock:ip", request.client_ip, policy.UNLOCK_IP_LIMIT)
        serializer = TokenSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = lockout.unlock(serializer.validated_data["token"])
        if user is None:
            raise link_error()
        record("account_unlocked", request, actor=user)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ForgotPasswordView(PublicAuthView):
    def post(self, request):
        enforce("forgot:ip", request.client_ip, policy.FORGOT_IP_LIMIT)
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"]
        enforce("forgot:email", fingerprint(email), policy.FORGOT_EMAIL_LIMIT)

        user = User.objects.filter(email=email, is_active=True, is_demo=False).first()
        if user is not None:
            uid = urlsafe_base64_encode(force_bytes(user.pk))
            emails.send_password_reset(user, uid, default_token_generator.make_token(user))
        return Response(
            {"detail": "Si un compte existe pour cette adresse, un e-mail vient de partir. Le lien est valable 30 min."},
            status=status.HTTP_202_ACCEPTED,
        )


class ResetPasswordView(PublicAuthView):
    """
    Le jeton de Django dépend du hash actuel du mot de passe : dès que le mot de passe
    change, le lien meurt. Il ne sert donc qu'une fois.
    """

    def post(self, request):
        enforce("reset:ip", request.client_ip, policy.RESET_IP_LIMIT)
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        user = _user_from_uid(data["uid"])
        if user is None or user.is_demo or not default_token_generator.check_token(user, data["token"]):
            raise link_error()

        validate_new_password(data["password"], user)
        user.set_password(data["password"])
        user.save(update_fields=["password"])
        revoke_all(user, UserSession.RevokeReason.PASSWORD_RESET)
        lockout.clear(user.email)
        record("password_reset", request, actor=user)
        emails.send_security_alert(user, "password_reset", request)
        return Response(status=status.HTTP_204_NO_CONTENT)


def _user_from_uid(uid):
    try:
        return User.objects.get(pk=force_str(urlsafe_base64_decode(uid)), is_active=True)
    except (User.DoesNotExist, DjangoValidationError, ValueError, TypeError, OverflowError):
        return None


class ReauthView(APIView):
    """Ouvre la fenêtre de confirmation renforcée (10 min) sur la session courante."""

    def post(self, request):
        enforce("reauth", str(request.auth.pk), policy.REAUTH_SESSION_LIMIT)
        serializer = ReauthSerializer(data=request.data, context={"user": request.user})
        serializer.is_valid(raise_exception=True)
        field, value = serializer.validated_data["field"], serializer.validated_data["value"]
        if field == "code":
            confirmed = mfa.verify(request.user, value, request) is not None
        else:
            confirmed = request.user.check_password(value)
        if not confirmed:
            record("reauth_failed", request, actor=request.user, method=field)
            if field == "code":
                raise code_error("Code incorrect.")
            raise ValidationError({"password": [ErrorDetail("Mot de passe incorrect.", code="invalid_password")]})

        until = timezone.now() + policy.REAUTH_WINDOW
        UserSession.objects.filter(pk=request.auth.pk).update(reauth_until=until)
        record("reauth_succeeded", request, actor=request.user, method=field)
        return Response({"reauth_until": until})


class MeView(APIView):
    allowed_with_temporary_password = True

    def get(self, request):
        return Response(MeSerializer(request.user).data)

    def patch(self, request):
        serializer = MeUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(MeSerializer(request.user).data)


class MyShopsView(APIView):
    allowed_with_temporary_password = True

    def get(self, request):
        return Response(memberships_for(request.user))


class PasswordChangeView(APIView):
    """Le mot de passe actuel sert de confirmation. Les autres sessions sont fermées, pas celle-ci."""

    allowed_with_temporary_password = True

    def post(self, request):
        if request.user.is_demo:
            raise demo_error()
        enforce("password_change", str(request.auth.pk), policy.PASSWORD_CHANGE_SESSION_LIMIT)
        serializer = PasswordChangeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if not request.user.check_password(data["current_password"]):
            raise ValidationError(
                {"current_password": [ErrorDetail("Mot de passe actuel incorrect.", code="invalid_password")]}
            )

        validate_new_password(data["password"], request.user)
        request.user.set_password(data["password"])
        # Un mot de passe choisi par la personne elle-même remplace le provisoire : le compte est libéré.
        request.user.must_change_password = False
        request.user.temporary_password_expires_at = None
        request.user.save(update_fields=["password", "must_change_password", "temporary_password_expires_at"])
        revoke_all(request.user, UserSession.RevokeReason.PASSWORD_CHANGED, keep=request.auth)
        record("password_changed", request, actor=request.user)
        emails.send_security_alert(request.user, "password_changed", request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SessionListView(APIView):
    def get(self, request):
        now = timezone.now()
        sessions = UserSession.objects.filter(user=request.user, revoked_at__isnull=True, expires_at__gt=now)
        active = [s for s in sessions.order_by("-last_seen_at") if s.state(now) is None]
        return Response(SessionSerializer(active, many=True, context={"current": request.auth}).data)


class SessionDetailView(APIView):
    def delete(self, request, session_id):
        session = UserSession.objects.filter(pk=session_id, user=request.user, revoked_at__isnull=True).first()
        if session is None:
            raise NotFound("Session introuvable.")
        revoke(session, UserSession.RevokeReason.BY_USER)
        record("session_revoked", request, actor=request.user, session=str(session.pk), device=session.device_label)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RevokeOtherSessionsView(APIView):
    """« Déconnecter partout ailleurs » : toutes les sessions sauf celle-ci."""

    def post(self, request):
        closed = revoke_all(request.user, UserSession.RevokeReason.BY_USER, keep=request.auth)
        record("session_revoked", request, actor=request.user, others=closed)
        return Response(status=status.HTTP_204_NO_CONTENT)


class SecurityEventsView(APIView):
    """La page « Sécurité » du marchand : ses propres événements de sécurité, 90 jours."""

    def get(self, request):
        since = timezone.now() - policy.SECURITY_EVENTS_VISIBLE_FOR
        events = AuditEvent.objects.filter(
            actor_id=request.user.pk, category=Category.SECURITY, created_at__gte=since
        ).order_by("-id")
        paginator = PagePagination()
        page = paginator.paginate_queryset(events, request, view=self)
        return paginator.get_paginated_response(SecurityEventSerializer(page, many=True).data)


class MfaSetupView(APIView):
    def post(self, request):
        if request.user.is_demo:
            raise demo_error()
        if mfa.is_enabled(request.user):
            raise ProblemError(409, "mfa_already_enabled", "La double authentification est déjà active.")
        return Response(mfa.start_setup(request.user))


class MfaConfirmView(APIView):
    """Le premier code valide prouve que l'application est bien configurée : la 2FA devient active."""

    def post(self, request):
        if request.user.is_demo:
            raise demo_error()
        enforce("mfa_manage", str(request.auth.pk), policy.MFA_MANAGE_SESSION_LIMIT)
        serializer = MfaCodeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if mfa.is_enabled(request.user):
            raise ProblemError(409, "mfa_already_enabled", "La double authentification est déjà active.")
        if not mfa.has_pending_setup(request.user):
            raise ProblemError(409, "mfa_setup_required", "Commencez par lancer l'activation.")
        codes = mfa.confirm_setup(request.user, serializer.validated_data["code"])
        if codes is None:
            raise code_error()
        record("mfa_enabled", request, actor=request.user)
        return Response({"recovery_codes": codes})


class MfaDisableView(APIView):
    """Exige une confirmation renforcée, qui demande elle-même un code 2FA quand la 2FA est active."""

    def post(self, request):
        if request.user.is_demo:
            raise demo_error()
        require_reauth(request)
        if not mfa.is_enabled(request.user):
            raise ProblemError(409, "mfa_not_enabled", "La double authentification n'est pas active.")
        mfa.disable(request.user)
        record("mfa_disabled", request, actor=request.user)
        emails.send_security_alert(request.user, "mfa_disabled", request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class RecoveryCodesView(APIView):
    def post(self, request):
        if request.user.is_demo:
            raise demo_error()
        require_reauth(request)
        if not mfa.is_enabled(request.user):
            raise ProblemError(409, "mfa_not_enabled", "La double authentification n'est pas active.")
        codes = mfa.regenerate_recovery_codes(request.user)
        record("recovery_codes_regenerated", request, actor=request.user)
        return Response({"recovery_codes": codes})
