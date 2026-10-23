import hmac
from dataclasses import dataclass

from django.db import transaction
from django.utils import timezone

from core.devices import device_label

from .actions import ACTIONS
from .models import AuditEvent


def record(action, request=None, *, actor=None, email="", shop=None, target=None, **metadata):
    """
    Ajoute un événement au journal.

    `actor` est le compte à l'origine de l'action ; sans compte connu, `email` garde au moins
    l'adresse saisie. `target` vaut (type, identifiant, libellé), par exemple
    ("order", order.pk, "K7F-92Q"). Le reste part dans `metadata`.
    """
    category, severity, _ = ACTIONS[action]
    target_type, target_id, target_label = target or ("", "", "")
    event = AuditEvent(
        created_at=timezone.now(),
        category=category,
        action=action,
        severity=severity,
        actor_id=getattr(actor, "pk", None),
        actor_email=getattr(actor, "email", "") or email,
        shop_id=getattr(shop, "pk", None),
        shop_slug=getattr(shop, "slug", ""),
        target_type=target_type,
        target_id=str(target_id),
        target_label=str(target_label)[:120],
        ip=getattr(request, "client_ip", "") or None,
        device_label=device_label(getattr(request, "client_ua", "")),
        request_id=getattr(request, "request_id", ""),
        metadata=metadata,
    )
    # SQLite démarre la transaction en IMMEDIATE (settings) : deux événements simultanés
    # ne peuvent pas s'accrocher au même maillon.
    with transaction.atomic():
        event.previous_hash = AuditEvent.objects.order_by("-id").values_list("hash", flat=True).first() or ""
        event.hash = event.compute_hash()
        event.save()
    return event


@dataclass
class ChainReport:
    ok: bool
    checked: int
    broken_id: int | None = None
    reason: str = ""


def verify_chain(using=None):
    """Recalcule toute la chaîne, de la ligne la plus ancienne à la plus récente (`using` : autre base, ex. une restauration)."""
    previous = None
    checked = 0
    for event in AuditEvent.objects.using(using).order_by("id").iterator(chunk_size=500):
        if previous is not None and event.previous_hash != previous:
            return ChainReport(False, checked, event.pk, "maillon rompu : une ligne a été supprimée ou insérée hors de l'application")
        if not hmac.compare_digest(event.hash, event.compute_hash()):
            return ChainReport(False, checked, event.pk, "contenu modifié après son enregistrement")
        previous = event.hash
        checked += 1
    return ChainReport(True, checked)
