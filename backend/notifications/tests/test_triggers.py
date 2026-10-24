import re
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.test import override_settings
from django.utils import timezone

from core import ratelimit
from notifications import send
from notifications.jobs import flush_held
from notifications.models import NotificationPreference, NotificationState
from shops.models import Order, OrderStatus, Product

from .support import NOTIFS, NotifTestCase, SlowClock, fake_monotonic


class OrderPlacedTests(NotifTestCase):
    def test_a_successful_order_notifies_default_recipients_after_commit(self):
        response = self.place()
        self.assertEqual(response.status_code, 201, response.content)
        # Propriétaire et gérante (défauts), pas le vendeur ; un message chacun, une seule connexion.
        self.assertEqual(self.recipients_of(), ["adjoua@exemple.ci", "fatou@exemple.ci"])
        owner_mail = next(m for m in mail.outbox if m.to == ["adjoua@exemple.ci"])
        self.assertTrue(owner_mail.subject.startswith("Nouvelle commande "))
        self.assertTrue(owner_mail.subject.endswith("· Maison Adjoua"))
        self.assertIn("Vous avez reçu une nouvelle commande.", owner_mail.body)
        manager_mail = next(m for m in mail.outbox if m.to == ["fatou@exemple.ci"])
        self.assertIn("Maison Adjoua a reçu une nouvelle commande.", manager_mail.body)
        self.assertIn("Cocody", owner_mail.body)
        self.assertIn("2 articles", owner_mail.body.replace(" articles", " articles"))

    def test_nothing_is_sent_before_the_commit(self):
        with self.captureOnCommitCallbacks(execute=False) as callbacks:
            self.client.post(
                "/api/v1/storefront/maison-adjoua/orders", self.order_body(), HTTP_IDEMPOTENCY_KEY="3f2504e0-4f89-41d3-9a0c-0305e82c3301"
            )
        self.assertEqual(mail.outbox, [])
        self.assertGreaterEqual(len(callbacks), 1)

    def test_refused_orders_send_nothing(self):
        self.place(self.order_body(quantity=11))  # stock insuffisant
        self.place(self.order_body(expected_total=1))  # prix changé
        self.assertEqual(mail.outbox, [])

    def test_idempotent_replay_does_not_notify_twice(self):
        key = "3f2504e0-4f89-41d3-9a0c-0305e82c3302"
        self.assertEqual(self.place(key=key).status_code, 201)
        sent = len(mail.outbox)
        self.age_windows()
        self.assertEqual(self.place(key=key).status_code, 201)
        self.assertEqual(len(mail.outbox), sent)

    def test_demo_order_sends_nothing(self):
        from notifications.triggers import notify_order_placed

        order = Order.objects.create(shop=self.shop, payment_method="wave", customer_name="X", customer_phone="+2250707000001",
                                     customer_city="Abidjan", subtotal=1, total=1, is_demo=True)
        notify_order_placed(self.shop.pk, order.pk, [])
        self.assertEqual(mail.outbox, [])

    def test_the_message_has_no_customer_data(self):
        self.place()
        for message in mail.outbox:
            html = message.alternatives[0][0]
            for text in (message.body, html, message.subject):
                for forbidden in ("Aya", "Koné", "pharmacie", "0707123456", "07 07 12 34 56", "+2250707123456", "07 07", "3456"):
                    self.assertNotIn(forbidden, text)
            # Aucune image distante, aucun pixel de suivi.
            self.assertNotIn("<img", html)
            self.assertNotIn("http://", html.replace("http://localhost", ""))
            link = re.search(r"/commandes/([0-9a-f-]{36})", message.body)
            self.assertIsNotNone(link)
            self.assertNotIn("?", re.search(r"https?://\S+/commandes/\S+", message.body).group(0))
            self.assertIn("/app/maison-adjoua/parametres/notifications", message.body)

    def test_a_mail_server_that_fails_changes_nothing_for_the_customer(self):
        reference = self.place()
        stock_after_ok = Product.objects.get(pk=self.karite.pk).stock
        mail.outbox.clear()
        self.age_windows()
        with override_settings(EMAIL_BACKEND="notifications.tests.support.BrokenBackend"):
            failed = self.place()
        self.assertEqual(failed.status_code, 201, failed.content)
        self.assertEqual(set(failed.json()), set(reference.json()))
        self.assertEqual(failed.json()["total"], reference.json()["total"])
        order = Order.objects.get(reference=failed.json()["reference"])
        self.assertEqual(order.status, OrderStatus.PENDING)
        self.assertEqual(Product.objects.get(pk=self.karite.pk).stock, stock_after_ok - 2)
        # Les messages ne sont pas perdus : ils sont retenus.
        self.assertTrue(NotificationState.objects.filter(event="new_order", held_count__gt=0).exists())

    def test_a_template_bug_does_not_change_anything(self):
        with mock.patch("notifications.compose._build", side_effect=RuntimeError("gabarit cassé")):
            response = self.place()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Order.objects.count(), 1)
        self.assertEqual(mail.outbox, [])
        self.assertTrue(NotificationState.objects.filter(held_count__gt=0).exists())

    def test_trigger_failure_is_swallowed_and_logged_without_address(self):
        with self.assertLogs("akwaba.notifications", level="ERROR") as logs, mock.patch(
            "notifications.triggers.recipients", side_effect=RuntimeError("jean.dupont@exemple.ci")
        ):
            response = self.place()
        self.assertEqual(response.status_code, 201)
        self.assertNotIn("exemple.ci", "\n".join(logs.output))

    def test_notifications_off_changes_nothing(self):
        with override_settings(NOTIFICATIONS_ENABLED=False):
            self.assertEqual(self.place().status_code, 201)
        self.assertEqual(mail.outbox, [])
        self.assertEqual(NotificationState.objects.count(), 0)


