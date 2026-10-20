import math
import time

from django.core.cache import cache
from django.utils.crypto import salted_hmac

from .exceptions import ProblemError


def fingerprint(value):
    """Empreinte d'une valeur sensible (un e-mail) pour les clés de cache : rien n'est stocké en clair."""
    return salted_hmac("akwaba.ratelimit", value).hexdigest()[:32]


def incr(key, timeout):
    """Incrémente un compteur du cache, en le créant au besoin."""
    cache.add(key, 0, timeout=timeout)
    try:
        return cache.incr(key)
    except ValueError:  # la clé a expiré entre add() et incr()
        cache.set(key, 1, timeout=timeout)
        return 1


def hit(scope, ident, limit):
    """
    Compte une tentative dans une fenêtre fixe, `limit` valant (nombre, fenêtre en secondes).
    Renvoie None si la limite est respectée, sinon les secondes avant la fenêtre suivante.
    """
    count, window = limit
    now = time.time()
    bucket = int(now // window)
    if incr(f"rl:{scope}:{ident}:{bucket}", window) > count:
        return math.ceil((bucket + 1) * window - now)
    return None


def enforce(scope, ident, limit):
    """Comme hit(), pour l'API : au-delà de la limite, 429 avec retry_after."""
    if retry_after := hit(scope, ident, limit):
        raise ProblemError(
            429,
            "too_many_requests",
            "Trop de tentatives. Réessayez dans un instant.",
            retry_after=retry_after,
        )
