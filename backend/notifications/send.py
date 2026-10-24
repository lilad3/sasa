"""
L'envoi (contrat §5) : anti-rafale, plafonds, disjoncteur, une seule connexion et un budget de temps total.
Rien ici ne lève vers l'appelant pour une panne d'e-mail : un message qui ne part pas est retenu, pas perdu.
"""

import logging
import time
from dataclasses import dataclass, field
from datetime import timedelta

from django.conf import settings
from django.core.cache import cache
from django.core.mail import get_connection
from django.db import IntegrityError, transaction
from django.db.models import F, Q
from django.utils import timezone

from core import ratelimit

from .models import NotificationState

logger = logging.getLogger("akwaba.notifications")

WINDOW = timedelta(minutes=10)
# Les callbacks on_commit tournent avant que la réponse parte : tout le travail d'un déclencheur tient dans ce budget,
# EMAIL_TIMEOUT (par opération réseau) en étant seulement une partie.
TRIGGER_BUDGET = 5
SHOP_DAILY_CAP = (200, 86400)
BREAKER_KEY = "notify:breaker"
BREAKER_SECONDS = 5 * 60
HELD_REFS_MAX = 10
NOT_DELIVERING = {
    "django.core.mail.backends.console.EmailBackend",
    "django.core.mail.backends.dummy.EmailBackend",
    "django.core.mail.backends.filebased.EmailBackend",
}


def enabled():
    return bool(settings.NOTIFICATIONS_ENABLED)


def sending_active():
    """Vrai si des e-mails partent vraiment d'ici : l'envoi est activé et le serveur d'e-mail n'est pas la console."""
    return enabled() and settings.EMAIL_BACKEND not in NOT_DELIVERING


class Budget:
    """Un temps total à ne pas dépasser pour un déclencheur."""

    def __init__(self, seconds=TRIGGER_BUDGET):
        self.deadline = time.monotonic() + seconds

    def remaining(self):
        return self.deadline - time.monotonic()

    @property
    def spent(self):
        return self.remaining() <= 0


def breaker_open():
    return cache.get(BREAKER_KEY) is not None


def trip_breaker():
    cache.set(BREAKER_KEY, 1, BREAKER_SECONDS)


@dataclass
class Pending:
    """Un message à envoyer et de quoi le remettre en retenu s'il ne part pas."""

    state: NotificationState
    message: object
    refs: list
    held_count: int
    undo: object = None
    failed: bool = field(default=False)


def ensure_state(membership, event):
    try:
        state, _ = NotificationState.objects.get_or_create(membership=membership, event=event)
    except IntegrityError:
        # Deux premiers événements simultanés : l'autre a créé la ligne entre-temps.
        state = NotificationState.objects.get(membership=membership, event=event)
    return state


def take_window(state, now=None):
    """
    Prend la fenêtre de 10 minutes par une mise à jour conditionnelle. Renvoie (retenus, références retenues,
    début de la fenêtre précédente) à annoncer dans le message, ou None si la fenêtre est déjà prise (l'événement doit être retenu).
    """
    now = now or timezone.now()
    with transaction.atomic():
        locked = NotificationState.objects.select_for_update().get(pk=state.pk)
        taken = NotificationState.objects.filter(pk=state.pk).filter(
            Q(last_sent_at__isnull=True) | Q(last_sent_at__lte=now - WINDOW)
        ).update(last_sent_at=now, held_count=0, held_refs=[])
    if taken != 1:
        return None
    return locked.held_count, list(locked.held_refs or []), locked.last_sent_at or now


def hold(state_pk, refs, count=1):
    """Retient `count` événements : le compteur monte toujours, les références s'arrêtent à 10."""
    with transaction.atomic():
        state = NotificationState.objects.select_for_update().get(pk=state_pk)
        merged = (list(state.held_refs or []) + [ref for ref in refs if ref not in (state.held_refs or [])])[-HELD_REFS_MAX:]
        NotificationState.objects.filter(pk=state_pk).update(held_count=F("held_count") + count, held_refs=merged)


def under_daily_cap(shop):
    """Compte un e-mail pour la boutique. Faux au-delà de 200 par jour : le message est retenu, jamais une erreur."""
    if ratelimit.hit("notify:shop", str(shop.pk), SHOP_DAILY_CAP) is None:
        return True
    if ratelimit.incr(f"notify:capwarn:{shop.pk}", 3600) == 1:
        logger.warning("notifications: plafond quotidien atteint shop_id=%s", shop.pk)
    return False


def _tighten(connection, budget):
    """Réduit le délai du socket SMTP au temps qui reste (EMAIL_TIMEOUT s'applique à chaque opération)."""
    sock = getattr(getattr(connection, "connection", None), "sock", None)
    if sock is not None:
        sock.settimeout(max(0.05, min(settings.EMAIL_TIMEOUT, budget.remaining())))


def send_all(pendings, budget):
    """
    Envoie sur UNE connexion, dans le budget. Marque `failed` ce qui n'est pas parti (panne, budget épuisé,
    disjoncteur ouvert) ; le premier échec ouvre le disjoncteur pour 5 minutes.
    """
    if not pendings:
        return
    if breaker_open() or budget.spent:
        for pending in pendings:
            pending.failed = True
        return
    connection = get_connection(timeout=max(0.05, min(settings.EMAIL_TIMEOUT, budget.remaining())), fail_silently=False)
    try:
        connection.open()
        for index, pending in enumerate(pendings):
            if budget.spent:
                for rest in pendings[index:]:
                    rest.failed = True
                break
            _tighten(connection, budget)
            try:
                connection.send_messages([pending.message])
            except Exception as exc:
                trip_breaker()
                logger.error("notifications: envoi impossible (%s)", type(exc).__name__)
                for rest in pendings[index:]:
                    rest.failed = True
                break
    except Exception as exc:
        trip_breaker()
        logger.error("notifications: connexion impossible (%s)", type(exc).__name__)
        for pending in pendings:
            pending.failed = True
    finally:
        try:
            connection.close()
        except Exception:
            pass


def restore(pending):
    """Un message qui n'est pas parti retombe en retenu : il repart avec le prochain envoi ou au balayage."""
    if pending.undo is not None:
        pending.undo()
        return
    hold(pending.state.pk, pending.refs, pending.held_count)