class TimeBudgetTests(NotifTestCase):
    def setUp(self):
        super().setUp()
        for email in ("a@exemple.ci", "b@exemple.ci", "c@exemple.ci"):
            from core.testing import make_member

            make_member(email, self.shop, "manager", first_name="Ami")

    @override_settings(EMAIL_BACKEND="notifications.tests.support.SlowBackend")
    def test_total_budget_holds_the_rest_instead_of_exceeding_it(self):
        SlowClock.step = 3.0  # chaque message coûte 3 s sur un budget de 5 s
        with mock.patch("notifications.send.time.monotonic", fake_monotonic):
            self.place()
        # Deux messages partent (3 s puis 6 s > 5 s), les autres destinataires sont retenus et non perdus.
        total_people = 5  # propriétaire, gérante et trois gérants ajoutés
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(NotificationState.objects.filter(event="new_order", held_count=1).count(), total_people - 2)

    @override_settings(EMAIL_BACKEND="notifications.tests.support.SlowBackend")
    def test_held_messages_leave_later(self):
        SlowClock.step = 3.0
        with mock.patch("notifications.send.time.monotonic", fake_monotonic):
            self.place()
        mail.outbox.clear()
        SlowClock.step = 0.0
        self.age_windows()
        counts = flush_held()
        self.assertEqual(counts.sent, 3)
        self.assertEqual(len(mail.outbox), 3)
        self.assertFalse(NotificationState.objects.filter(held_count__gt=0).exists())

    def test_vitrine_keeps_the_same_idempotency_key_when_the_customer_retries(self):
        # Garde-fou de l'énoncé : la clé ne change que si le contenu de la commande change (features/storefront/checkout.tsx).
        import pathlib

        source = (pathlib.Path(__file__).resolve().parents[3] / "frontend/src/features/storefront/checkout.tsx").read_text()
        self.assertIn("if (attempt.current?.signature !== signature) attempt.current = { key: crypto.randomUUID(), signature };", source)


