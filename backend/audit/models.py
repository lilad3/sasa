import hashlib
import hmac
import json
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from .actions import ACTION_CHOICES, Category, Severity


class AppendOnlyError(Exception):
    """Le journal ne se modifie pas et ne s'efface pas."""


class AuditQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise AppendOnlyError("Le journal d'audit est en ajout seul.")

    def delete(self):
        raise AppendOnlyError("Le journal d'audit est en ajout seul.")


class AuditEvent(models.Model):
    """
    Journal d'audit de la plateforme : qui a fait quoi, quand, depuis où.

    Il est en ajout seul, à deux niveaux : l'ORM refuse toute modification, et des triggers
    SQLite (migration 0002) refusent UPDATE et DELETE même en SQL brut. Chaque ligne est aussi
    chaînée à la précédente par un HMAC dont la clé n'est pas dans la base : modifier ou
    supprimer une ligne directement dans le fichier casse la chaîne, et « Vérifier
    l'intégrité » (admin) le détecte.
    """

    id = models.BigAutoField(primary_key=True)  # l'ordre de la chaîne
    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    created_at = models.DateTimeField("date", default=timezone.now, db_index=True)
    category = models.CharField("catégorie", max_length=10, choices=Category.choices)
    action = models.CharField("événement", max_length=40, choices=ACTION_CHOICES, db_index=True)
    severity = models.CharField("gravité", max_length=10, choices=Severity.choices)
    # Pas de clé étrangère : supprimer un compte ou une boutique ne doit jamais réécrire l'historique.
    actor_id = models.UUIDField("identifiant du compte", null=True, blank=True)
    actor_email = models.CharField("compte", max_length=254, blank=True)
    shop_id = models.UUIDField("identifiant de la boutique", null=True, blank=True)
    shop_slug = models.CharField("boutique", max_length=60, blank=True)
    target_type = models.CharField("type de cible", max_length=30, blank=True)
    target_id = models.CharField("identifiant de la cible", max_length=64, blank=True)
    target_label = models.CharField("cible", max_length=120, blank=True)
    ip = models.GenericIPAddressField("adresse IP", null=True, blank=True)
    device_label = models.CharField("appareil", max_length=80, blank=True)
    request_id = models.CharField("identifiant de requête", max_length=64, blank=True)
    metadata = models.JSONField("détails", default=dict, blank=True)
    previous_hash = models.CharField("maillon précédent", max_length=64, blank=True)
    hash = models.CharField("empreinte", max_length=64)

    objects = AuditQuerySet.as_manager()

    class Meta:
        ordering = ["-id"]
        verbose_name = "événement"
        verbose_name_plural = "journal d'audit"
        indexes = [
            models.Index(fields=["actor_id", "-created_at"]),
            models.Index(fields=["shop_slug", "-created_at"]),
            models.Index(fields=["severity", "-created_at"]),
        ]

    def __str__(self):
        return f"{self.get_action_display()} · {self.actor_email or 'anonyme'}"

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise AppendOnlyError("Le journal d'audit est en ajout seul.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise AppendOnlyError("Le journal d'audit est en ajout seul.")

    def compute_hash(self):
        payload = {
            "created_at": self.created_at.isoformat(),
            "category": self.category,
            "action": self.action,
            "severity": self.severity,
            "actor_id": str(self.actor_id) if self.actor_id else None,
            "actor_email": self.actor_email,
            "shop_id": str(self.shop_id) if self.shop_id else None,
            "shop_slug": self.shop_slug,
            "target": [self.target_type, self.target_id, self.target_label],
            "ip": self.ip,
            "device_label": self.device_label,
            "request_id": self.request_id,
            "metadata": self.metadata,
            "previous_hash": self.previous_hash,
        }
        message = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
        return hmac.new(settings.AUDIT_HMAC_KEY.encode(), message.encode(), hashlib.sha256).hexdigest()
