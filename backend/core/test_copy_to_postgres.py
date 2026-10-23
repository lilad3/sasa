import io
import tempfile
import unittest
from datetime import datetime, timezone as utc
from pathlib import Path

from django.core.management import call_command
from django.core.management.base import CommandError
from django.db import connection

from accounts.models import User
from audit.actions import ACTIONS
from audit.models import AuditEvent
from audit.services import record, verify_chain
from core import backup
from core.testing import _transaction_case
from shops.models import Order, Shop

SEED = "seed_source"
postgres_only = unittest.skipUnless(connection.vendor == "postgresql", "cible PostgreSQL")


def run(*args, **options):
    out = io.StringIO()
    call_command("copy_to_postgres", *args, stdout=out, stderr=io.StringIO(), **options)
    return out.getvalue()


@postgres_only
class CopyToPostgresTests(_transaction_case()):
    """Une vraie base SQLite (migrée, avec ses triggers) copiée vers la base de test PostgreSQL."""

    @classmethod
    def _validate_databases(cls):
        return frozenset({"default", SEED, "source_sqlite"})

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.path = Path(self.dir.name) / "source.sqlite3"
        backup.temporary_alias(SEED, {"ENGINE": "django.db.backends.sqlite3", "NAME": str(self.path)})
        call_command("migrate", database=SEED, verbosity=0)

        self.when = datetime(2026, 3, 4, 10, 11, 12, 345678, tzinfo=utc.utc)
        self.user = User(email="adjoua@example.ci", first_name="Adjoua")
        self.user.set_password("pirogue-lagune-mangue")
        self.user.save(using=SEED)
        self.shop = Shop.objects.using(SEED).create(slug="maison-test", name="Maison Test")
        self.order = Order.objects.using(SEED).create(
            shop=self.shop, customer_name="Aya", customer_phone="+2250707000001", subtotal=1000, total=1000,
            payment_method="wave", customer_city="Abidjan", customer_commune="Cocody", created_at=self.when,
        )
        self.chain()
        backup.drop_alias(SEED)
        self.addCleanup(backup.drop_alias, "source_sqlite")

    def chain(self, count=3):
        previous = ""
        category, severity, _ = ACTIONS["login_failed"]
        for n in range(count):
            event = AuditEvent(
                created_at=self.when.replace(microsecond=n * 111_111 + 5), category=category, action="login_failed",
                severity=severity, actor_email=f"x{n}@example.ci", previous_hash=previous, metadata={"n": n},
            )
            event.hash = previous = event.compute_hash()
            event.save(using=SEED)

    def test_rows_dates_and_the_chain_arrive_intact(self):
        output = run(source=str(self.path))

        self.assertIn("accounts_user: 1 → 1", output)
        self.assertIn("audit_auditevent: 3 → 3", output)
        self.assertIn("Chaîne du journal : OK (3 événements vérifiés)", output)
        self.assertEqual(Order.objects.get().created_at, self.when)  # les microsecondes ne se perdent pas
        self.assertTrue(User.objects.get().check_password("pirogue-lagune-mangue"))
        self.assertTrue(verify_chain().ok)

    def test_sequences_are_reset_so_new_events_keep_working(self):
        run(source=str(self.path))

        event = record("login_failed", email="apres@example.ci")

        self.assertEqual(event.pk, 4)
        self.assertTrue(verify_chain().ok)

    def test_a_target_that_is_not_empty_is_refused(self):
        run(source=str(self.path))
        with self.assertRaisesMessage(CommandError, "n'est pas vide"):
            run(source=str(self.path))
        self.assertEqual(User.objects.count(), 1)

    def test_a_value_too_long_for_postgresql_stops_everything_before_writing(self):
        import sqlite3

        raw = sqlite3.connect(self.path)  # SQLite n'applique pas max_length
        raw.execute("UPDATE accounts_user SET first_name = ?", ["x" * 400])
        raw.commit()
        raw.close()

        with self.assertRaisesMessage(CommandError, "rien n'a été écrit"):
            run(source=str(self.path))
        self.assertEqual(User.objects.count(), 0)

    def test_a_nul_character_stops_everything_before_writing(self):
        import sqlite3

        raw = sqlite3.connect(self.path)
        raw.execute("UPDATE shops_shop SET name = ?", ["Mai\x00son"])
        raw.commit()
        raw.close()

        with self.assertRaisesMessage(CommandError, "rien n'a été écrit"):
            run(source=str(self.path))
        self.assertEqual(Shop.objects.count(), 0)

    def test_a_broken_chain_cancels_the_copy(self):
        import sqlite3

        raw = sqlite3.connect(self.path)
        raw.execute("DROP TRIGGER audit_auditevent_no_update")
        raw.execute("UPDATE audit_auditevent SET actor_email = 'faux@example.ci' WHERE id = 2")
        raw.commit()
        raw.close()

        with self.assertRaisesMessage(CommandError, "Chaîne du journal rompue"):
            run(source=str(self.path))
        self.assertEqual(User.objects.count(), 0)  # tout est annulé, pas de copie à moitié faite

    def test_check_only_writes_nothing(self):
        output = run(source=str(self.path), check_only=True)

        self.assertIn("OK", output)
        self.assertEqual(User.objects.count(), 0)

    def test_the_source_is_opened_read_only(self):
        before = self.path.read_bytes()
        run(source=str(self.path))
        self.assertEqual(self.path.read_bytes(), before)
