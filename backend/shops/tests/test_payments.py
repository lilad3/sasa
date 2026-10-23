"""Paiements par boutique (docs/chantier-a2-paiements-livraison.md §3, §4 et revue sécurité d'Alice)."""

import uuid
from datetime import timedelta
from unittest import skipUnless

from django.core import mail
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_shop
from shops.models import Discount, Order, Product, ShopPaymentMethod
from shops.payments import PENDING_DELAY

PASSWORD = "pirogue-lagune-mangue"
BASE = "/api/v1/shops/maison-test/payment-settings"
STORE = "/api/v1/storefront/maison-test"
WAVE, WAVE2, ORANGE = "+2250707123456", "+2250505112233", "+2250101998877"


def reauth(client):
    return client.post("/api/v1/auth/reauth", {"password": PASSWORD})


def body(**per_method):
    """Les 5 moyens, tous actifs, sans numéro, sauf ce que le test précise : body(wave=("07 07 12 34 56", "Aya Boutique"))."""
    methods = []
    for method in ("cash_on_delivery", "orange_money", "mtn_momo", "moov_money", "wave"):
        item = {"method": method, "enabled": True, "payout_number": "", "payout_name": ""}
        override = per_method.get(method)
        if isinstance(override, dict):
            item.update(override)
        elif override:
            item.update(payout_number=override[0], payout_name=override[1])
        methods.append(item)
    return {"methods": methods}


