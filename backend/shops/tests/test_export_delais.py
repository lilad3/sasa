"""Lot 4 de P5 : export des clients et « Livrées à temps » (docs/chantier-p5.md §4)."""

import csv
import io
from datetime import timedelta
from unittest.mock import patch

from django.utils import timezone

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_order, make_shop
from shops.delivery import promised_hours
from shops.models import Customer, Order

SHOP = "/api/v1/shops/maison-test"


def reauth(client, password="pirogue-lagune-mangue"):
    return client.post("/api/v1/auth/reauth", {"password": password})


def read_csv(response):
    text = response.content.decode("utf-8").lstrip("﻿")
    return list(csv.reader(io.StringIO(text), delimiter=";"))


class CustomerExportTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.manager = make_member("fatou@example.ci", self.shop, "manager")
        self.seller = make_member("koffi@example.ci", self.shop, "seller")
        self.url = f"{SHOP}/customers/export"
        # Aya : 2 commandes livrées ; « =CMD() » : un nom piégé ; Koffi : 1 commande annulée.
        make_order(self.shop, total=20_000, status="delivered", phone="+2250707000001", customer_name="Aya Koné")
        make_order(self.shop, total=5_000, status="delivered", phone="+2250707000001", customer_name="Aya Koné", age=timedelta(days=60))
        make_order(self.shop, total=8_000, phone="+2250505000002", customer_name="=CMD()")
        make_order(self.shop, total=3_000, status="cancelled", phone="+2250101000003", customer_name="Koffi Yao")

    def test_owner_exports_every_customer_biggest_first(self):
        self.authenticate(self.owner)
        self.assertProblem(self.client.get(self.url), 403, "reauth_required")
        reauth(self.client)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response["Content-Type"], "text/csv; charset=utf-8")
        self.assertIn("akwaba-maison-test-clients-", response["Content-Disposition"])

        rows = read_csv(response)
        self.assertEqual(rows[0][:4], ["Nom", "Téléphone", "Ville", "Commune"])
        # Formule texte : Excel affiche « +2250707000001 », sans apostrophe et sans rien calculer.
        self.assertEqual([row[1] for row in rows[1:]], ['="+2250707000001"', '="+2250505000002"', '="+2250101000003"'])
        aya = rows[1]
        self.assertEqual(aya[0], "Aya Koné")
        self.assertEqual(aya[4:9], ["2", "2", "0", "25000", "12500"])
        # La formule reste du texte dans Excel.
        self.assertEqual(rows[2][0], "'=CMD()")
        self.assertIn("nouveau", rows[2][12])

        event = AuditEvent.objects.get(action="customers_exported")
        self.assertEqual((event.metadata["rows"], event.metadata["segment"]), (3, "all"))

    def test_segment_follows_the_customers_page(self):
        self.authenticate(self.owner)
        reauth(self.client)
        self.client.get(f"{SHOP}/customers")  # crée les fiches, comme la page Clients
        Customer.objects.filter(phone="+2250101000003").update(is_vip=True)
        rows = read_csv(self.client.get(self.url, {"segment": "loyal"}))
        self.assertEqual([row[1] for row in rows[1:]], ['="+2250101000003"'])
        self.assertProblem(self.client.get(self.url, {"segment": "tous"}), 400, "validation_error")

    def test_the_grant_can_be_given_to_a_manager_never_to_a_seller(self):
        self.authenticate(self.manager)
        reauth(self.client)
        self.assertProblem(self.client.get(self.url), 403, "permission_denied")
        self.manager.memberships.update(grants=["customers.export"])
        self.assertEqual(self.client.get(self.url).status_code, 200)

        self.authenticate(self.seller)
        reauth(self.client)
        self.assertProblem(self.client.get(self.url), 403, "permission_denied")

        self.authenticate(make_member("autre@example.ci", make_shop("autre-boutique"), "owner"))
        self.assertProblem(self.client.get(self.url), 404, "not_found")

    def test_owner_can_grant_it_from_the_team_page(self):
        self.authenticate(self.owner)
        reauth(self.client)
        response = self.client.patch(f"{SHOP}/members/{self.manager.pk}", {"grants": ["customers.export"]})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.manager.memberships.get().grants, ["customers.export"])

    def test_rate_limit(self):
        self.authenticate(self.owner)
        reauth(self.client)
        with patch("shops.customers.EXPORT_LIMIT", (1, 3600)):
            self.assertEqual(self.client.get(self.url).status_code, 200)
            self.assertProblem(self.client.get(self.url), 429, "too_many_requests")


class DeliveryTimingTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.authenticate(self.owner)

    def move(self, order, status):
        return self.client.patch(f"{SHOP}/orders/{order.pk}", {"status": status})

    def test_each_step_is_stamped_once(self):
        order = make_order(self.shop)
        self.assertEqual(self.move(order, "confirmed").status_code, 200)
        order.refresh_from_db()
        confirmed = order.confirmed_at
        self.assertIsNotNone(confirmed)
        self.assertIsNone(order.shipped_at)

        self.move(order, "confirmed")  # même statut : rien ne change
        order.refresh_from_db()
        self.assertEqual(order.confirmed_at, confirmed)

        self.move(order, "shipped")
        body = self.move(order, "delivered").json()
        order.refresh_from_db()
        self.assertTrue(order.confirmed_at <= order.shipped_at <= order.delivered_at)
        self.assertEqual(body["promised_hours"], 24)
        self.assertIsNotNone(body["delivery_hours"])
        self.assertEqual(body["confirmed_at"][:16], timezone.localtime(confirmed).isoformat()[:16])

    def test_cancelling_stamps_nothing(self):
        order = make_order(self.shop)
        self.move(order, "cancelled")
        order.refresh_from_db()
        self.assertEqual((order.confirmed_at, order.shipped_at, order.delivered_at), (None, None, None))

    def test_promised_delay_by_zone(self):
        self.assertEqual(promised_hours("Abidjan", "Yopougon"), 24)
        self.assertEqual(promised_hours("abidjan ", "Port-Bouët"), 24)
        self.assertEqual(promised_hours("Bingerville"), 48)
        self.assertEqual(promised_hours("Grand-Bassam"), 48)
        self.assertEqual(promised_hours("Korhogo"), 72)
        self.assertEqual(promised_hours(""), 72)
        zones = {zone["id"]: zone["delay_hours"] for zone in self.client.get("/api/v1/storefront/maison-test").json()["delivery_zones"]}
        self.assertEqual((zones["Abidjan|Cocody"], zones["Bingerville"], zones["Bouaké"]), (24, 48, 72))

    def test_on_time_share_on_the_dashboard(self):
        def delivered(hours, city="Abidjan", commune="Cocody", age=timedelta(days=2)):
            order = make_order(self.shop, status="delivered", customer_city=city, customer_commune=commune, age=age)
            Order.objects.filter(pk=order.pk).update(delivered_at=order.created_at + timedelta(hours=hours))

        delivered(24)  # pile à la limite : à temps
        delivered(25)  # en retard
        delivered(40, city="Bingerville", commune="")  # 48 h promises : à temps
        delivered(80, city="Korhogo", commune="")  # 72 h promises : en retard
        make_order(self.shop, status="delivered")  # livrée avant le lot 4 : pas d'horaire, pas mesurée
        make_order(self.shop, status="cancelled")
        delivered(10, age=timedelta(days=60))  # hors période

        on_time = self.client.get(f"{SHOP}/dashboard", {"period": "30d"}).json()["on_time"]
        self.assertEqual(on_time, {"measured": 4, "on_time": 2, "average_hours": 42.2})

    def test_no_measure_yet(self):
        make_order(self.shop, status="delivered")
        self.assertEqual(
            self.client.get(f"{SHOP}/dashboard", {"period": "30d"}).json()["on_time"],
            {"measured": 0, "on_time": 0, "average_hours": None},
        )
