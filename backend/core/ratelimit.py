import hashlib
import math
import random
import time
from datetime import timedelta

from django.db import connection
from django.utils import timezone
from django.utils.crypto import salted_hmac

from .exceptions import ProblemError
from .models import RateCounter

# Une fois sur 200, l'incrément efface aussi les compteurs expirés : la table reste petite.
PURGE_ONE_IN = 200


def fingerprint(value):
    """Empreinte d'une valeur sensible (un e-mail) pour les clés de cache : rien n'est stocké en clair."""
    return salted_hmac("akwaba.ratelimit", value).hexdigest()[:32]


def _bucket(key):
    return key if len(key) <= 200 else "h:" + hashlib.sha256(key.encode()).hexdigest()


def incr(key, timeout):
    """
    Incrémente un compteur (créé à 1, ou remis à 1 s'il a expiré) et renvoie sa nouvelle valeur.
    Une seule requête SQL, atomique : deux tentatives simultanées comptent pour deux (docs/chantier-p5.md §5).
    """
    now = timezone.now()
    table = connection.ops.quote_name(RateCounter._meta.db_table)
    adapt = connection.ops.adapt_datetimefield_value
    with connection.cursor() as cursor:
        cursor.execute(
            f"INSERT INTO {table} (bucket, count, expires_at) VALUES (%s, 1, %s) "
            f"ON CONFLICT (bucket) DO UPDATE SET "
            f"count = CASE WHEN {table}.expires_at <= %s THEN 1 ELSE {table}.count + 1 END, "
            f"expires_at = CASE WHEN {table}.expires_at <= %s THEN excluded.expires_at ELSE {table}.expires_at END "
            f"RETURNING count",
            [_bucket(key), adapt(now + timedelta(seconds=timeout)), adapt(now), adapt(now)],
        )
        count = cursor.fetchone()[0]
    if random.randrange(PURGE_ONE_IN) == 0:
        RateCounter.objects.filter(expires_at__lte=now).delete()
    return count


def reset(key):
    """Remet un compteur à zéro (un login réussi efface ses échecs)."""
    RateCounter.objects.filter(bucket=_bucket(key)).delete()


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
