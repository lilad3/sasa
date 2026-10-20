"""Format d'erreur unique de l'API (docs/contrat-api.md §3.1), inspiré de la RFC 9457."""

import logging
import math

from django.conf import settings
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404, JsonResponse
from rest_framework import exceptions
from rest_framework.response import Response

logger = logging.getLogger("akwaba")

PROBLEM_CONTENT_TYPE = "application/problem+json"

# Codes par défaut de DRF → codes du contrat (§3.2).
DRF_CODES = {
    "not_authenticated": "not_authenticated",
    "authentication_failed": "token_invalid",
    "permission_denied": "permission_denied",
    "not_found": "not_found",
    "method_not_allowed": "method_not_allowed",
    "not_acceptable": "not_acceptable",
    "unsupported_media_type": "unsupported_media_type",
    "parse_error": "parse_error",
    "throttled": "too_many_requests",
}


class ProblemError(exceptions.APIException):
    """Erreur au format du contrat : un statut, un code stable et un texte de secours."""

    def __init__(self, status_code, code, detail, **extra):
        super().__init__(detail=detail, code=code)
        self.status_code = status_code
        self.code = code
        self.extra = extra


def problem_body(request, status_code, code, detail, **extra):
    body = {"status": status_code, "code": code, "detail": str(detail)}
    body.update((key, value) for key, value in extra.items() if value is not None)
    body["request_id"] = getattr(request, "request_id", None)
    return body


def problem_json_response(request, status_code, code, detail, **extra):
    """Même format, pour le code qui tourne hors de DRF (middlewares, 404 et 500 de Django)."""
    return JsonResponse(
        problem_body(request, status_code, code, detail, **extra),
        status=status_code,
        content_type=PROBLEM_CONTENT_TYPE,
        json_dumps_params={"ensure_ascii": False},
    )


def problem_exception_handler(exc, context):
    # Import local : la classe d'authentification importe ce module pendant que DRF charge rest_framework.views.
    from rest_framework.views import set_rollback

    request = context.get("request")
    if isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    set_rollback()
    if not isinstance(exc, exceptions.APIException):
        # Jamais de trace ni de message interne dans la réponse :
        # le request_id suffit pour retrouver l'erreur dans les logs.
        logger.exception("Erreur non gérée (request_id=%s)", getattr(request, "request_id", "-"))
        if settings.DEBUG:
            return None
        return _response(request, 500, "server_error", "Une erreur interne est survenue.")

    extra = {}
    if isinstance(exc, ProblemError):
        code, detail, extra = exc.code, exc.detail, dict(exc.extra)
    elif isinstance(exc, exceptions.ValidationError):
        code, detail = "validation_error", "Certains champs sont invalides."
        extra["errors"] = _field_errors(exc.get_full_details())
    else:
        given = exc.get_codes()
        explicit = isinstance(given, str) and given != exc.default_code
        code = given if explicit else DRF_CODES.get(exc.default_code, exc.default_code)
        detail = exc.detail
    if isinstance(exc, exceptions.Throttled) and exc.wait is not None:
        extra["retry_after"] = math.ceil(exc.wait)

    headers = {}
    if extra.get("retry_after") is not None:
        headers["Retry-After"] = str(extra["retry_after"])
    if getattr(exc, "auth_header", None):
        headers["WWW-Authenticate"] = exc.auth_header
    return _response(request, exc.status_code, code, detail, headers=headers, **extra)


def _response(request, status_code, code, detail, headers=None, **extra):
    return Response(
        problem_body(request, status_code, code, detail, **extra),
        status=status_code,
        headers=headers,
        content_type=PROBLEM_CONTENT_TYPE,
    )


def _field_errors(details, prefix=""):
    """Aplatit les erreurs DRF en { "champ": [{code, message}] }. Champ imbriqué : "customer.phone"."""
    if isinstance(details, dict):
        flat = {}
        for key, value in details.items():
            flat.update(_field_errors(value, f"{prefix}.{key}" if prefix else key))
        return flat
    if all(isinstance(item, dict) and set(item) == {"message", "code"} for item in details):
        return {prefix or "non_field_errors": [{"code": d["code"], "message": str(d["message"])} for d in details]}
    flat = {}
    for index, item in enumerate(details):  # liste de sous-objets (many=True)
        flat.update(_field_errors(item, f"{prefix}.{index}" if prefix else str(index)))
    return flat


def not_found_view(request, exception=None):
    return problem_json_response(request, 404, "not_found", "Introuvable.")


def server_error_view(request):
    return problem_json_response(request, 500, "server_error", "Une erreur interne est survenue.")
