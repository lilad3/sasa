"""Double authentification TOTP (RFC 6238) et codes de secours (docs/contrat-api.md §2.6)."""

import re
import secrets
import time

import pyotp
import segno
from cryptography.fernet import Fernet
from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone
from django.utils.crypto import constant_time_compare, salted_hmac

from audit.services import record

from . import emails
from .models import RecoveryCode, TOTPDevice

ISSUER = "Akwaba"
RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"  # sans 0/o, 1/i/l
RECOVERY_CODE_COUNT = 10
TOTP_CODE = re.compile(r"^\d{6}$")


def is_enabled(user):
    return TOTPDevice.objects.filter(user=user, confirmed_at__isnull=False).exists()


def has_pending_setup(user):
    return TOTPDevice.objects.filter(user=user, confirmed_at__isnull=True).exists()


def start_setup(user):
    """Prépare un secret non confirmé. La 2FA n'est active qu'après un premier code valide."""
    secret = pyotp.random_base32()
    TOTPDevice.objects.update_or_create(
        user=user,
        defaults={"secret_encrypted": _encrypt(secret), "confirmed_at": None, "last_used_step": None},
    )
    uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=ISSUER)
    return {"otpauth_uri": uri, "secret": secret, "qr_svg": segno.make(uri, error="m").svg_inline(scale=5)}


def confirm_setup(user, code):
    """Active la 2FA si le code est bon. Renvoie les codes de secours, ou None."""
    device = TOTPDevice.objects.filter(user=user, confirmed_at__isnull=True).first()
    if device is None or not _check_totp(device, code):
        return None
    TOTPDevice.objects.filter(pk=device.pk).update(confirmed_at=timezone.now())
    return regenerate_recovery_codes(user)


def enable_with_secret(user, secret):
    """Pour l'exploitation (commande setup_2fa) et les comptes de démo : secret fourni, actif tout de suite."""
    TOTPDevice.objects.update_or_create(
        user=user,
        defaults={"secret_encrypted": _encrypt(secret), "confirmed_at": timezone.now(), "last_used_step": None},
    )
    return regenerate_recovery_codes(user)


def disable(user):
    with transaction.atomic():
        TOTPDevice.objects.filter(user=user).delete()
        RecoveryCode.objects.filter(user=user).delete()


def regenerate_recovery_codes(user):
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(RECOVERY_ALPHABET) for _ in range(8))
        codes.append(f"{raw[:4]}-{raw[4:]}")
    with transaction.atomic():
        RecoveryCode.objects.filter(user=user).delete()
        RecoveryCode.objects.bulk_create(RecoveryCode(user=user, code_hash=_recovery_hash(user, c)) for c in codes)
    return codes


def verify(user, code, request=None):
    """
    Vérifie un code TOTP ou un code de secours. Renvoie la méthode utilisée, ou None.
    Un code de secours utilisé est journalisé et le titulaire est prévenu par e-mail.
    """
    device = TOTPDevice.objects.filter(user=user, confirmed_at__isnull=False).first()
    if device is None:
        return None
    if _check_totp(device, code):
        return "totp"
    if _use_recovery_code(user, code):
        remaining = RecoveryCode.objects.filter(user=user, used_at__isnull=True).count()
        record("recovery_code_used", request, actor=user, remaining=remaining)
        emails.send_security_alert(user, "recovery_code_used", request)
        return "recovery_code"
    return None


def _check_totp(device, code):
    code = re.sub(r"\s", "", code or "")
    if not TOTP_CODE.match(code):
        return False
    totp = pyotp.TOTP(_decrypt(device.secret_encrypted))
    current = int(time.time()) // totp.interval
    for step in (current - 1, current, current + 1):  # tolérance d'un pas pour une horloge décalée
        if constant_time_compare(totp.generate_otp(step), code):
            # Mise à jour conditionnelle : si ce pas (ou un plus récent) a déjà servi, le code est un rejeu.
            claimed = (
                TOTPDevice.objects.filter(pk=device.pk)
                .filter(Q(last_used_step__isnull=True) | Q(last_used_step__lt=step))
                .update(last_used_step=step)
            )
            return claimed == 1
    return False


def _use_recovery_code(user, code):
    used = RecoveryCode.objects.filter(
        user=user, code_hash=_recovery_hash(user, code or ""), used_at__isnull=True
    ).update(used_at=timezone.now())
    return used == 1


def _recovery_hash(user, code):
    normalized = re.sub(r"[^a-z0-9]", "", code.lower())
    return salted_hmac("akwaba.recovery-code", f"{user.pk}:{normalized}").hexdigest()


def _encrypt(secret):
    return Fernet(settings.TOTP_ENCRYPTION_KEY.encode()).encrypt(secret.encode()).decode()


def _decrypt(token):
    return Fernet(settings.TOTP_ENCRYPTION_KEY.encode()).decrypt(token.encode()).decode()
