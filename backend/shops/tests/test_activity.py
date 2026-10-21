from datetime import timedelta
from unittest import mock

import pyotp
from django.utils import timezone

from accounts import mfa
from audit.services import record
from core.testing import ApiTestCase, make_member, make_shop
from shops.models import ApiKey


def add_key(shop, name, **fields):
    return ApiKey.objects.create(shop=shop, name=name, key_id=name[:8].ljust(8, "x"), secret_hash="0" * 64, scopes=["catalog:read"], **fields)


class ShopActivityTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.owner = make_member("owner@example.ci", self.shop, "owner", first_name="Adjoua", last_name="Konan")
        self.manager = make_member("fatou@example.ci", self.shop, "manager", first_name="Fatou", last_name="Diabaté")
        self.seller = make_member("koffi@example.ci", self.shop, "seller", first_name="Koffi", last_name="Yao")
        self.url = "/api/v1/shops/maison-test/activity"

    def test_owner_sees_who_did_what_with_whitelisted_details(self):
        record("orders_exported", actor=self.manager, shop=self.shop, rows=482, first="2026-09-01", last="2026-09-30", secret="ne-doit-pas-sortir")
        record("member_role_changed", actor=self.owner, shop=self.shop, target=("user", self.seller.pk, self.seller.email), previous_role="seller", new_role="manager")
        self.authenticate(self.owner)

        events = self.client.get(self.url).json()["results"]
        role_change, export = events
        self.assertEqual(export["type"], "orders_exported")
        self.assertEqual(export["actor"], {"name": "Fatou Diabaté", "role": "manager", "is_you": False})
        self.assertEqual(export["details"], {"rows": 482, "first": "2026-09-01", "last": "2026-09-30"})
        self.assertEqual(role_change["actor"]["is_you"], True)
        # La cible est nommée, pas seulement son e-mail.
        self.assertEqual(role_change["target"], {"type": "user", "label": "Koffi Yao"})

    def test_other_shops_never_show_up(self):
        other = make_shop("comptoir-voisin")
        neighbour = make_member("ibrahim@example.ci", other, "owner")
        record("api_key_created", actor=neighbour, shop=other, target=("api_key", "x", "Compta du voisin"))
        record("api_key_created", actor=self.owner, shop=self.shop, target=("api_key", "y", "Notre compta"))
        self.authenticate(self.owner)

        labels = [event["target"]["label"] for event in self.client.get(self.url).json()["results"]]
        self.assertEqual(labels, ["Notre compta"])

    def test_only_the_owner_reads_the_journal(self):
        for member in (self.manager, self.seller):
            self.authenticate(member)
            self.assertProblem(self.client.get(self.url), 403, "permission_denied")
            self.assertProblem(self.client.get("/api/v1/shops/maison-test/security-overview"), 403, "permission_denied")

    def test_customers_ip_and_device_stay_hidden(self):
        request = mock.Mock(client_ip="198.51.100.7", client_ua="Mozilla/5.0 (Linux; Android 14)", request_id="req_client_0001")
        record("checkout_bot_blocked", request, shop=self.shop)
        record("orders_exported", request, actor=self.manager, shop=self.shop, rows=3)
        self.authenticate(self.owner)

        export, bot = self.client.get(self.url).json()["results"]
        self.assertIsNone(bot["actor"])
        self.assertIsNone(bot["ip"])
        self.assertEqual(bot["device_label"], "")
        # Pour l'équipe, l'appareil et l'IP aident à repérer un export depuis un endroit inhabituel.
        self.assertEqual(export["ip"], "198.51.100.7")

    def test_sensitive_view_leaves_out_daily_business(self):
        record("order_status_changed", actor=self.seller, shop=self.shop, previous_status="pending", new_status="confirmed")
        record("member_added", actor=self.owner, shop=self.shop, role="seller")
        self.authenticate(self.owner)

        sensitive = [event["type"] for event in self.client.get(self.url).json()["results"]]
        everything = [event["type"] for event in self.client.get(self.url, {"type": "tout"}).json()["results"]]
        self.assertEqual(sensitive, ["member_added"])
        self.assertEqual(everything, ["member_added", "order_status_changed"])
        self.assertProblem(self.client.get(self.url, {"type": "secret"}), 400, "validation_error")

    def test_events_older_than_90_days_are_not_listed(self):
        with mock.patch("audit.services.timezone.now", return_value=timezone.now() - timedelta(days=91)):
            record("member_added", actor=self.owner, shop=self.shop, role="seller")
        self.authenticate(self.owner)
        self.assertEqual(self.client.get(self.url).json()["count"], 0)


class SecurityOverviewTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.owner = make_member("owner@example.ci", self.shop, "owner", first_name="Adjoua", last_name="Konan")
        self.seller = make_member("koffi@example.ci", self.shop, "seller", first_name="Koffi", last_name="Yao")
        self.url = "/api/v1/shops/maison-test/security-overview"

    def overview(self):
        self.authenticate(self.owner)
        return self.client.get(self.url).json()

    def test_team_two_factor_status(self):
        mfa.enable_with_secret(self.owner, pyotp.random_base32())
        team = {member["name"]: member for member in self.overview()["team"]}

        self.assertTrue(team["Adjoua Konan"]["mfa_enabled"])
        self.assertTrue(team["Adjoua Konan"]["is_you"])
        self.assertFalse(team["Koffi Yao"]["mfa_enabled"])

    def test_dormant_and_expiring_keys_are_flagged(self):
        now = timezone.now()
        add_key(self.shop, "Jamais", created_at=now - timedelta(days=10))
        add_key(self.shop, "Endormie", created_at=now - timedelta(days=60), last_used_at=now - timedelta(days=45))
        add_key(self.shop, "Active", created_at=now - timedelta(days=60), last_used_at=now - timedelta(hours=2), expires_at=now + timedelta(days=5))
        add_key(self.shop, "Neuve", created_at=now - timedelta(days=1))
        add_key(self.shop, "Revoquee", created_at=now - timedelta(days=60), revoked_at=now - timedelta(days=1))

        keys = self.overview()["api_keys"]
        self.assertEqual(keys["active"], 4)
        self.assertEqual(sorted(key["name"] for key in keys["dormant"]), ["Endormie", "Jamais"])
        self.assertEqual([key["name"] for key in keys["expiring_soon"]], ["Active"])

    def test_failed_attempts_on_team_accounts_are_counted(self):
        for _ in range(3):
            record("login_failed", actor=self.seller, email=self.seller.email)
        outsider = make_member("autre@example.ci", make_shop("ailleurs"), "owner")
        record("login_failed", actor=outsider)

        suspicious = self.overview()["suspicious"]
        self.assertEqual(len(suspicious), 1)
        self.assertEqual(suspicious[0]["name"], "Koffi Yao")
        self.assertEqual(suspicious[0]["type"], "login_failed")
        self.assertEqual(suspicious[0]["count"], 3)

    def test_last_export_says_who_and_when(self):
        self.assertIsNone(self.overview()["last_export"])
        record("orders_exported", actor=self.seller, shop=self.shop, rows=12)

        export = self.overview()["last_export"]
        self.assertEqual(export["by"], "Koffi Yao")
        self.assertEqual(export["rows"], 12)