class PaymentTestCase(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.owner = make_member("owner@example.ci", self.shop, "owner", first_name="Adjoua")
        self.partner = make_member("partner@example.ci", self.shop, "owner", first_name="Koffi")
        self.manager = make_member("manager@example.ci", self.shop, "manager")
        self.seller = make_member("seller@example.ci", self.shop, "seller")
        self.other_shop = make_shop("autre-boutique")
        self.stranger = make_member("stranger@example.ci", self.other_shop, "owner")
        self.off = {}  # moyens éteints dans le corps des requêtes (selon la boutique du test)

    def body(self, **per_method):
        return body(**{**self.off, **per_method})

    def row(self, method="wave"):
        return ShopPaymentMethod.objects.get(shop=self.shop, method=method)

    def as_owner(self, confirmed=True):
        self.authenticate(self.owner)
        if confirmed:
            self.assertEqual(reauth(self.client).status_code, 200)

    def put(self, payload):
        return self.client.put(BASE, payload, format="json")

    def set_wave(self, number="07 07 12 34 56", name="Aya Boutique"):
        response = self.put(self.body(wave=(number, name)))
        self.assertEqual(response.status_code, 200, response.content)
        return response


class PaymentRightsTests(PaymentTestCase):
    def test_only_the_owner_reads_and_writes(self):
        self.as_owner(confirmed=False)
        self.assertEqual(self.client.get(BASE).status_code, 200)
        for user, status in ((self.manager, 403), (self.seller, 403), (self.stranger, 404)):
            self.authenticate(user)
            self.assertEqual(self.client.get(BASE).status_code, status)
            self.assertEqual(self.put(body()).status_code, status)

    def test_a_manager_with_every_grant_is_still_refused_and_cannot_be_given_shop_manage(self):
        self.authenticate(self.owner)
        reauth(self.client)
        granted = self.client.patch(
            f"/api/v1/shops/maison-test/members/{self.manager.pk}",
            {"grants": ["team.manage_sellers", "team.presence", "storefront.edit", "discounts.give", "customers.export"], "discount_cap_percent": 10},
            format="json",
        )
        self.assertEqual(granted.status_code, 200, granted.content)
        refused = self.client.patch(f"/api/v1/shops/maison-test/members/{self.manager.pk}", {"grants": ["shop.manage"]}, format="json")
        self.assertEqual(refused.status_code, 400, refused.content)
        self.authenticate(self.manager)
        reauth(self.client)
        self.assertProblem(self.client.get(BASE), 403, "permission_denied")
        self.assertProblem(self.put(body(wave=("07 07 12 34 56", "Aya Boutique"))), 403, "permission_denied")

    def test_demo_accounts_are_refused_before_anything_else(self):
        self.owner.is_demo = True
        self.owner.save()
        self.as_owner()
        # Même avec un corps invalide : le compte de démo ne révèle rien d'autre.
        self.assertProblem(self.put({"methods": []}), 403, "demo_restricted")
        self.assertProblem(self.put(body(wave=("07 07 12 34 56", "Aya Boutique"))), 403, "demo_restricted")


class PayoutConfirmationTests(PaymentTestCase):
    """Revue Alice B1 : sans confirmation d'identité récente, un numéro ne change pas et rien n'est écrit."""

    def test_changing_a_number_without_recent_confirmation_is_403_and_writes_nothing(self):
        self.as_owner(confirmed=False)
        events_before = AuditEvent.objects.count()
        self.assertProblem(self.put(body(wave=("07 07 12 34 56", "Aya Boutique"))), 403, "reauth_required")
        self.assertEqual(self.row().payout_number, "")
        self.assertEqual(self.row().pending_number, "")
        self.assertFalse(self.row().had_number)
        self.assertEqual(AuditEvent.objects.count(), events_before)
        self.assertEqual(len(mail.outbox), 0)

    def test_an_expired_confirmation_is_refused_too(self):
        self.as_owner()
        from accounts.models import UserSession

        UserSession.objects.update(reauth_until=timezone.now() - timedelta(seconds=1))
        self.assertProblem(self.put(body(wave=("07 07 12 34 56", "Aya Boutique"))), 403, "reauth_required")
        self.assertEqual(self.row().payout_number, "")

    def test_a_replacement_without_confirmation_cannot_even_start_the_wait(self):
        self.as_owner()
        self.set_wave()
        from accounts.models import UserSession

        UserSession.objects.update(reauth_until=None)
        self.assertProblem(self.put(body(wave=("05 05 11 22 33", "Aya Boutique"))), 403, "reauth_required")
        self.assertEqual(self.row().pending_number, "")

    def test_toggling_a_method_needs_no_confirmation(self):
        self.as_owner(confirmed=False)
        off = body(orange_money={"enabled": False})
        self.assertEqual(self.put(off).status_code, 200)
        self.assertFalse(self.row("orange_money").enabled)
        self.assertTrue(AuditEvent.objects.filter(action="payment_methods_changed").exists())
        self.assertFalse(AuditEvent.objects.filter(action__startswith="payout_").exists())

    def test_a_put_without_change_writes_no_event_and_no_mail(self):
        self.as_owner()
        self.assertEqual(self.put(body()).status_code, 200)
        self.assertEqual(AuditEvent.objects.filter(action__in=["payment_methods_changed", "payout_number_changed"]).count(), 0)
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(ShopPaymentMethod.objects.filter(shop=self.shop).count(), 5)  # les lignes de départ n'ont pas bougé


class FirstNumberTests(PaymentTestCase):
    def test_the_first_number_serves_at_once_and_alerts_every_owner_with_two_digits_only(self):
        self.as_owner()
        payload = self.set_wave().json()
        wave = next(m for m in payload["methods"] if m["method"] == "wave")
        self.assertEqual((wave["payout_number"], wave["payout_name"], wave["pending"]), (WAVE, "Aya Boutique", None))
        self.assertIn("+225 07 07 12 34 56", wave["example"])
        self.assertIn("Aya Boutique", wave["example"])

        event = AuditEvent.objects.get(action="payout_number_changed")
        self.assertEqual(event.severity, "warning")
        self.assertEqual(event.category, "security")
        self.assertEqual((event.metadata["previous_last2"], event.metadata["new_last2"]), (None, "56"))
        # Un e-mail par propriétaire (pas seulement l'auteur), sans le numéro entier.
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["owner@example.ci", "partner@example.ci"])
        for message in mail.outbox:
            self.assertNotIn("0707123456", message.body.replace(" ", ""))
            self.assertIn("••••56", message.body)
            self.assertIn("Maison Test", message.subject)

    def test_the_whole_number_is_nowhere_in_the_journal_the_mails_or_the_errors(self):
        self.as_owner()
        self.set_wave()
        self.put(body(wave=("05 05 11 22 33", "Aya Boutique")))  # attente
        bad = self.put(body(wave=("0607123456", "Aya Boutique")))  # numéro invalide
        self.assertEqual(bad.status_code, 400)
        self.assertNotIn("0607123456", bad.content.decode())
        digits = ("0707123456", "0505112233")
        for event in AuditEvent.objects.all():
            text = " ".join(str(value) for value in (event.metadata, event.target_label, event.target_id, event.actor_email)).replace(" ", "")
            for number in digits:
                self.assertNotIn(number, text)
        for message in mail.outbox:
            for number in digits:
                self.assertNotIn(number, (message.subject + message.body).replace(" ", ""))
        activity = self.client.get("/api/v1/shops/maison-test/activity")
        for number in digits:
            self.assertNotIn(number, activity.content.decode().replace(" ", ""))

    def test_a_failed_mail_does_not_undo_the_change(self):
        from unittest import mock

        self.as_owner()
        with mock.patch("shops.payment_settings.emails.send_security_alert", side_effect=RuntimeError("smtp")), self.assertLogs("akwaba", "ERROR"):
            self.set_wave()
        self.assertEqual(self.row().payout_number, WAVE)
        self.assertTrue(AuditEvent.objects.filter(action="payout_number_changed").exists())


