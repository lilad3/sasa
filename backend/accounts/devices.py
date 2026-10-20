"""Appareils connus d'un compte, pour prévenir le marchand d'une connexion depuis un nouvel appareil."""

from django.utils import timezone
from django.utils.crypto import salted_hmac

from audit.services import record

from . import emails
from .models import KnownDevice, UserSession


def note_device(user, session, request):
    """
    Mémorise l'appareil de cette connexion. S'il est inconnu et que le compte s'était déjà
    connecté ailleurs, l'événement est journalisé et le titulaire reçoit une alerte.
    En mode appareil partagé, rien n'est mémorisé : chaque connexion compte comme nouvelle.
    """
    device_id = getattr(request, "device_id", "")
    is_new = True
    if device_id and not session.shared_device:
        device_hash = salted_hmac("akwaba.device", device_id).hexdigest()
        known, created = KnownDevice.objects.get_or_create(
            user=user, device_hash=device_hash, defaults={"label": session.device_label}
        )
        if not created:
            KnownDevice.objects.filter(pk=known.pk).update(last_seen_at=timezone.now(), label=session.device_label)
        is_new = created

    first_login = not UserSession.objects.filter(user=user).exclude(pk=session.pk).exists()
    if is_new and not first_login:
        record("new_device", request, actor=user, shared_device=session.shared_device)
        emails.send_security_alert(user, "new_device", request)
