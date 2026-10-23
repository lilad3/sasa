from django.core.management.base import BaseCommand, CommandError

from core import backup


def human_size(size):
    return f"{size / 1_000_000:.1f}".replace(".", ",") + " Mo"


class Command(BaseCommand):
    help = "Sauvegarde chiffrée de la base (contrat A2 §2.1). À planifier chaque jour."

    def handle(self, *args, **options):
        try:
            result = backup.create_backup()
        except backup.BackupError as error:
            raise CommandError(str(error)) from None
        seconds = f"{result.seconds:.1f}".replace(".", ",")
        self.stdout.write(f"OK {result.path.name} {human_size(result.size)} en {seconds} s sha256={result.sha256}")
        for path in result.removed:
            self.stdout.write(f"Supprimée (rétention) : {path.name}")
