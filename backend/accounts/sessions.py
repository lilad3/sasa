"""Sessions serveur et tokens JWT : ouverture, rotation du refresh, révocation (docs/contrat-api.md §2.3)."""

from django.core.exceptions import ValidationError
from django.utils import timezone
from rest_framework_simplejwt.exceptions import ExpiredTokenError, TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from audit.services import record
from core.devices import device_label
from core.exceptions import ProblemError
from core.ratelimit import enforce

from . import emails, policy
from .models import UserSession

SESSION_ERRORS = {
    "session_revoked": "Cette session a été fermée. Reconnectez-vous.",
    "session_expired": "La session a expiré. Reconnectez-vous.",
    "token_invalid": "Session invalide. Reconnectez-vous.",
}


def session_error(code):
    return ProblemError(401, code, SESSION_ERRORS[code])


def open_session(user, request, *, shared_device=False):
    """Crée la session d'une nouvelle connexion et renvoie (session, paire de tokens)."""
    now = timezone.now()
    max_age = policy.SHARED_SESSION_MAX_AGE if shared_device else policy.SESSION_MAX_AGE
    user_agent = getattr(request, "client_ua", "")
    session = UserSession(
        user=user,
        shared_device=shared_device,
        ip=getattr(request, "client_ip", "") or None,
        user_agent=user_agent,
        device_label=device_label(user_agent),
        last_seen_at=now,
        expires_at=now + max_age,
    )
    refresh, access = _mint(session, now)
    session.refresh_jti = refresh["jti"]
    session.save()
    return session, token_pair(refresh, access)


def rotate_refresh(raw_token, request):
    """
    Échange un refresh contre une nouvelle paire. L'ancien refresh devient invalide :
    s'il revient plus tard, quelqu'un en a une copie, et la session est coupée.
    """
    try:
        token = RefreshToken(raw_token)
    except ExpiredTokenError:
        raise session_error("session_expired")
    except TokenError:
        raise session_error("token_invalid")

    session = find_session(token.get("sid"), token.get(api_settings.USER_ID_CLAIM))
    if session is None or not session.user.is_active:
        raise session_error("token_invalid")
    enforce("refresh", str(session.pk), policy.REFRESH_SESSION_LIMIT)

    now = timezone.now()
    if code := session.state(now):
        raise session_error(code)

    jti = token["jti"]
    if jti == session.refresh_jti:
        refresh, access = _mint(session, now)
        # Mise à jour conditionnelle : si une requête parallèle vient de faire tourner
        # le refresh, on n'écrase pas son résultat.
        rotated = UserSession.objects.filter(pk=session.pk, refresh_jti=jti, revoked_at__isnull=True).update(
            refresh_jti=refresh["jti"], previous_refresh_jti=jti, rotated_at=now, last_seen_at=now
        )
        if rotated:
            return token_pair(refresh, access)
        session.refresh_from_db()
        if session.revoked_at is not None:
            raise session_error("session_revoked")

    if (
        jti == session.previous_refresh_jti
        and session.rotated_at is not None
        and now - session.rotated_at <= policy.REFRESH_GRACE_PERIOD
    ):
        # Deux requêtes du même navigateur ont rafraîchi en même temps (docs/chantier-p5.md §5).
        # Celle-ci reçoit le refresh courant, réémis avec le même identifiant que celui de la requête
        # gagnante : si la réponse gagnante se perd (requête annulée, réseau coupé), le navigateur
        # repart quand même avec un refresh valable, au lieu de garder l'ancien et d'être pris pour
        # un voleur 10 secondes plus tard.
        refresh, access = _mint(session, now, jti=session.refresh_jti)
        return token_pair(refresh, access)

    revoke(session, UserSession.RevokeReason.REFRESH_REUSE)
    record("refresh_reuse_detected", request, actor=session.user, session=str(session.pk))
    emails.send_security_alert(session.user, "refresh_reuse_detected", request)
    raise session_error("session_revoked")


def find_session(sid, user_id):
    try:
        return UserSession.objects.select_related("user").get(pk=sid, user_id=user_id)
    except (UserSession.DoesNotExist, ValidationError, ValueError, TypeError):
        return None


def revoke(session, reason):
    UserSession.objects.filter(pk=session.pk, revoked_at__isnull=True).update(
        revoked_at=timezone.now(), revoked_reason=reason
    )


def revoke_all(user, reason, *, keep=None):
    sessions = UserSession.objects.filter(user=user, revoked_at__isnull=True)
    if keep is not None:
        sessions = sessions.exclude(pk=keep.pk)
    return sessions.update(revoked_at=timezone.now(), revoked_reason=reason)


def require_reauth(request):
    """Les actions graves exigent une confirmation récente du mot de passe ou d'un code 2FA."""
    until = request.auth.reauth_until
    if until is None or until < timezone.now():
        raise ProblemError(403, "reauth_required", "Confirmez votre identité pour continuer.")


def token_pair(refresh, access):
    pair = {
        "access": str(access),
        "access_expires_in": int(api_settings.ACCESS_TOKEN_LIFETIME.total_seconds()),
    }
    if refresh is not None:
        pair["refresh"] = str(refresh)
        pair["refresh_expires_in"] = max(0, refresh["exp"] - int(timezone.now().timestamp()))
    return pair


def _mint(session, now, jti=None):
    """Une paire de tokens pour la session ; `jti` réémet un refresh déjà en cours plutôt qu'un nouveau."""
    refresh = RefreshToken()
    if jti is not None:
        refresh[api_settings.JTI_CLAIM] = jti
    lifetime = policy.SHARED_REFRESH_TOKEN_LIFETIME if session.shared_device else api_settings.REFRESH_TOKEN_LIFETIME
    # Un refresh ne survit jamais à sa session.
    refresh.set_exp(from_time=now, lifetime=min(lifetime, session.expires_at - now))
    refresh[api_settings.USER_ID_CLAIM] = str(session.user_id)
    refresh["sid"] = str(session.pk)
    return refresh, refresh.access_token
