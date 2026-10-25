import uuid

from django.contrib.auth.models import AbstractUser, BaseUserManager
from django.db import models
from django.utils import timezone

from . import policy


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, email, password, **extra_fields):
        if not email:
            raise ValueError("L'adresse e-mail est obligatoire.")
        email = self.normalize_email(email).lower()
        user = self.model(email=email, **extra_fields)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_user(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", False)
        extra_fields.setdefault("is_superuser", False)
        return self._create_user(email, password, **extra_fields)

    def create_superuser(self, email, password=None, **extra_fields):
        extra_fields.setdefault("is_staff", True)
        extra_fields.setdefault("is_superuser", True)
        if not extra_fields["is_staff"] or not extra_fields["is_superuser"]:
            raise ValueError("Un superutilisateur doit avoir is_staff et is_superuser.")
        return self._create_user(email, password, **extra_fields)


class User(AbstractUser):
    """Compte d'un marchand Akwaba. On se connecte avec l'e-mail, pas avec un pseudo."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None
    email = models.EmailField("adresse e-mail", unique=True)
    is_demo = models.BooleanField(
        "compte de démo",
        default=False,
        help_text="Mot de passe, e-mail, 2FA et clés API ne peuvent pas être modifiés.",
    )
    # Compte créé par le propriétaire d'une boutique : il ne peut rien faire d'autre que choisir
    # son mot de passe tant qu'il a le provisoire, et le provisoire expire s'il ne sert pas.
    must_change_password = models.BooleanField("mot de passe à choisir", default=False)
    temporary_password_expires_at = models.DateTimeField("expiration du mot de passe provisoire", null=True, blank=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    objects = UserManager()

    def __str__(self):
        return self.email


class UserSession(models.Model):
    """
    Une connexion sur un appareil.

    Chaque access token porte l'identifiant de sa session (claim `sid`), et Django vérifie
    la session à chaque requête : la révoquer coupe l'accès tout de suite, sans attendre
    l'expiration du token. C'est ce qui manque à un JWT seul.
    """

    class RevokeReason(models.TextChoices):
        LOGOUT = "logout", "Déconnexion"
        PASSWORD_CHANGED = "password_changed", "Mot de passe changé"
        PASSWORD_RESET = "password_reset", "Mot de passe réinitialisé"
        REFRESH_REUSE = "refresh_reuse", "Refresh token réutilisé (vol probable)"
        BY_USER = "revoked_by_user", "Fermée depuis la liste des sessions"
        MFA_ENABLED = "mfa_enabled", "Double authentification activée"
        ACCESS_REMOVED = "access_removed", "Retiré de sa boutique ou nouveau mot de passe provisoire"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="sessions")
    shared_device = models.BooleanField("appareil partagé", default=False)
    ip = models.GenericIPAddressField(null=True, blank=True)
    user_agent = models.CharField(max_length=300, blank=True)
    device_label = models.CharField(max_length=80, blank=True)
    # Seul le refresh le plus récent est valable ; le précédent sert à la fenêtre de grâce.
    refresh_jti = models.CharField(max_length=64)
    previous_refresh_jti = models.CharField(max_length=64, blank=True)
    rotated_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField()
    revoked_at = models.DateTimeField(null=True, blank=True)
    # Confirmation renforcée : jusqu'à cette date, les actions graves sont permises.
    reauth_until = models.DateTimeField(null=True, blank=True)
    revoked_reason = models.CharField(max_length=20, choices=RevokeReason.choices, blank=True)

    class Meta:
        indexes = [models.Index(fields=["user", "revoked_at"])]

    def __str__(self):
        return f"{self.user} · {self.device_label or 'appareil inconnu'}"

    def state(self, now=None):
        """None si la session est utilisable, sinon le code d'erreur du contrat."""
        now = now or timezone.now()
        if self.revoked_at is not None:
            return "session_revoked"
        if now >= self.expires_at:
            return "session_expired"
        if self.shared_device and now - self.last_seen_at > policy.SHARED_IDLE_TIMEOUT:
            return "session_expired"
        return None


class TOTPDevice(models.Model):
    """
    L'application d'authentification (Google Authenticator, Aegis…) liée au compte.
    Le secret est chiffré (Fernet, clé TOTP_ENCRYPTION_KEY hors de la base) : une copie
    volée de la base ne suffit pas pour générer des codes.
    """

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="totp")
    secret_encrypted = models.TextField()
    confirmed_at = models.DateTimeField(null=True, blank=True)
    # Anti-rejeu : un code, ou un code plus ancien, ne passe jamais deux fois.
    last_used_step = models.BigIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"2FA de {self.user}"


class RecoveryCode(models.Model):
    """Code de secours à usage unique. Seule son empreinte HMAC est stockée."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="recovery_codes")
    code_hash = models.CharField(max_length=64, db_index=True)
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)


class KnownDevice(models.Model):
    """Un appareil déjà vu pour ce compte. Seule une empreinte de l'identifiant d'appareil est stockée."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="known_devices")
    device_hash = models.CharField(max_length=64)
    label = models.CharField(max_length=80, blank=True)
    first_seen_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "device_hash"], name="unique_known_device")]