class PendingNumberTests(PaymentTestCase):
    """Revue Alice B2 : un numéro qui en REMPLACE un autre attend 24 h et peut être annulé d'un clic."""

    def start_wait(self):
        self.as_owner()
        self.set_wave()
        response = self.put(body(wave=("05 05 11 22 33", "Aya Shop")))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_a_replacement_waits_24_hours_and_the_old_number_keeps_serving(self):
        payload = self.start_wait()
        wave = next(m for m in payload["methods"] if m["method"] == "wave")
        self.assertEqual((wave["payout_number"], wave["payout_name"]), (WAVE, "Aya Boutique"))
        self.assertEqual(wave["pending"]["payout_number"], WAVE2)
        self.assertEqual(payload["pending_count"], 1)
        row = self.row()
        self.assertEqual((row.payout_number, row.pending_number), (WAVE, WAVE2))
        self.assertEqual(row.pending_at + PENDING_DELAY, row.pending_at + timedelta(hours=24))
        event = AuditEvent.objects.get(action="payout_number_pending")
        self.assertEqual((event.metadata["previous_last2"], event.metadata["new_last2"]), ("56", "33"))
        self.assertEqual(event.severity, "warning")
        self.assertEqual(AuditEvent.objects.filter(action="payout_number_changed").count(), 1)  # la première saisie seulement
        self.assertIn("va changer", mail.outbox[-1].subject)
        self.assertIn("annulez", mail.outbox[-1].body)

        order = self.place("wave")
        self.assertEqual(order["payment_instructions"]["number"], WAVE)  # le client voit l'ancien

    def test_it_takes_over_after_24_hours_computed_on_read_and_is_journaled_once(self):
        self.start_wait()
        ShopPaymentMethod.objects.filter(pk=self.row().pk).update(pending_at=timezone.now() - timedelta(hours=24, minutes=1))
        # Sans aucune écriture préalable : la lecture publique suffit.
        order = self.place("wave")
        self.assertEqual(order["payment_instructions"]["number"], WAVE2)
        self.assertEqual(order["payment_instructions"]["holder"], "Aya Shop")
        row = self.row()
        self.assertEqual((row.payout_number, row.payout_name, row.pending_number, row.pending_at), (WAVE2, "Aya Shop", "", None))
        self.client.get(BASE)
        self.assertEqual(AuditEvent.objects.filter(action="payout_number_activated").count(), 1)

    def test_just_before_24_hours_the_old_number_still_serves(self):
        self.start_wait()
        ShopPaymentMethod.objects.filter(pk=self.row().pk).update(pending_at=timezone.now() - timedelta(hours=23, minutes=50))
        self.assertEqual(self.place("wave")["payment_instructions"]["number"], WAVE)
        self.assertEqual(AuditEvent.objects.filter(action="payout_number_activated").count(), 0)

    def test_the_owner_cancels_the_wait_in_one_click_without_a_fresh_confirmation(self):
        self.start_wait()
        from accounts.models import UserSession

        UserSession.objects.update(reauth_until=None)  # plus de confirmation récente : annuler protège, donc passe
        response = self.client.delete(f"{BASE}/wave/pending")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.row().pending_number, "")
        self.assertEqual(self.row().payout_number, WAVE)
        event = AuditEvent.objects.get(action="payout_number_cancelled")
        self.assertEqual(event.metadata["pending_last2"], "33")
        self.assertEqual(event.category, "security")
        self.assertEqual(self.place("wave")["payment_instructions"]["number"], WAVE)
        self.assertProblem(self.client.delete(f"{BASE}/wave/pending"), 404, "not_found")  # plus rien à annuler
        self.assertProblem(self.client.delete(f"{BASE}/inconnu/pending"), 404, "not_found")

    def test_only_the_owner_of_the_shop_can_cancel(self):
        self.start_wait()
        for user, status in ((self.manager, 403), (self.seller, 403), (self.stranger, 404)):
            self.authenticate(user)
            self.assertEqual(self.client.delete(f"{BASE}/wave/pending").status_code, status)
        self.assertEqual(self.row().pending_number, WAVE2)

    def test_sending_the_same_form_again_neither_restarts_nor_cancels_the_wait(self):
        self.start_wait()
        before = self.row().pending_at
        self.put(body(wave=("05 05 11 22 33", "Aya Shop")))  # mêmes valeurs que l'attente
        self.put(body(wave=(WAVE, "Aya Boutique")))  # le formulaire renvoie le numéro en service
        self.assertEqual(self.row().pending_at, before)
        self.assertEqual(self.row().pending_number, WAVE2)
        self.assertEqual(AuditEvent.objects.filter(action="payout_number_pending").count(), 1)

    def test_a_third_number_restarts_the_wait(self):
        self.start_wait()
        self.put(body(wave=("01 01 99 88 77", "Aya Shop")))
        row = self.row()
        self.assertEqual((row.payout_number, row.pending_number), (WAVE, ORANGE))
        self.assertEqual(AuditEvent.objects.filter(action="payout_number_pending").count(), 2)

    def test_removing_then_giving_a_number_again_still_waits(self):
        self.as_owner()
        self.set_wave()
        # Retrait du numéro : un moyen actif exige un numéro, donc on l'éteint d'abord ; le retrait vaut tout de suite.
        self.assertEqual(self.put(body(wave={"enabled": False})).status_code, 200)
        self.assertEqual(self.row().payout_number, "")
        self.put(body(wave=("05 05 11 22 33", "Aya Shop")))  # un voleur « redonne » un numéro (et rallume le moyen)
        row = self.row()
        self.assertEqual((row.payout_number, row.pending_number), ("", WAVE2))
        # Pendant l'attente, le client voit le texte de repli, pas le numéro du voleur.
        instructions = self.place("wave")["payment_instructions"]
        self.assertIsNone(instructions["number"])
        self.assertIn("au numéro indiqué lors de la commande", instructions["text"])

    def test_a_name_only_change_needs_confirmation_but_not_the_wait(self):
        self.as_owner()
        self.set_wave()
        self.put(body(wave=(WAVE, "Aya Boutique Cocody")))
        self.assertEqual(self.row().payout_name, "Aya Boutique Cocody")
        self.assertEqual(self.row().pending_number, "")
        event = AuditEvent.objects.filter(action="payout_number_changed").latest("id")
        self.assertTrue(event.metadata["name_changed"])

    def test_the_security_overview_reports_the_change_and_the_wait(self):
        self.start_wait()
        overview = self.client.get("/api/v1/shops/maison-test/security-overview").json()
        self.assertEqual(overview["payout_changed_7d"]["count"], 2)
        self.assertEqual(overview["payout_pending"][0]["method"], "wave")
        self.assertEqual(overview["payout_pending"][0]["new_last2"], "33")
        self.assertNotIn("0505112233", str(overview))

    def test_the_overview_is_quiet_when_nothing_changed(self):
        self.as_owner(confirmed=False)
        overview = self.client.get("/api/v1/shops/maison-test/security-overview").json()
        self.assertIsNone(overview["payout_changed_7d"])
        self.assertEqual(overview["payout_pending"], [])

    def place(self, method, **extra):
        self.client.credentials()
        response = self.client.post(
            f"{STORE}/orders",
            {
                "items": [{"product_id": str(product().pk), "quantity": 1}],
                "customer": {"name": "Aya Koné", "phone": "07 07 00 00 01", "city": "Abidjan", "commune": "Cocody"},
                "payment_method": method,
                **extra,
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )
        self.assertEqual(response.status_code, 201, response.content)
        self.authenticate(self.owner)
        return response.json()


def product():
    from shops.models import Shop

    shop = Shop.objects.get(slug="maison-test")
    return Product.objects.for_shop(shop).first() or Product.objects.create(shop=shop, sku="KAR", slug="karite", name="Karité", price=2500, stock=100)


class PaymentValidationTests(PaymentTestCase):
    def test_bad_numbers_names_and_shapes_are_refused_without_writing(self):
        self.as_owner()
        wave = lambda number, name="Aya Boutique": body(wave=(number, name))  # noqa: E731
        for number in ("0607123456", "070712345", "07071234ab", "<script>", "+22507071234567"):
            response = self.put(wave(number))
            self.assertEqual(response.status_code, 400, number)
            code = response.json()["errors"]["methods.4.payout_number"][0]["code"]
            self.assertIn(code, ("invalid_phone", "invalid_characters"))
        self.assertEqual(self.put(wave("07 07 12 34 56", "x" * 41)).status_code, 400)
        self.assertEqual(self.put(wave("07 07 12 34 56", "<b>Aya</b>")).json()["errors"]["methods.4.payout_name"][0]["code"], "invalid_characters")
        self.assertEqual(self.row().payout_number, "")

    def test_a_number_on_cash_on_delivery_is_refused(self):
        self.as_owner()
        response = self.put(body(cash_on_delivery=("07 07 12 34 56", "Aya")))
        self.assertEqual(response.json()["errors"]["methods.0.payout_number"][0]["code"], "payout_number_not_allowed")

    def test_exactly_the_five_methods_once_each(self):
        self.as_owner()
        short = body()
        short["methods"].pop()
        self.assertProblem(self.put(short), 400, "validation_error")
        twice = body()
        twice["methods"][4] = dict(twice["methods"][3])
        self.assertProblem(self.put(twice), 400, "validation_error")
        self.assertProblem(self.put({"methods": [{**m, "method": "cheque"} for m in body()["methods"]]}), 400, "validation_error")

    def test_names_that_imitate_an_operator_or_a_service_are_refused(self):
        self.as_owner()
        for name in ("Wave", "Orange Money CI", "MTN Service Client", "Moov", "Service client", "Mobile Money Aya", "WAVE-officiel", "Support Akwaba"):
            response = self.put(body(wave=("07 07 12 34 56", name)))
            self.assertEqual(response.status_code, 400, name)
            self.assertEqual(response.json()["errors"]["methods.4.payout_name"][0]["code"], "payout_name_reserved")
        self.assertEqual(self.row().payout_number, "")
        self.assertEqual(self.put(body(wave=("07 07 12 34 56", "Aya Boutique"))).status_code, 200)

    def test_at_least_one_method_stays_active(self):
        self.as_owner()
        off = body()
        for item in off["methods"]:
            item["enabled"] = False
        self.assertProblem(self.put(off), 400, "payment_methods_required")
        self.assertEqual(ShopPaymentMethod.objects.filter(shop=self.shop, enabled=True).count(), 5)

    def test_an_active_mobile_money_needs_number_and_name_when_touched_or_activated(self):
        self.as_owner()
        wave = lambda **kw: body(wave={**kw})  # noqa: E731
        # Un moyen actif sans numéro, qu'on ne touche pas, reste enregistrable (boutiques d'avant le chantier).
        self.assertEqual(self.put(body(orange_money={"enabled": True})).status_code, 200)
        self.assertEqual(self.put(wave(payout_number="07 07 12 34 56")).json()["errors"]["methods.4.payout_name"][0]["code"], "payout_name_required")
        self.assertEqual(self.put(wave(payout_name="Aya")).json()["errors"]["methods.4.payout_number"][0]["code"], "payout_number_required")
        # Activer un moyen éteint exige aussi les deux.
        self.put(body(orange_money={"enabled": False}))
        again = self.put(body(orange_money={"enabled": True}))
        self.assertEqual(again.json()["errors"]["methods.1.payout_number"][0]["code"], "payout_number_required")

    def test_a_new_shop_starts_with_cash_on_delivery_only(self):
        from shops.services import create_shop_for_owner

        shop = create_shop_for_owner(self.owner, "Boutique Neuve")
        enabled = list(ShopPaymentMethod.objects.filter(shop=shop, enabled=True).values_list("method", flat=True))
        self.assertEqual(enabled, ["cash_on_delivery"])
        self.assertEqual(ShopPaymentMethod.objects.filter(shop=shop).count(), 5)
        self.assertEqual(shop.delivery_zones.count(), 15)

    def test_a_shop_without_rows_reads_as_five_methods_without_number_and_writes_nothing(self):
        ShopPaymentMethod.objects.filter(shop=self.shop).delete()
        self.as_owner(confirmed=False)
        payload = self.client.get(BASE).json()
        self.assertEqual([m["enabled"] for m in payload["methods"]], [True] * 5)
        self.assertEqual({m["payout_number"] for m in payload["methods"]}, {""})
        self.assertEqual(payload["missing_numbers"], 4)
        self.assertEqual(ShopPaymentMethod.objects.filter(shop=self.shop).count(), 0)
        self.assertEqual(len(self.client.get(STORE).json()["payment_methods"]), 5)

    def test_summary_follows_the_order_of_the_choices(self):
        self.as_owner()
        off = body(mtn_momo={"enabled": False}, moov_money={"enabled": False})
        self.assertEqual(self.put(off).json()["summary"], "Livraison + Orange Money + Wave")

    def test_payout_changes_are_limited_to_three_a_day_per_shop(self):
        self.as_owner()
        numbers = ["07 07 12 34 56", "05 05 11 22 33", "01 01 99 88 77", "07 08 12 34 56"]
        for number in numbers[:3]:
            self.assertEqual(self.put(body(wave=(number, "Aya"))).status_code, 200)
        blocked = self.put(body(wave=(numbers[3], "Aya")))
        self.assertProblem(blocked, 429, "too_many_requests")
        self.assertGreater(blocked.json()["retry_after"], 0)
        # Cocher un moyen ne compte pas dans la limite.
        self.assertEqual(self.put(body(wave=(WAVE, "Aya"), moov_money={"enabled": False})).status_code, 200)

    @skipUnless(connection.vendor == "postgresql", "Verrou de ligne : sans effet sur SQLite, qui sérialise déjà les écritures.")
    def test_the_write_locks_the_shop_row_on_postgres(self):
        """Deux PUT simultanés passent l'un après l'autre : chacun relit l'état sous verrou avant d'écrire."""
        from django.db import transaction

        from shops.payments import lock_shop

        with transaction.atomic(), CaptureQueriesContext(connection) as queries:
            lock_shop(self.shop)
        self.assertTrue(any("FOR UPDATE" in q["sql"] for q in queries))


class CheckoutPaymentTests(PaymentTestCase):
    def setUp(self):
        super().setUp()
        self.karite = Product.objects.create(shop=self.shop, sku="KAR", slug="karite", name="Karité", price=2500, stock=10)
        ShopPaymentMethod.objects.filter(shop=self.shop, method__in=["orange_money", "mtn_momo", "moov_money"]).update(enabled=False)
        self.off = {m: {"enabled": False} for m in ("orange_money", "mtn_momo", "moov_money")}

    def order(self, method="wave", **extra):
        self.client.credentials()
        payload = {
            "items": [{"product_id": str(self.karite.pk), "quantity": 2}],
            "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody"},
            "payment_method": method,
            **extra,
        }
        return self.client.post(f"{STORE}/orders", payload, format="json", HTTP_IDEMPOTENCY_KEY=str(extra.pop("key", uuid.uuid4())))

    def test_an_inactive_method_is_refused_by_a_direct_call_with_no_order_and_no_stock_taken(self):
        response = self.order("orange_money")
        self.assertProblem(response, 400, "payment_method_unavailable")
        self.assertEqual(response.json()["errors"]["payment_method"][0]["code"], "payment_method_unavailable")
        self.assertEqual(Order.objects.count(), 0)
        self.karite.refresh_from_db()
        self.assertEqual(self.karite.stock, 10)
        self.assertEqual(self.order("wave").status_code, 201)

    def test_the_storefront_lists_active_methods_and_never_a_number(self):
        self.as_owner()
        self.set_wave()
        self.client.credentials()
        shop = self.client.get(STORE)
        self.assertEqual([m["id"] for m in shop.json()["payment_methods"]], ["cash_on_delivery", "wave"])
        text = shop.content.decode().replace(" ", "")
        self.assertNotIn("0707123456", text)
        self.assertNotIn("Aya Boutique", text)

    def test_instructions_carry_the_server_total_with_discount_the_reference_and_the_live_number(self):
        self.as_owner()
        self.set_wave()
        self.client.credentials()
        created = self.order("wave", expected_total=2 * 2500 + 1500)
        self.assertEqual(created.status_code, 201, created.content)
        data = created.json()
        instructions = data["payment_instructions"]
        self.assertEqual((instructions["number"], instructions["holder"], instructions["amount"]), (WAVE, "Aya Boutique", 6500))
        self.assertEqual(instructions["reference"], data["reference"])
        self.assertEqual(
            instructions["text"], f"Envoyez 6 500 F par Wave au +225 07 07 12 34 56 (Aya Boutique). Indiquez la référence {data['reference']}."
        )
        self.assertEqual(data["fulfillment"], "delivery")
        self.assertEqual(data["payment_method"], "wave")

        track = lambda: self.client.post(f"{STORE}/track", {"reference": data["reference"], "phone_last4": "3456"}, format="json").json()  # noqa: E731
        self.assertEqual(track()["payment_instructions"]["number"], WAVE)
        # Un numéro corrigé se voit tout de suite sur une commande déjà passée (lu en direct, jamais copié).
        self.as_owner()
        self.put(self.body(wave=(WAVE, "Aya Boutique")))
        ShopPaymentMethod.objects.filter(shop=self.shop, method="wave").update(payout_number=WAVE2)
        self.client.credentials()
        self.assertEqual(track()["payment_instructions"]["number"], WAVE2)
        # Plus rien à payer une fois la commande expédiée.
        Order.objects.update(status="shipped")
        self.assertIsNone(track()["payment_instructions"])

    def test_the_total_in_the_instructions_includes_the_discount(self):
        from shops.models import Customer

        self.as_owner()
        self.set_wave()
        customer = Customer.objects.create(shop=self.shop, phone="+2250707123456", name="Aya Koné")
        Discount.objects.create(
            shop=self.shop, customer=customer, kind="percent", value=15, code="AYA-7K2Q", ends_on=timezone.localdate() + timedelta(days=30)
        )
        self.client.credentials()
        data = self.order("wave", discount_code="AYA-7K2Q").json()
        order = Order.objects.get()
        self.assertEqual((order.subtotal, order.discount_amount, order.total), (5000, 750, 5750))
        self.assertEqual(data["payment_instructions"]["amount"], 5750)  # le total du serveur, jamais celui du corps
        self.assertIn("5 750 F", data["payment_instructions"]["text"])

    def test_a_shop_without_a_number_shows_the_fallback_text(self):
        data = self.order("wave").json()
        instructions = data["payment_instructions"]
        self.assertEqual((instructions["number"], instructions["holder"]), (None, None))
        self.assertEqual(instructions["text"], "La boutique vous enverra la demande de paiement Wave au numéro indiqué lors de la commande.")

    def test_cash_on_delivery_has_no_instructions(self):
        self.assertIsNone(self.order("cash_on_delivery").json()["payment_instructions"])

    def test_an_idempotent_replay_never_returns_a_stale_number(self):
        self.as_owner()
        self.set_wave()
        key = uuid.uuid4()
        self.client.credentials()
        send = lambda: self.client.post(  # noqa: E731
            f"{STORE}/orders",
            {
                "items": [{"product_id": str(self.karite.pk), "quantity": 1}],
                "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody"},
                "payment_method": "wave",
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=str(key),
        )
        first = send().json()
        self.assertEqual(first["payment_instructions"]["number"], WAVE)
        from shops.models import IdempotencyRecord

        self.assertNotIn("0707123456", str(IdempotencyRecord.objects.get().response))  # rien d'enregistré
        ShopPaymentMethod.objects.filter(shop=self.shop, method="wave").update(payout_number=WAVE2)
        replay = send().json()
        self.assertEqual(replay["reference"], first["reference"])
        self.assertEqual(replay["payment_instructions"]["number"], WAVE2)
        self.assertEqual(Order.objects.count(), 1)
