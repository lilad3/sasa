import csv
import io

from django.conf import settings
from django.contrib.messages import get_messages
from django.db import DatabaseError, connection, transaction
from django.test import Client, TestCase, override_settings

from audit.models import AppendOnlyError, AuditEvent
from audit.services import record, verify_chain
from core.testing import (
    CLIENT_IP,
    PASSWORD,
    ApiTestCase,
    drop_audit_trigger,
    enable_mfa,
    make_member,
    make_order,
    make_shop,
    make_user,
    totp,
    wrong_code,
)

FAST_HASHER = override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
ADMIN = f"/{settings.ADMIN_URL}"


class AuditChainTests(TestCase):
    def three_events(self):
        return [record(action, email=f"{action}@example.ci") for action in ("login_failed", "login_failed", "account_locked")]

    def test_each_event_is_chained_to_the_previous_one(self):
        first, second, _ = self.three_events()

        self.assertEqual(second.previous_hash, first.hash)
        report = verify_chain()
        self.assertTrue(report.ok)
        self.assertEqual(report.checked, 3)

    def test_orm_refuses_to_modify_or_delete(self):
        event = record("login_failed", email="a@example.ci")
        event.ip = "6.6.6.6"
        for attempt in (event.save, event.delete, AuditEvent.objects.all().delete,
                        lambda: AuditEvent.objects.update(ip="6.6.6.6")):
            with self.subTest(attempt=attempt), self.assertRaises(AppendOnlyError):
                attempt()

    def test_database_refuses_raw_sql_too(self):
        record("login_failed", email="a@example.ci")
        for sql in ("UPDATE audit_auditevent SET ip = '6.6.6.6'", "DELETE FROM audit_auditevent"):
            with self.subTest(sql=sql), self.assertRaises(DatabaseError), transaction.atomic():
                connection.cursor().execute(sql)
        self.assertEqual(AuditEvent.objects.count(), 1)

    def test_a_row_edited_in_the_file_is_detected(self):
        _, tampered, _ = self.three_events()
        with connection.cursor() as cursor:  # l'attaquant a accès au fichier et retire les triggers
            drop_audit_trigger("audit_auditevent_no_update")
            cursor.execute("UPDATE audit_auditevent SET actor_email = 'innocent@example.ci' WHERE id = %s", [tampered.pk])

        report = verify_chain()
        self.assertFalse(report.ok)
        self.assertEqual(report.broken_id, tampered.pk)
        self.assertIn("modifié", report.reason)

    def test_a_row_deleted_in_the_file_is_detected(self):
        _, removed, following = self.three_events()
        with connection.cursor() as cursor:
            drop_audit_trigger("audit_auditevent_no_delete")
            cursor.execute("DELETE FROM audit_auditevent WHERE id = %s", [removed.pk])

        report = verify_chain()
        self.assertFalse(report.ok)
        self.assertEqual(report.broken_id, following.pk)
        self.assertIn("maillon rompu", report.reason)

    def test_truncate_is_refused_on_postgresql(self):
        if connection.vendor != "postgresql":
            self.skipTest("TRUNCATE ne se bloque que sur PostgreSQL")
        record("login_failed", email="a@example.ci")
        with self.assertRaises(DatabaseError), transaction.atomic():
            connection.cursor().execute("TRUNCATE audit_auditevent")
        self.assertEqual(AuditEvent.objects.count(), 1)

    @FAST_HASHER
    def test_deleting_an_account_keeps_its_history(self):
        user = make_user("parti@example.ci")
        record("login_succeeded", actor=user)
        user.delete()

        self.assertEqual(AuditEvent.objects.get().actor_email, "parti@example.ci")
        self.assertTrue(verify_chain().ok)


class BusinessEventTests(ApiTestCase):
    def test_order_status_change_records_who_what_and_from_where(self):
        shop = make_shop("maison-test")
        owner = make_member("owner@example.ci", shop, "owner")
        order = make_order(shop)
        self.authenticate(owner)
        self.client.patch(f"/api/v1/shops/maison-test/orders/{order.pk}", {"status": "confirmed"})

        event = AuditEvent.objects.get(action="order_status_changed")
        self.assertEqual((event.actor_email, event.shop_slug, event.target_label), ("owner@example.ci", "maison-test", order.reference))
        self.assertEqual(event.metadata, {"previous_status": "pending", "new_status": "confirmed"})
        self.assertEqual(event.ip, CLIENT_IP)
        self.assertTrue(event.request_id.startswith("req_"))


