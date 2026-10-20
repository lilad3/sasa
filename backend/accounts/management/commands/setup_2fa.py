import pyotp
import segno
from django.core.management.base import BaseCommand, CommandError

from accounts import mfa
from accounts.models import User
from audit.services import record


class Command(BaseCommand):
    help = (
        "Active la double authentification d'un compte depuis le serveur. "
        "Indispensable pour un administrateur : l'admin Django exige un code 2FA."
    )

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("--reset", action="store_true", help="Remplace une 2FA déjà active.")

    def handle(self, email, reset, **options):
        user = User.objects.filter(email=email.strip().lower()).first()
        if user is None:
            raise CommandError(f"Aucun compte pour {email}.")
        if mfa.is_enabled(user) and not reset:
            raise CommandError("La 2FA est déjà active. Utilisez --reset pour la remplacer.")

        secret = pyotp.random_base32()
        codes = mfa.enable_with_secret(user, secret)
        record("mfa_enabled", actor=user, via="commande setup_2fa")

        uri = pyotp.TOTP(secret).provisioning_uri(name=user.email, issuer_name=mfa.ISSUER)
        self.stdout.write("Scannez ce QR code avec votre application d'authentification :\n")
        segno.make(uri, error="m").terminal(out=self.stdout, compact=True)
        self.stdout.write(f"\nOu saisissez la clé à la main : {secret}\n")
        self.stdout.write(self.style.WARNING("Codes de secours (à garder hors ligne, chacun sert une fois) :"))
        for code in codes:
            self.stdout.write(f"  {code}")
