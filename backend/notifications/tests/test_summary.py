from datetime import date, timedelta
from io import StringIO
from unittest import mock

from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone

from core.testing import make_order
from notifications.models import NotificationPreference, NotificationState
from shops.models import OrderStatus
from shops.permissions import ROLE_PERMISSIONS

from .support import NotifTestCase


def run(*args, **kwargs):
    out = StringIO()
    call_command("send_daily_summaries", *args, stdout=out, **kwargs)
    return out.getvalue()


class SummaryTests(NotifTestCase):
    def setUp(self):
        super().setUp()
        self.today = timezone.localdate()
        make_order(self.shop, total=87_500, status="confirmed", product=self.karite)
        make_order(self.shop, total=12_345, status="cancelled", product=self.karite)

    def summary_mails(self):
        return [m for m in mail.outbox if m.subject.startswith("Résumé du jour")]

    def test_sent_once_a_day_to_default_recipients_with_revenue_for_who_may_read_it(self):
        run()
        self.assertEqual(self.recipients_of(self.summary_mails()), ["adjoua@exemple.ci", "fatou@exemple.ci"])
        owner = next(m for m in self.summary_mails() if m.to == ["adjoua@exemple.ci"])
        self.assertIn("Commandes reçues : 2 (dont 1 annulée)", owner.body)
        self.assertIn("Chiffre d'affaires du jour : 87 500 F", owner.body)
        self.assertNotIn("12 345", owner.body)  # l'annulée ne compte pas dans le CA
        mail.outbox.clear()
        self.assertIn("0 envoyés", run())  # relancer ne renvoie rien
        self.assertEqual(mail.outbox, [])

    def test_no_revenue_without_the_dashboard_right(self):
        NotificationPreference.objects.create(membership=self.membership(self.seller), event="daily_summary", enabled=True)
        reduced = ROLE_PERMISSIONS["manager"] - {"dashboard.view"}
        with mock.patch.dict(ROLE_PERMISSIONS, {"manager": frozenset(reduced)}):
            run()
        for mail_ in self.summary_mails():
            if mail_.to == ["adjoua@exemple.ci"]:
                continue
            html = mail_.alternatives[0][0]
            for text in (mail_.body, html):
                self.assertNotIn("Chiffre d'affaires", text)
                self.assertNotIn("87 500", text)
                self.assertNotIn("87 500", text)
                self.assertNotIn("non communiqué", text)
            self.assertIn("/commandes", mail_.body)
            self.assertNotIn("/parametres/notifications/commandes", mail_.body)
        self.assertEqual(len(self.summary_mails()), 3)

    def test_a_seller_summary_has_no_revenue(self):
        NotificationPreference.objects.create(membership=self.membership(self.seller), event="daily_summary", enabled=True)
        run()
        seller = next(m for m in self.summary_mails() if m.to == ["koffi@exemple.ci"])
        self.assertNotIn("Chiffre d'affaires", seller.body)
        self.assertNotIn("87", seller.body)

    def test_no_empty_message(self):
        from shops.models import Order

        Order.objects.all().delete()
        run()
        self.assertEqual(mail.outbox, [])

    def test_a_failure_puts_the_date_back_so_a_rerun_sends_again(self):
        with override_settings(EMAIL_BACKEND="notifications.tests.support.BrokenBackend"):
            with self.assertRaises(CommandError):
                run()  # code de sortie ≠ 0 : tout a échoué
        self.assertFalse(NotificationState.objects.filter(last_summary_on__isnull=False).exists())
        from django.core.cache import cache

        cache.delete("notify:breaker")  # le disjoncteur se referme au bout de 5 minutes
        run()
        self.assertEqual(len(self.summary_mails()), 2)

    def test_dry_run_sends_and_notes_nothing(self):
        output = run("--dry-run")
        self.assertEqual(mail.outbox, [])
        self.assertFalse(NotificationState.objects.filter(last_summary_on__isnull=False).exists())
        self.assertNotIn("@", output)  # jamais d'adresse
        self.assertIn("2 à envoyer", output)

    def test_future_date_is_refused_and_bad_format_too(self):
        with self.assertRaises(CommandError):
            run("--date", (self.today + timedelta(days=1)).isoformat())
        with self.assertRaises(CommandError):
            run("--date", "hier")

    def test_day_bounds_are_abidjan_midnight(self):
        from notifications.jobs import day_figures

        make_order(self.shop, total=5_000, status="confirmed", age=timedelta(days=1, hours=1))
        yesterday = self.today - timedelta(days=1)
        self.assertEqual(day_figures(self.shop, self.today)["received"], 2)
        self.assertEqual(day_figures(self.shop, yesterday)["received"], 1)

    def test_demo_orders_are_not_counted_and_demo_shops_get_nothing(self):
        from accounts.models import User

        make_order(self.shop, total=999_999, status="confirmed", is_demo=True)
        run()
        owner = next(m for m in self.summary_mails() if m.to == ["adjoua@exemple.ci"])
        self.assertNotIn("999", owner.body)
        mail.outbox.clear()
        NotificationState.objects.all().delete()
        User.objects.all().update(is_demo=True)
        run()
        self.assertEqual(mail.outbox, [])

    def test_disabled_notifications_do_nothing_and_say_so(self):
        with override_settings(NOTIFICATIONS_ENABLED=False):
            self.assertIn("désactivées", run())
        self.assertEqual(mail.outbox, [])

    def test_held_messages_leave_before_the_summary(self):
        from shops.models import Product

        Product.objects.filter(pk=self.karite.pk).update(stock=500)
        for _ in range(3):
            self.place()
        mail.outbox.clear()
        self.age_windows()
        run()
        subjects = [m.subject for m in mail.outbox]
        first_summary = next(i for i, s in enumerate(subjects) if s.startswith("Résumé du jour"))
        self.assertTrue(any("commande" in s.lower() and not s.startswith("Résumé") for s in subjects[:first_summary]))

    def test_one_shop_option(self):
        run("--shop", "inconnue")
        self.assertEqual(mail.outbox, [])


class SecurityMailsUntouchedTests(NotifTestCase):
    @override_settings(NOTIFICATIONS_ENABLED=False)
    def test_security_alerts_do_not_depend_on_notifications(self):
        from accounts.emails import send_security_alert

        send_security_alert(self.owner, "new_device")
        self.assertEqual(len(mail.outbox), 1)
        NotificationPreference.objects.create(membership=self.membership(self.owner), event="new_order", enabled=False)
        send_security_alert(self.owner, "password_changed")
        self.assertEqual(len(mail.outbox), 2)

    def test_send_test_emails_command_sends_both_messages_to_one_existing_account(self):
        call_command("send_test_emails", "adjoua@exemple.ci", stdout=StringIO())
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual({tuple(m.to) for m in mail.outbox}, {("adjoua@exemple.ci",)})
        self.assertTrue(any("Nouvelle connexion" in m.subject for m in mail.outbox))
        with self.assertRaises(CommandError):
            call_command("send_test_emails", "inconnu@exemple.ci", stdout=StringIO())