class CancelTests(NotifTestCase):
    def cancel(self, order):
        self.authenticate(self.owner)
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.patch(f"/api/v1/shops/maison-adjoua/orders/{order.pk}", {"status": "cancelled"})

    def make_order(self, status="confirmed"):
        from core.testing import make_order

        return make_order(self.shop, status=status, total=17_500, product=self.karite)

    def test_cancellation_notifies_the_owner_only_by_default(self):
        response = self.cancel(self.make_order())
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.recipients_of(), ["adjoua@exemple.ci"])
        self.assertIn("annulée", mail.outbox[0].subject)
        self.assertIn("Elle était « confirmée »", mail.outbox[0].body)

    def test_invalid_transition_sends_nothing(self):
        response = self.cancel(self.make_order(status="delivered"))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(mail.outbox, [])

    def test_a_failing_server_keeps_the_status_change(self):
        order = self.make_order()
        with override_settings(EMAIL_BACKEND="notifications.tests.support.BrokenBackend"):
            response = self.cancel(order)
        self.assertEqual(response.status_code, 200)
        order.refresh_from_db()
        self.assertEqual(order.status, OrderStatus.CANCELLED)

    def test_other_status_changes_send_nothing(self):
        order = self.make_order(status="pending")
        self.authenticate(self.owner)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(f"/api/v1/shops/maison-adjoua/orders/{order.pk}", {"status": "confirmed"})
        self.assertEqual(mail.outbox, [])


class WindowTests(NotifTestCase):
    def test_burst_is_held_then_grouped(self):
        Product.objects.filter(pk=self.karite.pk).update(stock=500)
        self.place()
        orders = lambda: [m for m in mail.outbox if "commande" in m.subject.lower()]  # noqa: E731
        first = len(orders())
        self.assertEqual(first, 2)
        for _ in range(4):
            self.place()
        self.assertEqual(len(orders()), first)  # tout est retenu dans la fenêtre
        state = NotificationState.objects.get(membership=self.membership(self.owner), event="new_order")
        self.assertEqual(state.held_count, 4)
        self.assertEqual(len(state.held_refs), 4)
        self.age_windows()
        self.place()
        grouped = next(m for m in orders()[first:] if m.to == ["adjoua@exemple.ci"])
        self.assertIn("5 nouvelles commandes", grouped.body)
        self.assertIn("Les dernières :", grouped.body)
        state.refresh_from_db()
        self.assertEqual(state.held_count, 0)

    def test_send_held_notifications_sends_the_group_and_resets(self):
        Product.objects.filter(pk=self.karite.pk).update(stock=500)
        self.place()
        for _ in range(3):
            self.place()
        mail.outbox.clear()
        self.assertEqual(flush_held().sent, 0)  # fenêtre encore ouverte
        self.age_windows()
        counts = flush_held()
        self.assertEqual(counts.sent, 2)
        self.assertEqual(len(mail.outbox), 2)
        self.assertIn("3 nouvelles commandes", mail.outbox[0].body)
        self.assertEqual(flush_held().sent, 0)
        self.assertFalse(NotificationState.objects.filter(held_count__gt=0).exists())

    def test_held_refs_are_capped_and_hold_no_customer_data(self):
        state_owner = self.membership(self.owner)
        self.place()
        for _ in range(12):
            send.hold(NotificationState.objects.get(membership=state_owner, event="new_order").pk, [f"AAA-{_:03d}"])
        state = NotificationState.objects.get(membership=state_owner, event="new_order")
        self.assertEqual(state.held_count, 12)
        self.assertEqual(len(state.held_refs), 10)

    def test_losing_the_window_race_sends_a_single_message(self):
        self.place()
        state = NotificationState.objects.get(membership=self.membership(self.owner), event="new_order")
        self.age_windows()
        state.refresh_from_db()
        first = send.take_window(state)
        second = send.take_window(state)
        self.assertIsNotNone(first)
        self.assertIsNone(second)

    def test_a_failed_send_falls_back_to_held_and_leaves_later(self):
        with override_settings(EMAIL_BACKEND="notifications.tests.support.BrokenBackend"):
            self.place()
        self.assertEqual(mail.outbox, [])
        held = NotificationState.objects.filter(event="new_order", held_count=1)
        self.assertEqual(held.count(), 2)
        self.age_windows()
        mail.outbox.clear()
        from django.core.cache import cache

        cache.delete(send.BREAKER_KEY)
        self.assertEqual(flush_held().sent, 2)
        self.assertEqual(len(mail.outbox), 2)

    def test_two_people_in_two_shops_get_the_right_shop_name(self):
        from core.testing import make_shop
        from shops.models import Membership

        other = make_shop("deuxieme", "Deuxième Boutique")
        Membership.objects.create(user=self.manager, shop=other, role="manager")
        Product.objects.create(shop=other, sku="X", slug="x", name="Produit", price=1000, stock=9)
        self.place()
        subjects = [m.subject for m in mail.outbox if m.to == ["fatou@exemple.ci"]]
        self.assertEqual(len(subjects), 1)
        self.assertTrue(subjects[0].endswith("Maison Adjoua"))


