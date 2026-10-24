from datetime import date as parse_date

from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

from notifications.jobs import flush_held, send_summaries
from notifications.send import enabled


class Command(BaseCommand):
    help = "Envoie le résumé du jour (une fois par jour et par personne), après les e-mails retenus. À planifier à 20 h."

    def add_arguments(self, parser):
        parser.add_argument("--shop", help="Limiter à une boutique (son identifiant court).")
        parser.add_argument("--date", help="Le jour du résumé, AAAA-MM-JJ (aujourd'hui par défaut, jamais dans le futur).")
        parser.add_argument("--dry-run", action="store_true", help="Affiche qui recevrait quoi, n'envoie ni ne note rien.")

    def handle(self, *args, shop=None, date: str | None = None, dry_run=False, **options):
        if not enabled():
            self.stdout.write("Notifications désactivées (NOTIFICATIONS_ENABLED=0) : rien n'est envoyé.")
            return
        today = timezone.localdate()
        try:
            day = today if date is None else parse_date.fromisoformat(date)
        except ValueError:
            raise CommandError("La date doit être au format AAAA-MM-JJ.")
        if day > today:
            raise CommandError("Le résumé ne peut pas porter sur un jour à venir.")
        held = flush_held(shop_slug=shop, dry_run=dry_run)
        lines = []
        counts = send_summaries(day, shop_slug=shop, dry_run=dry_run, lines=lines)
        for line in lines:
            self.stdout.write(line)
        self.stdout.write(
            f"Retenus : {held.sent} {'à envoyer' if dry_run else 'envoyés'}, {held.failed} en échec. "
            f"Résumés : {counts.sent} {'à envoyer' if dry_run else 'envoyés'}, {counts.failed} en échec, {counts.skipped} ignorés."
        )
        attempted = held.attempted + counts.attempted
        if not dry_run and attempted and held.sent + counts.sent == 0:
            raise CommandError("Aucun e-mail n'a pu partir.")
