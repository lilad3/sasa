import hmac
import ipaddress
import re
import secrets

from django.conf import settings

from .exceptions import problem_json_response

SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")


class RequestIdMiddleware:
    """Donne un identifiant à chaque requête. Il revient dans l'en-tête X-Request-ID et dans chaque erreur."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        incoming = request.headers.get("X-Request-ID", "")
        request.request_id = incoming if SAFE_ID.match(incoming) else f"req_{secrets.token_urlsafe(15)}"
        response = self.get_response(request)
        response["X-Request-ID"] = request.request_id
        return response


class BffMiddleware:
    """
    /api/v1/ n'est ouvert qu'au serveur Next (BFF), qui prouve son identité avec un secret partagé.

    Next appelle Django de serveur à serveur : sans lui, tous les visiteurs auraient l'IP du
    serveur Next et la limitation par IP bloquerait tout le monde ou personne. Lui seul peut donc
    transmettre l'IP et l'appareil réels du visiteur. Sans secret valide, ces en-têtes sont ignorés.
    """

    def __init__(self, get_response):
        self.get_response = get_response
        self.secret = settings.BFF_SHARED_SECRET.encode()

    def __call__(self, request):
        request.client_ip = request.META.get("REMOTE_ADDR", "")
        request.client_ua = request.META.get("HTTP_USER_AGENT", "")[:300]
        request.device_id = ""

        if request.path.startswith("/api/v1/"):
            if not self._is_bff(request.headers.get("X-Akwaba-Bff", "")):
                return problem_json_response(
                    request, 403, "bff_required", "Cette API n'est accessible que par l'application Akwaba."
                )
            request.client_ip = _clean_ip(request.headers.get("X-Client-IP", "")) or request.client_ip
            request.client_ua = request.headers.get("X-Client-UA", "")[:300]
            device_id = request.headers.get("X-Device-Id", "")
            request.device_id = device_id if SAFE_ID.match(device_id) else ""

        return self.get_response(request)

    def _is_bff(self, value):
        # Comparaison à temps constant : la durée ne révèle pas combien de caractères sont justes.
        return bool(self.secret) and hmac.compare_digest(value.encode(), self.secret)


def _clean_ip(value):
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return ""
