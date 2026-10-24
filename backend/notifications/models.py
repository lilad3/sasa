import uuid

from django.db import models
from django.utils import timezone

from shops.models import Membership


class NotificationPreference(models.Model):
    """
    Un choix explicite d'une personne, par membre et par boutique. Seuls les écarts au défaut de son rôle
    sont stockés (notifications/events.py) : changer de rôle suit alors les défauts du nouveau rôle.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    membership = models.ForeignKey(Membership, on_delete=models.CASCADE, related_name="notification_preferences")
    # Validé par le serveur contre events.py : pas de `choices` en base, un événement s'ajoute sans migration.
    event = models.CharField(max_length=30)
    enabled = models.BooleanField()
    updated_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["membership", "event"], name="unique_notification_preference")]


class NotificationState(models.Model):
    """Ce qu'il faut retenir pour ne pas inonder une personne et ne pas lui répéter le résumé. Aucune donnée de client."""

    membership = models.ForeignKey(Membership, on_delete=models.CASCADE, related_name="notification_states")
    event = models.CharField(max_length=30)
    # Début de la fenêtre anti-rafale.
    last_sent_at = models.DateTimeField(null=True, blank=True)
    # Messages retenus dans la fenêtre, à annoncer dans le prochain envoi.
    held_count = models.PositiveIntegerField(default=0)
    # Références de commande (ou identifiants de produit) retenues, 10 au plus : jamais de nom ni de téléphone.
    held_refs = models.JSONField(default=list, blank=True)
    last_summary_on = models.DateField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["membership", "event"], name="unique_notification_state")]
