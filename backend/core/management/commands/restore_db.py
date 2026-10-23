from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connection

from audit.services import verify_chain
from core import backup

ALIAS = "restauration"


class Command(BaseCommand):
    help = (
        "Restaure une sauvegarde chiffrée (contrat A2 §2.2). Par défaut, écrit une copie à part et la contrôle ; "
        "--force remplace la base en service, après une sauvegarde automatique de son état."
    )

    def add_arguments(self, parser):
        parser.add_argument("file", help="Fichier akwaba-AAAAMMJJ-HHMMSS.….fernet")
        parser.add_argument("--output", help="SQLite : fichier de sortie (défaut : BACKUP_DIR/restauration-….sqlite3)")
        parser.add_argument("--target-database-url", help="PostgreSQL : base séparée où restaurer")
        parser.add_argument("--force", action="store_true", help="Remplace la base en service (arrêtez d'abord l'application web)")

    def handle(self, *args, file, output, target_database_url, force, **options):
        try:
            kind, raw = backup.read_backup(file)
            if kind == "sqlite":
                counts, alias_settings = self._restore_sqlite(raw, output, force)
            else:
                counts, alias_settings = self._restore_postgres(raw, target_database_url, force)
            self._report(counts, alias_settings)
        except backup.BackupError as error:
            raise CommandError(str(error)) from None
        finally:
            backup.drop_alias(ALIAS)

    def _pre_backup(self):
        saved = backup.create_backup()
        self.stdout.write(f"Sauvegarde de l'état actuel avant remplacement : {saved.path.name}")

    def _restore_sqlite(self, raw, output, force):
        mem = backup.load_sqlite(raw)
        live = connection.settings_dict["NAME"]
        try:
            if force:
                if connection.vendor != "sqlite":
                    raise backup.BackupError("--force avec une sauvegarde SQLite exige que la base en service soit SQLite.")
                self._pre_backup()
                connection.close()
                destination = Path(live)
            else:
                destination = Path(output) if output else backup.default_output()
                if connection.vendor == "sqlite" and destination.resolve() == Path(live).resolve():
                    raise backup.BackupError("Cette sortie est la base en service : utilisez --force pour la remplacer.")
                if destination.exists():
                    raise backup.BackupError(f"{destination} existe déjà : choisissez une autre sortie.")
            backup.write_sqlite_file(mem, destination)
            self.stdout.write(f"Base restaurée : {destination}")
            return backup.row_counts_sqlite(mem), {"ENGINE": "django.db.backends.sqlite3", "NAME": str(destination)}
        finally:
            mem.close()

    def _restore_postgres(self, raw, url, force):
        if force:
            if connection.vendor != "postgresql":
                raise backup.BackupError("--force avec une sauvegarde PostgreSQL exige que la base en service soit PostgreSQL.")
            self._pre_backup()
            db = {k: connection.settings_dict.get(k, "") for k in ("HOST", "PORT", "USER", "PASSWORD", "NAME")}
        else:
            if not url:
                raise backup.BackupError("Une sauvegarde PostgreSQL se restaure dans une base séparée : --target-database-url postgres://…")
            db = backup.db_from_url(url)
            live = connection.settings_dict
            if connection.vendor == "postgresql" and (db["NAME"], db["HOST"]) == (live.get("NAME"), live.get("HOST")):
                raise backup.BackupError("Cette cible est la base en service : utilisez --force pour la remplacer.")
        backup.restore_postgres(raw, db)
        self.stdout.write(f"Base restaurée : {db['NAME']}")
        return None, {"ENGINE": "django.db.backends.postgresql", **db}

    def _report(self, counts, alias_settings):
        backup.temporary_alias(ALIAS, alias_settings)
        if counts is None:
            counts = backup.row_counts_alias(ALIAS)
        self.stdout.write("Lignes par table :")
        for table, rows in counts.items():
            self.stdout.write(f"  {table}: {rows}")
        report = verify_chain(using=ALIAS)
        if not report.ok:
            raise backup.BackupError(f"Chaîne du journal ROMPUE dans la copie (événement {report.broken_id}) : {report.reason}")
        self.stdout.write(f"Chaîne du journal : OK ({report.checked} événements vérifiés).")
