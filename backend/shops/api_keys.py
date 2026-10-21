"""
Clés de l'API publique (docs/contrat-api.md §2.12) : création, liste, révocation, et
l'authentification des appels qui les présentent.

Format : akw_live_<identifiant 8>_<secret 32>. Le préfixe est reconnu par les outils qui
cherchent des secrets oubliés dans le code. Seul le SHA-256 du secret est gardé : le secret
est assez aléatoire (≈ 190 bits) pour qu'un hachage rapide suffise, et la comparaison se fait
à temps constant.
"""

import hashlib
import hmac
import re
import secrets
import string
from datetime import timedelta

from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.authentication import BaseAuthentication, get_authorization_header
from rest_framework.exceptions import NotFound
from rest_framework.response import Response

from accounts import emails
from accounts.sessions import require_reauth
from audit.services import record
from core.exceptions import ProblemError

from . import plans
from .models import ApiKey
from .permissions import ShopScopedView
from .storefront import plain_text

KEY = re.compile(r"^akw_live_([A-Za-z0-9]{8})_([A-Za-z0-9]{32})$")
ALPHABET = string.ascii_letters + string.digits
SCOPES = {"catalog:read": "Lire le catalogue", "orders:read": "Lire les commandes et les clients"}
MAX_ACTIVE_KEYS = 10
LAST_USED_UPDATE_INTERVAL = timedelta(minutes=1)
# Comparé quand l'identifiant n'existe pas : la réponse prend le même temps qu'avec une vraie clé.
DUMMY_HASH = hashlib.sha256(b"akwaba-no-such-key").hexdigest()


def _random(length):
    return "".join(secrets.choice(ALPHABET) for _ in range(length))


def hash_secret(secret):
    return hashlib.sha256(secret.encode()).hexdigest()


def key_payload(key):
    return {
        "id": str(key.pk),
        "name": key.name,
        "prefix": f"akw_live_{key.key_id}_",
        "scopes": key.scopes,
        "created_at": key.created_at,
        "expires_at": key.expires_at,
        "last_used_at": key.last_used_at,
        "last_used_ip": key.last_used_ip,
        "revoked_at": key.revoked_at,
        "active": key.revoked_at is None and (key.expires_at is None or key.expires_at > timezone.now()),
    }


class ApiKeyCreateSerializer(serializers.Serializer):
    name = serializers.CharField(min_length=2, max_length=60, validators=[plain_text])
    scopes = serializers.ListField(child=serializers.ChoiceField(choices=list(SCOPES)), min_length=1, max_length=len(SCOPES))
    expires_in_days = serializers.ChoiceField(choices=[30, 90, 365], allow_null=True, required=False, default=90)


class ApiKeyListView(ShopScopedView):
    permission_by_method = {"GET": "shop.manage", "POST": "shop.manage"}

    def get(self, request, slug):
        return Response([key_payload(key) for key in ApiKey.objects.for_shop(self.shop)])

    def post(self, request, slug):
        if request.user.is_demo:
            raise ProblemError(403, "demo_restricted", "Action désactivée sur les comptes de démonstration.")
        plans.require_feature(self.shop, "api_keys")
        serializer = ApiKeyCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        require_reauth(request)
        active = ApiKey.objects.for_shop(self.shop).filter(revoked_at__isnull=True)
        if active.count() >= MAX_ACTIVE_KEYS:
            raise ProblemError(409, "too_many_api_keys", f"{MAX_ACTIVE_KEYS} clés actives au maximum : révoquez-en une.")

        data = serializer.validated_data
        key_id = _random(8)
        while ApiKey.objects.filter(key_id=key_id).exists():
            key_id = _random(8)
        secret = _random(32)
        days = data.get("expires_in_days")
        key = ApiKey.objects.create(
            shop=self.shop,
            name=data["name"],
            key_id=key_id,
            secret_hash=hash_secret(secret),
            scopes=sorted(set(data["scopes"])),
            created_by=request.user,
            expires_at=timezone.now() + timedelta(days=days) if days else None,
        )
        record("api_key_created", request, actor=request.user, shop=self.shop, target=("api_key", key.pk, key.name), scopes=key.scopes)
        emails.send_security_alert(request.user, "api_key_created", request)
        # La seule fois où la clé complète existe hors du logiciel qui l'utilisera.
        return Response({**key_payload(key), "key": f"akw_live_{key_id}_{secret}"}, status=status.HTTP_201_CREATED)


class ApiKeyDetailView(ShopScopedView):
    permission_by_method = {"DELETE": "shop.manage"}

    def delete(self, request, slug, key_id):
        key = ApiKey.objects.for_shop(self.shop).filter(pk=key_id).first()
        if key is None:
            raise NotFound("Clé introuvable.")
        if key.revoked_at is None:
            key.revoked_at = timezone.now()
            key.save(update_fields=["revoked_at"])
            record("api_key_revoked", request, actor=request.user, shop=self.shop, target=("api_key", key.pk, key.name))
        return Response(status=status.HTTP_204_NO_CONTENT)


class ApiClient:
    """L'appelant d'une clé API : pas un compte, mais DRF a besoin d'un « utilisateur » authentifié."""

    is_authenticated = True
    is_anonymous = False
    pk = None

    def __init__(self, key):
        self.key = key


def invalid_key():
    return ProblemError(401, "api_key_invalid", "Clé API invalide, expirée ou révoquée.")


class ApiKeyAuthentication(BaseAuthentication):
    def authenticate(self, request):
        header = get_authorization_header(request).split()
        if not header or header[0].lower() != b"bearer" or len(header) != 2:
            return None
        match = KEY.match(header[1].decode(errors="replace"))
        if match is None:
            raise invalid_key()
        key_id, secret = match.groups()
        key = ApiKey.objects.select_related("shop").filter(key_id=key_id).first()
        expected = key.secret_hash if key else DUMMY_HASH
        if not hmac.compare_digest(hash_secret(secret), expected) or key is None:
            raise invalid_key()
        now = timezone.now()
        if key.revoked_at is not None or (key.expires_at is not None and key.expires_at <= now):
            raise invalid_key()
        if key.last_used_at is None or now - key.last_used_at >= LAST_USED_UPDATE_INTERVAL:
            ApiKey.objects.filter(pk=key.pk).update(last_used_at=now, last_used_ip=getattr(request, "client_ip", "") or None)
        return ApiClient(key), key

    def authenticate_header(self, request):
        return 'Bearer realm="akwaba-public"'
