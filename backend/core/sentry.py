"""
Surveillance des erreurs avec Sentry (contrat docs/chantier-a2-fondations.md §4).

Éteint tant que SENTRY_DSN est vide (en local, dans les tests). Quand il est actif, rien de personnel ne part :
ni corps de requête, ni cookie, ni en-tête d'authentification, ni identifiant de compte, ni texte d'erreur SQL,
et un dernier filtre remplace toute chaîne qui ressemble à un e-mail ou à un numéro ivoirien.
"""

import logging
import re

REDACTED = "[retiré]"

# En-têtes qui identifient quelqu'un ou ouvrent l'API : jamais envoyés.
SENSITIVE_HEADERS = {
    "authorization",
    "cookie",
    "set-cookie",
    "x-akwaba-bff",
    "x-client-ip",
    "x-client-ua",
    "x-device-id",
    "idempotency-key",
    "x-forwarded-for",
    "x-real-ip",
    "user-agent",
}
# Sur PostgreSQL, ces exceptions citent la valeur fautive : Key (email)=(adjoua@…) already exists.
DATABASE_ERRORS = {
    "IntegrityError",
    "DataError",
    "OperationalError",
    "ProgrammingError",
    "InternalError",
    "DatabaseError",
    "NotSupportedError",
    "UniqueViolation",
    "ForeignKeyViolation",
    "NotNullViolation",
    "CheckViolation",
    "StringDataRightTruncation",
    "InvalidTextRepresentation",
}
NOISY_BREADCRUMBS = {"query", "db", "log", "logging", "console"}

EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
PHONE = re.compile(r"\+225[\d\s.-]{8,}|\b0[1257]\d{8}\b")


def redact_text(text):
    return PHONE.sub(REDACTED, EMAIL.sub(REDACTED, text))


def _redact_tree(value):
    if isinstance(value, str):
        return redact_text(value)
    if isinstance(value, dict):
        return {key: _redact_tree(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_redact_tree(item) for item in value]
    return value


def _scrub_request(request):
    for key in ("data", "cookies", "query_string", "env", "api_target"):
        request.pop(key, None)
    url = request.get("url")
    if isinstance(url, str):
        request["url"] = url.split("?", 1)[0].split("#", 1)[0]
    headers = request.get("headers")
    if isinstance(headers, dict):
        request["headers"] = {k: v for k, v in headers.items() if k.lower() not in SENSITIVE_HEADERS}


def before_send(event, hint):
    event.pop("user", None)
    event.pop("server_name", None)
    if isinstance(event.get("request"), dict):
        _scrub_request(event["request"])

    for exception in (event.get("exception") or {}).get("values") or []:
        if exception.get("type") in DATABASE_ERRORS:
            exception["value"] = exception["type"]
        for frame in (exception.get("stacktrace") or {}).get("frames") or []:
            frame.pop("vars", None)

    event["breadcrumbs"] = {"values": [b for b in (event.get("breadcrumbs") or {}).get("values") or [] if _keep_breadcrumb(b)]}
    return _redact_tree(event)


def _keep_breadcrumb(crumb):
    return crumb.get("category") not in NOISY_BREADCRUMBS and crumb.get("type") not in ("query", "http")


def before_breadcrumb(crumb, hint):
    return crumb if _keep_breadcrumb(crumb) else None


def init_sentry(dsn, environment="production", **overrides):
    """Active Sentry. Sans DSN, ne fait rien : `sentry_sdk.init` n'est jamais appelé."""
    if not dsn:
        return False
    import sentry_sdk
    from sentry_sdk.integrations.django import DjangoIntegration
    from sentry_sdk.integrations.logging import LoggingIntegration

    options = {
        "dsn": dsn,
        "environment": environment or "production",
        "send_default_pii": False,
        "include_local_variables": False,
        "traces_sample_rate": 0,
        "max_request_body_size": "never",
        "before_send": before_send,
        "before_breadcrumb": before_breadcrumb,
        # Pas de fil d'Ariane de journalisation ; une erreur journalisée reste un événement, filtré comme les autres.
        "integrations": [DjangoIntegration(), LoggingIntegration(level=None, event_level=logging.ERROR)],
        **overrides,
    }
    sentry_sdk.init(**options)
    return True


def tag_request(request_id):
    """Relie une erreur Sentry à la ligne de log et à l'en-tête X-Request-ID de la même requête."""
    import sentry_sdk

    if sentry_sdk.get_client().is_active():
        sentry_sdk.set_tag("request_id", request_id)


def capture_failure(name):
    """Prévient Sentry qu'une tâche d'exploitation a échoué, sans aucun détail."""
    import sentry_sdk

    if sentry_sdk.get_client().is_active():
        sentry_sdk.capture_message(f"{name} a échoué", level="error")
