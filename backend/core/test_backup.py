import gzip
import importlib
import io
import os
import sqlite3
import stat
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

from cryptography.fernet import Fernet
from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection, transaction
from django.test import TestCase, TransactionTestCase, override_settings
from django.utils import timezone

from audit.models import AuditEvent
from audit.services import record
from core import backup
from core.testing import make_order, make_shop, make_user

KEY = Fernet.generate_key().decode()


def run(command, *args, **options):
    out, err = io.StringIO(), io.StringIO()
    call_command(command, *args, stdout=out, stderr=err, **options)
    return out.getvalue()


def _audit_triggers():
    """Le SQL des triggers du journal, lu dans la migration (le nom du module commence par un chiffre)."""
    return importlib.import_module("audit.migrations.0002_append_only_triggers").TRIGGERS


class BackupTestCase(TransactionTestCase):
    """
    L'API `backup` de SQLite ne tourne pas dans une transaction ouverte : ces tests écrivent pour de vrai.
    Le nettoyage vide les tables, ce que les triggers du journal interdisent ; on les lève le temps du ménage.
    """

    @classmethod
    def _validate_databases(cls):
        # L'alias de contrôle de restore_db est créé en cours de route : on l'autorise d'avance.
        return frozenset({"default", "restauration"})

    def _fixture_teardown(self):
        with connection.cursor() as cursor:
            for name, _ in _audit_triggers():
                cursor.execute(f"DROP TRIGGER IF EXISTS {name}")
        try:
            super()._fixture_teardown()
        finally:
            with connection.cursor() as cursor:
                for _, create in _audit_triggers():
                    cursor.execute(create)

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        override = override_settings(BACKUP_ENCRYPTION_KEY=KEY, BACKUP_DIR=self.dir.name)
        override.enable()
        self.addCleanup(override.disable)
        shop = make_shop("maison-test")
        make_order(shop, total=15_000)
        record("shop_created", actor=make_user("awa@example.ci"), shop=shop)
        record("shop_updated", shop=shop, fields=["name"])

    def files(self):
        return sorted(p.name for p in Path(self.dir.name).iterdir())