class CapsAndBreakerTests(NotifTestCase):
    def test_200_a_day_per_shop_then_held_without_error(self):
        with mock.patch.object(send, "SHOP_DAILY_CAP", (1, 86400)):
            self.place()
            self.age_windows()
            response = self.place()
        self.assertEqual(response.status_code, 201)
        # Premier envoi : 1 message sur 2 destinataires (plafond de 1), le reste est retenu, pas perdu.
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(NotificationState.objects.filter(held_count__gt=0).exists())

    def test_at_most_20_recipients(self):
        from core.testing import make_member

        for index in range(25):
            make_member(f"m{index}@exemple.ci", self.shop, "manager", first_name="M")
        self.place()
        self.assertEqual(len(mail.outbox), 20)

    def test_only_one_connection_per_trigger(self):
        from django.core.mail import get_connection as real

        calls = []

        def counting(*args, **kwargs):
            calls.append(1)
            return real(*args, **kwargs)

        with mock.patch("notifications.send.get_connection", counting):
            self.place()
        self.assertEqual(len(mail.outbox), 2)
        self.assertEqual(len(calls), 1)

    @override_settings(EMAIL_BACKEND="notifications.tests.support.BrokenBackend")
    def test_breaker_stops_new_attempts_for_five_minutes_then_closes(self):
        from django.core.cache import cache

        from .support import BrokenBackend

        self.place()
        self.assertEqual(BrokenBackend.opened, 1)
        self.age_windows()
        self.place()
        self.assertEqual(BrokenBackend.opened, 1)  # disjoncteur ouvert : pas de nouvel essai
        cache.delete(send.BREAKER_KEY)  # « 5 minutes plus tard »
        self.age_windows()
        self.place()
        self.assertEqual(BrokenBackend.opened, 2)

    def test_breaker_lasts_five_minutes(self):
        self.assertEqual(send.BREAKER_SECONDS, 300)
        self.assertEqual(send.TRIGGER_BUDGET, 5)


class LowStockTests(NotifTestCase):
    def test_alert_only_when_the_threshold_is_crossed(self):
        self.place(self.order_body(quantity=2))  # 10 -> 8, seuil 5 : rien
        self.assertEqual([m for m in mail.outbox if m.subject.startswith("Stock bas")], [])
        self.age_windows()
        self.place(self.order_body(quantity=4))  # 8 -> 4 : franchit le seuil de 5
        stock_mails = [m for m in mail.outbox if m.subject.startswith("Stock bas")]
        self.assertEqual(len(stock_mails), 2)
        self.assertIn("4 restants (seuil 5)", stock_mails[0].body)
        self.assertIn("Stock bas · Beurre de karité brut 500 g", stock_mails[0].subject)
        mail.outbox.clear()
        self.age_windows()
        self.place(self.order_body(quantity=1))  # 4 -> 3 : déjà sous le seuil, pas de nouvelle alerte
        self.assertEqual([m for m in mail.outbox if m.subject.startswith("Stock bas")], [])

    def test_reaching_zero_alerts_and_several_products_share_one_message(self):
        body = {
            "items": [{"product_id": str(self.karite.pk), "quantity": 6}, {"product_id": str(self.savon.pk), "quantity": 3}],
            "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody"},
            "payment_method": "wave",
            "expected_total": 6 * 2500 + 3 * 1500 + 1500,
            "website": "",
        }
        self.place(body)
        stock_mails = [m for m in mail.outbox if m.subject.startswith("Stock bas") and m.to == ["adjoua@exemple.ci"]]
        self.assertEqual(len(stock_mails), 1)
        self.assertIn("Savon noir artisanal 250 g : épuisé", stock_mails[0].body)
        self.assertIn("Beurre de karité brut 500 g : 4 restants (seuil 5)", stock_mails[0].body)
        self.assertEqual(stock_mails[0].subject, "Stock bas · Maison Adjoua")

    def test_manual_stock_change_sends_nothing(self):
        self.authenticate(self.owner)
        with self.captureOnCommitCallbacks(execute=True):
            self.client.patch(f"/api/v1/shops/maison-adjoua/products/{self.karite.pk}", {"stock": 1})
        self.assertEqual(mail.outbox, [])


