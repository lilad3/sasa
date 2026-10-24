from django.core.management.base import BaseCommand, CommandError

from notifications.jobs import flush_held
from notifications.send import enabled


class Command(BaseCommand):
    help = "Envoie, groupés, les e-mails retenus par l'anti-rafale dont la fenêtre de 10 minutes est terminée."

    def add_arguments(self, parser):
        parser.add_argument("--shop", help="Limiter à une boutique (son identifiant court).")
        parser.add_argument("--dry-run", action="store_true", help="Compte ce qui partirait, n'envoie ni ne note rien.")

    def handle(self, *args, shop=None, dry_run=False, **options):
        if not enabled():
            self.stdout.write("Notifications désactivées (NOTIFICATIONS_ENABLED=0) : rien n'est envoyé.")
            return
        counts = flush_held(shop_slug=shop, dry_run=dry_run)
        self.stdout.write(f"Retenus : {counts.sent} {'à envoyer' if dry_run else 'envoyés'}, {counts.failed} en échec, {counts.skipped} ignorés.")
        if counts.attempted and counts.sent == 0 and counts.failed == counts.attempted and not dry_run:
            raise CommandError("Aucun e-mail retenu n'a pu partir.")
