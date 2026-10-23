"""Santé du service, pour un outil de surveillance de disponibilité (docs/chantier-a2-fondations.md §4.4)."""

from django.db import connection
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET

from .ratelimit import hit

HEALTH_LIMIT = (60, 60)  # par IP et par minute : un moniteur appelle toutes les 5 minutes


@never_cache
@require_GET
def healthz(request):
    """`{"ok": true}` si la base répond, sinon 503 sans aucun détail. Hors de /api/v1/ : pas de secret BFF."""
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
        retry_after = hit("healthz", request.META.get("REMOTE_ADDR", ""), HEALTH_LIMIT)
    except Exception:
        return JsonResponse({"ok": False}, status=503)
    if retry_after:
        response = JsonResponse({"ok": False}, status=429)
        response["Retry-After"] = str(retry_after)
        return response
    return JsonResponse({"ok": True})