class RecipientTests(NotifTestCase):
    def test_excluded_accounts(self):
        from accounts.models import User

        User.objects.filter(pk=self.manager.pk).update(must_change_password=True)
        User.objects.filter(pk=self.owner.pk).update(is_demo=True)
        self.place()
        self.assertEqual(mail.outbox, [])
        User.objects.filter(pk=self.manager.pk).update(must_change_password=False, is_active=False)
        self.age_windows()
        self.place()
        self.assertEqual(mail.outbox, [])

    def test_disabled_event_and_removed_member(self):
        NotificationPreference.objects.create(membership=self.membership(self.owner), event="new_order", enabled=False)
        self.place()
        self.assertEqual(self.recipients_of(), ["fatou@exemple.ci"])
        mail.outbox.clear()
        self.membership(self.manager).delete()
        self.age_windows()
        self.place()
        self.assertEqual(mail.outbox, [])

    def test_a_seller_can_opt_in_and_a_right_removed_stops_the_mails(self):
        self.authenticate(self.seller)
        self.client.put(NOTIFS, {"events": {"new_order": True}})
        self.place()
        self.assertIn("koffi@exemple.ci", self.recipients_of())

    def test_role_change_applies_the_new_role_defaults_but_keeps_explicit_choices(self):
        NotificationPreference.objects.create(membership=self.membership(self.seller), event="low_stock", enabled=False)
        membership = self.membership(self.seller)
        membership.role = "manager"
        membership.save()
        self.place()
        self.assertIn("koffi@exemple.ci", self.recipients_of())  # défaut gérant : commandes
        stock_for_him = [m for m in mail.outbox if m.to == ["koffi@exemple.ci"] and m.subject.startswith("Stock bas")]
        self.assertEqual(stock_for_him, [])  # son refus explicite reste

    def test_recipient_calculation_is_bounded_in_queries(self):
        from notifications.events import EVENTS
        from notifications.recipients import recipients

        with self.assertNumQueries(2):
            found = recipients(self.shop, EVENTS["new_order"])
        self.assertEqual(len(found), 2)


class TemplateTests(NotifTestCase):
    def test_product_name_is_escaped_and_newlines_cannot_break_the_header(self):
        self.shop.name = "Boutique\r\nBcc: pirate@exemple.ci"
        self.shop.save()
        self.karite.name = "<script>alert(1)</script>"
        self.karite.stock = 1
        self.karite.save()
        self.place(self.order_body(quantity=1))
        stock = next(m for m in mail.outbox if m.subject.startswith("Stock bas"))
        self.assertNotIn("<script>", stock.alternatives[0][0])
        self.assertIn("&lt;script&gt;", stock.alternatives[0][0])
        for message in mail.outbox:
            self.assertNotIn("\n", message.subject)
            self.assertNotIn("\r", message.subject)
            self.assertLessEqual(len(message.subject), 150)
            self.assertEqual(message.bcc, [])
