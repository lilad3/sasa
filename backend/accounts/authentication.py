from django.utils import timezone
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.exceptions import ExpiredTokenError, TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import AccessToken

from . import policy
from .models import UserSession
from .sessions import SESSION_ERRORS, find_session


class SessionJWTAuthentication(BaseAuthentication):
    """
    Bearer JWT + session serveur. Un token bien signé ne suffit pas : sa session (`sid`)
    doit encore être active. Déconnexion, « déconnecter partout » ou changement de mot de
    passe coupent donc l'accès immédiatement.
    """

    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header or header[0].lower() != b"bearer":
            return None
        if len(header) != 2:
            raise AuthenticationFailed(SESSION_ERRORS["token_invalid"], code="token_invalid")
        try:
            token = AccessToken(header[1].decode())
        except ExpiredTokenError:
            raise AuthenticationFailed("Le token d'accès a expiré.", code="token_expired")
        except (TokenError, UnicodeDecodeError):
            raise AuthenticationFailed(SESSION_ERRORS["token_invalid"], code="token_invalid")

        session = find_session(token.get("sid"), token.get(api_settings.USER_ID_CLAIM))
        if session is None or not session.user.is_active:
            raise AuthenticationFailed(SESSION_ERRORS["token_invalid"], code="token_invalid")
        now = timezone.now()
        if code := session.state(now):
            raise AuthenticationFailed(SESSION_ERRORS[code], code=code)
        if now - session.last_seen_at >= policy.LAST_SEEN_UPDATE_INTERVAL:
            UserSession.objects.filter(pk=session.pk).update(last_seen_at=now)
        return session.user, session

    def authenticate_header(self, request):
        return 'Bearer realm="akwaba"'