@FAST_HASHER
class AdminLoginTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.admin = make_user("admin@example.ci", is_staff=True, is_superuser=True)
        self.secret, _ = enable_mfa(self.admin)

    def log_in(self, email, password=PASSWORD, code=""):
        return self.client.post(f"{ADMIN}login/", {"username": email, "password": password, "otp_code": code, "next": ADMIN})

    def test_password_and_code_open_the_admin(self):
        response = self.log_in("admin@example.ci", code=totp(self.secret))

        self.assertRedirects(response, ADMIN, fetch_redirect_response=False)
        self.assertTrue(AuditEvent.objects.filter(action="admin_login_succeeded").exists())

    def test_password_alone_is_not_enough(self):
        response = self.log_in("admin@example.ci", code=wrong_code(self.secret))

        self.assertContains(response, "Code de double authentification invalide")
        self.assertNotIn("_auth_user_id", self.client.session)
        self.assertTrue(AuditEvent.objects.filter(action="admin_login_failed").exists())

    def test_staff_without_2fa_is_turned_away(self):
        make_user("staff@example.ci", is_staff=True)
        response = self.log_in("staff@example.ci", code="123456")

        self.assertContains(response, "obligatoire")
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_merchants_cannot_enter_even_with_2fa(self):
        merchant = make_user("marchand@example.ci")
        secret, _ = enable_mfa(merchant)
        self.log_in("marchand@example.ci", code=totp(secret))
        self.assertNotIn("_auth_user_id", self.client.session)

    def test_admin_login_shares_the_account_lock(self):
        for _ in range(5):
            self.log_in("admin@example.ci", password="ce-n-est-pas-le-bon")
        response = self.log_in("admin@example.ci", code=totp(self.secret))

        self.assertContains(response, "Trop de tentatives")
        self.assertNotIn("_auth_user_id", self.client.session)


@FAST_HASHER
class AuditAdminTests(TestCase):
    def setUp(self):
        self.client = Client()
        self.admin = make_user("admin@example.ci", is_staff=True, is_superuser=True)
        self.client.force_login(self.admin)
        self.event = record("login_failed", email='=HYPERLINK("http://piege.example")')
        self.url = f"{ADMIN}audit/auditevent/"

    def test_journal_lists_events_with_the_24h_summary(self):
        response = self.client.get(self.url)

        self.assertContains(response, "Dernières 24 h")
        self.assertContains(response, "akw-sev--watch")
        self.assertContains(response, "Vérifier l'intégrité")

    def test_summary_filter_links_work(self):
        response = self.client.get(f"{self.url}?action__in=login_failed,admin_login_failed")
        self.assertEqual(response.status_code, 200)

    def test_journal_is_read_only_even_for_a_superuser(self):
        self.assertEqual(self.client.get(f"{self.url}add/").status_code, 403)
        self.assertEqual(self.client.post(f"{self.url}{self.event.pk}/delete/").status_code, 403)
        detail = self.client.get(f"{self.url}{self.event.pk}/change/")
        self.assertEqual(detail.status_code, 200)
        self.assertFalse(detail.context["has_change_permission"])

    def test_verify_button_reports_an_intact_journal(self):
        response = self.client.get(f"{self.url}verifier/", follow=True)

        messages = [str(m) for m in get_messages(response.wsgi_request)]
        self.assertTrue(any(m.startswith("Journal intact") for m in messages), messages)
        self.assertTrue(AuditEvent.objects.filter(action="audit_verified", actor_id=self.admin.pk).exists())

    def test_export_neutralises_spreadsheet_formulas_and_is_logged(self):
        response = self.client.post(self.url, {"action": "export_csv", "_selected_action": [self.event.pk]})

        rows = list(csv.reader(io.StringIO(response.content.decode("utf-8-sig")), delimiter=";"))
        [cell] = [cell for row in rows[1:] for cell in row if "HYPERLINK" in cell]
        self.assertTrue(cell.startswith("'="), cell)
        self.assertTrue(AuditEvent.objects.filter(action="audit_exported").exists())

    def test_staff_without_permission_cannot_read_the_journal(self):
        intern = make_user("stagiaire@example.ci", is_staff=True)
        self.client.force_login(intern)
        self.assertEqual(self.client.get(self.url).status_code, 403)
