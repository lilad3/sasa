"""
Verrouillage du login après des échecs répétés (docs/contrat-api.md §2.4).

Le compteur est tenu par e-mail, que le compte existe ou non : un 423 ne révèle donc
pas qu'une adresse a un compte. Les clés de cache ne contiennent qu'une empreinte de l'e-mail.
Mots de passe faux et codes 2FA faux comptent dans le même compteur.
"""

import math
import time

from django.core import signing
from django.core.cache import cache

from audit.services import record
from core.exceptions import ProblemError
from core.ratelimit import fingerprint, incr

from . import emails, policy
from .models import User

UNLOCK_SALT = "akwaba.unlock"


def _keys(email):
    key = fingerprint(email)
    return f"login:fail:{key}", f"login:lock:{key}"


def locked_for(email):
    """Secondes de verrou restantes (0 si le compte n'est pas verrouillé)."""
    until = cache.get(_keys(email)[1])
    return max(0, math.ceil(until - time.time())) if until else 0


def ensure_not_locked(email):
    if seconds := locked_for(email):
        raise locked_error(seconds)


def register_failure(email):
    """Compte un échec. Renvoie le nombre d'essais restants ; 0 veut dire que le compte vient d'être verrouillé."""
    fail_key, lock_key = _keys(email)
    failures = incr(fail_key, int(policy.LOGIN_FAILURE_MEMORY.total_seconds()))
    if failures < policy.LOGIN_LOCK_THRESHOLD:
        return policy.LOGIN_LOCK_THRESHOLD - failures
    duration = int(policy.LOGIN_LOCK_DURATION.total_seconds())
    cache.set(lock_key, time.time() + duration, timeout=duration)
    cache.delete(fail_key)
    return 0


def record_failure(email, request, action):
    """
    Compte l'échec et le journalise. Au moment du verrou, le titulaire reçoit un e-mail avec
    un lien de déblocage : un attaquant ne peut pas se servir du verrou pour bloquer un marchand.
    L'e-mail ne part que si le compte existe ; la réponse de l'API, elle, ne change pas.
    """
    remaining = register_failure(email)
    user = User.objects.filter(email=email).first()
    record(action, request, actor=user, email=email)
    if remaining == 0 and user is not None:
        record("account_locked", request, actor=user)
        emails.send_account_locked(user, _unlock_token(email))
    return remaining


def unlock(token):
    """Lève le verrou si le lien correspond au verrou en cours. Renvoie le compte débloqué, ou None."""
    try:
        payload = signing.loads(token, salt=UNLOCK_SALT, max_age=policy.UNLOCK_TOKEN_MAX_AGE)
    except signing.BadSignature:
        return None
    # Le lien est lié à ce verrou précis : il ne sert qu'une fois, et pas pour un verrou suivant.
    if cache.get(_keys(payload["email"])[1]) != payload["until"]:
        return None
    clear(payload["email"])
    return User.objects.filter(email=payload["email"]).first()


def clear(email):
    cache.delete_many(_keys(email))


def reset_failures(email):
    cache.delete(_keys(email)[0])


def locked_error(seconds):
    minutes = max(1, math.ceil(seconds / 60))
    return ProblemError(
        423,
        "account_locked",
        f"Trop de tentatives. Réessayez dans {minutes} min.",
        retry_after=seconds,
    )


def _unlock_token(email):
    return signing.dumps({"email": email, "until": cache.get(_keys(email)[1])}, salt=UNLOCK_SALT)