class BackupTests(BackupTestCase):
    def test_backup_is_encrypted_and_unreadable_without_the_key(self):
        output = run("backup_db")

        (name,) = self.files()
        self.assertTrue(output.startswith(f"OK {name} "))
        self.assertIn("sha256=", output)
        raw = (Path(self.dir.name) / name).read_bytes()
        self.assertFalse(raw.startswith(b"SQLite format 3"))
        with self.assertRaises(OSError):
            gzip.decompress(raw)
        self.assertNotIn(b"awa@example.ci", raw)
        self.assertEqual(Fernet(KEY.encode()).decrypt(raw)[:2], b"\x1f\x8b")  # gzip
        with self.assertRaises(Exception):
            Fernet(Fernet.generate_key()).decrypt(raw)

    def test_file_is_private_and_nothing_else_is_left_on_disk(self):
        run("backup_db")

        (name,) = self.files()
        self.assertEqual(stat.S_IMODE(os.stat(Path(self.dir.name) / name).st_mode), 0o600)
        self.assertFalse([n for n in self.files() if n.endswith(".part") or n.endswith(".sqlite3")])

    def test_a_modified_file_does_not_decrypt(self):
        run("backup_db")
        path = Path(self.dir.name) / self.files()[0]
        data = bytearray(path.read_bytes())
        data[len(data) // 2] ^= 1
        path.write_bytes(bytes(data))

        with self.assertRaises(CommandError):
            run("restore_db", str(path), "--output", str(Path(self.dir.name) / "x.sqlite3"))

    def test_missing_key_stops_before_reading_the_database(self):
        with override_settings(BACKUP_ENCRYPTION_KEY=""), mock.patch("core.backup._sqlite_snapshot") as snapshot:
            with self.assertRaisesMessage(CommandError, "BACKUP_ENCRYPTION_KEY est absente"):
                run("backup_db")
        snapshot.assert_not_called()
        self.assertEqual(self.files(), [])

    def test_invalid_key_is_refused(self):
        with override_settings(BACKUP_ENCRYPTION_KEY="pas-une-cle"):
            with self.assertRaisesMessage(CommandError, "pas une clé Fernet"):
                run("backup_db")

    def test_backup_dir_inside_the_repository_is_refused(self):
        inside = Path(backup.settings.BASE_DIR) / "sauvegardes-test"
        with override_settings(BACKUP_DIR=str(inside)):
            with self.assertRaisesMessage(CommandError, "ne doit pas se trouver dans le dépôt"):
                run("backup_db")
        self.assertFalse(inside.exists())

    def test_refuses_to_run_inside_a_transaction(self):
        with transaction.atomic():
            with self.assertRaisesMessage(backup.BackupError, "transaction ouverte"):
                backup._sqlite_snapshot()

    def test_a_wal_database_is_saved_in_a_format_that_reloads(self):
        path = Path(self.dir.name) / "reel.sqlite3"
        live = sqlite3.connect(path)
        live.execute("PRAGMA journal_mode=WAL")
        live.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
        live.execute("INSERT INTO t (v) VALUES ('Adjoua')")
        live.commit()  # reste dans le fichier -wal, pas encore dans la base principale

        mem = backup._sqlite_snapshot(live)
        reloaded = backup.load_sqlite(gzip.decompress(backup._sqlite_dump(mem)))

        self.assertEqual(reloaded.execute("SELECT v FROM t").fetchall(), [("Adjoua",)])
        live.close()

    def test_a_corrupt_live_database_aborts_the_backup(self):
        broken = mock.Mock()
        broken.execute.return_value.fetchall.return_value = [("*** in database main ***",)]
        with self.assertRaisesMessage(backup.BackupError, "integrity_check"):
            backup._sqlite_dump(broken)


class RestoreTests(BackupTestCase):
    def setUp(self):
        super().setUp()
        run("backup_db")
        self.file = str(Path(self.dir.name) / self.files()[0])
        self.output = str(Path(self.dir.name) / "copie.sqlite3")

    def tearDown(self):
        backup.drop_alias("restauration")

    def test_restored_copy_has_the_same_rows_and_a_valid_chain(self):
        output = run("restore_db", self.file, "--output", self.output)

        restored = sqlite3.connect(self.output)
        self.assertEqual(backup.row_counts_sqlite(restored), backup.row_counts_sqlite(backup._sqlite_snapshot()))
        self.assertEqual(restored.execute("SELECT COUNT(*) FROM audit_auditevent").fetchone()[0], AuditEvent.objects.count())
        self.assertIn("audit_auditevent: 2", output)
        self.assertIn("Chaîne du journal : OK (2 événements vérifiés)", output)
        restored.close()

    def test_a_tampered_copy_is_reported_by_the_chain_check(self):
        record("shop_updated", fields=["slug"])
        # Une copie dont une ligne a été réécrite hors de l'application : on la prépare avant de la chiffrer.
        mem = backup._sqlite_snapshot()
        mem.execute("DROP TRIGGER audit_auditevent_no_update")
        mem.execute("UPDATE audit_auditevent SET metadata = '{}' WHERE id = (SELECT MAX(id) FROM audit_auditevent)")
        path = Path(self.dir.name) / "akwaba-20260101-000000.sqlite.gz.fernet"
        path.write_bytes(Fernet(KEY.encode()).encrypt(gzip.compress(mem.serialize())))

        with self.assertRaisesMessage(CommandError, "Chaîne du journal ROMPUE"):
            run("restore_db", str(path), "--output", str(Path(self.dir.name) / "alteree.sqlite3"))

    def test_wrong_key_fails_cleanly_and_creates_nothing(self):
        with override_settings(BACKUP_ENCRYPTION_KEY=Fernet.generate_key().decode()):
            with self.assertRaisesMessage(CommandError, "mauvaise clé"):
                run("restore_db", self.file, "--output", self.output)
        self.assertFalse(Path(self.output).exists())

    def test_default_output_leaves_the_live_database_alone(self):
        before = AuditEvent.objects.count()
        run("restore_db", self.file)

        self.assertEqual(AuditEvent.objects.count(), before)
        self.assertEqual(len([n for n in self.files() if n.startswith("restauration-")]), 1)

    def test_an_existing_output_is_never_overwritten(self):
        Path(self.output).write_text("précieux")
        with self.assertRaisesMessage(CommandError, "existe déjà"):
            run("restore_db", self.file, "--output", self.output)
        self.assertEqual(Path(self.output).read_text(), "précieux")

    def test_unexpected_file_name_is_refused(self):
        stray = Path(self.dir.name) / "n-importe-quoi.bin"
        stray.write_bytes(b"x")
        with self.assertRaisesMessage(CommandError, "Nom de fichier inattendu"):
            run("restore_db", str(stray))

    def test_postgresql_backup_needs_a_separate_target(self):
        payload = Fernet(KEY.encode()).encrypt(b"PGDMP")
        path = Path(self.dir.name) / "akwaba-20260101-000000.pgdump.fernet"
        path.write_bytes(payload)
        with self.assertRaisesMessage(CommandError, "--target-database-url"):
            run("restore_db", str(path))


class RetentionTests(TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.now = timezone.make_aware(datetime(2026, 10, 23, 12, 0))  # un vendredi

    def make(self, when, suffix=".sqlite.gz.fernet"):
        name = f"akwaba-{when:%Y%m%d-%H%M%S}{suffix}"
        (Path(self.dir.name) / name).write_bytes(b"x")
        return name

    def left(self):
        return sorted(p.name for p in Path(self.dir.name).iterdir())

    def test_keeps_a_week_and_the_last_four_sundays(self):
        daily = [self.make(self.now - timedelta(days=d, hours=1)) for d in range(0, 14)]
        sundays = []
        for weeks in range(1, 7):  # dimanches 18/10, 11/10, 4/10, 27/09, 20/09, 13/09
            day = datetime(2026, 10, 18) - timedelta(weeks=weeks - 1)
            self.make(day.replace(hour=3))  # plus tôt dans la journée : doit disparaître
            sundays.append(self.make(day.replace(hour=22)))
        recent_sunday_morning = "akwaba-20261018-030000.sqlite.gz.fernet"  # a moins de 7 jours : gardé
        stray = self.make(self.now - timedelta(days=90), suffix=".txt")  # hors motif
        (Path(self.dir.name) / "notes.md").write_text("à garder")

        backup.apply_retention(self.dir.name, self.now)

        kept = self.left()
        self.assertIn("notes.md", kept)
        self.assertIn(stray, kept)
        self.assertEqual(sorted(n for n in kept if n.startswith("akwaba-") and n.endswith(".fernet")),
                         sorted(set(daily[:7]) | set(sundays[:4]) | {recent_sunday_morning}))

    def test_pgdump_files_follow_the_same_rule(self):
        old = self.make(self.now - timedelta(days=20), suffix=".pgdump.fernet")  # un lundi
        recent = self.make(self.now - timedelta(days=1), suffix=".pgdump.fernet")
        backup.apply_retention(self.dir.name, self.now)
        self.assertEqual(self.left(), [recent])
        self.assertNotIn(old, self.left())


class PostgresCommandTests(TestCase):
    def test_password_goes_through_the_environment_only(self):
        db = {"HOST": "db.exemple.ci", "PORT": "5432", "USER": "akwaba", "PASSWORD": "S3cret!xyz", "NAME": "akwaba"}

        argv, env = backup.pg_dump_command(db)

        self.assertNotIn("S3cret!xyz", " ".join(argv))
        self.assertEqual(env["PGPASSWORD"], "S3cret!xyz")
        self.assertIn("--format=custom", argv)
        self.assertEqual(argv[:1], ["pg_dump"])

    def test_target_url_is_parsed_without_leaking_the_password(self):
        db = backup.db_from_url("postgres://u:p%40ss@h.ci:6543/ma_base")
        self.assertEqual(db, {"HOST": "h.ci", "PORT": 6543, "USER": "u", "PASSWORD": "p@ss", "NAME": "ma_base"})
        argv, _ = backup.pg_args(db, "pg_restore")
        self.assertNotIn("p@ss", " ".join(argv))
