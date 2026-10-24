from django.core.mail import get_connection
from django.core.management.base import BaseCommand, CommandError

from accounts import emails
from accounts.models import User
from notifications import compose
from notifications.recipients import Recipient
from shops.models import Membership
from shops.permissions import effective_permissions


class Command(BaseCommand):
    help = (
        "Vérification après déploiement (docs/chantier-a2-notifications.md §10.4) : envoie à un compte existant "
        "l'e-mail de test des notifications ET une alerte de sécurité de test (nouvelle connexion)."
    )

    def add_arguments(self, parser):
        parser.add_argument("email", help="L'adresse d'un compte existant : c'est la seule à qui l'on écrit.")

    def handle(self, *args, email, **options):
        user = User.objects.filter(email__iexact=email.strip(), is_active=True, is_demo=False).first()
        membership = Membership.objects.filter(user=user).select_related("shop", "user").first() if user else None
        if membership is None:
            raise CommandError("Aucun compte actif rattaché à une boutique ne porte cette adresse.")
        connection = get_connection(fail_silently=False)
        try:
            recipient = Recipient(membership, frozenset(effective_permissions(membership)))
            connection.send_messages([compose.test_message(recipient, membership.shop)])
            self.stdout.write("E-mail de test des notifications : envoyé.")
        except Exception as exc:
            raise CommandError(f"E-mail de test en échec ({type(exc).__name__}).")
        try:
            emails.send_security_alert(user, "new_device")
            self.stdout.write("Alerte de sécurité de test (nouvelle connexion) : envoyée.")
        except Exception as exc:
            raise CommandError(f"Alerte de sécurité de test en échec ({type(exc).__name__}).")
