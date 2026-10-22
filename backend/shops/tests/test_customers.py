from datetime import timedelta

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_order, make_shop
from shops.models import Customer


class CustomerTests(ApiTestCase):
    """Clients et fidèles (docs/chantier-p4.md §C)."""

    def setUp(self):
        self.shop = make_shop("maison-test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.manager = make_member("manager@example.ci", self.shop, "manager")
        self.seller = make_member("seller@example.ci", self.shop, "seller")
        self.url = "/api/v1/shops/maison-test/customers"
        # Aya : 3 livrées (fidèle au seuil par défaut) ; Koffi : 2 annulées (à risque) ; Awa : une commande récente.
        for days in (60, 50, 10):
            make_order(self.shop, phone="+2250708091011", customer_name="Aya Koné", status="delivered", age=timedelta(days=days), total=10_000)
        for days in (20, 15):
            make_order(self.shop, phone="+2250501020304", customer_name="Koffi Yao", status="cancelled", age=timedelta(days=days))
        make_order(self.shop, phone="+2250102030405", customer_name="Awa Traoré", age=timedelta(days=2), total=5_000)

    def list(self, query=""):
        return self.client.get(f"{self.url}{query}").json()

    def test_list_computes_figures_from_orders_and_masks_the_phone(self):
        self.authenticate(self.manager)
        body = self.list("?sort=spent")
        aya = body["results"][0]
        self.assertEqual((aya["name"], aya["orders"], aya["delivered"], aya["spent"], aya["average_basket"]), ("Aya Koné", 3, 3, 30_000, 10_000))
        self.assertEqual(aya["phone_masked"], "+225 07 08 •• •• 11")
        self.assertTrue(aya["loyal"])
        self.assertNotIn("0708091011", str(body))

    def test_segments_and_search(self):
        self.authenticate(self.manager)
        self.assertEqual([c["name"] for c in self.list("?segment=loyal")["results"]], ["Aya Koné"])
        self.assertEqual([c["name"] for c in self.list("?segment=at_risk")["results"]], ["Koffi Yao"])
        self.assertIn("Awa Traoré", [c["name"] for c in self.list("?segment=new")["results"]])
        self.assertEqual([c["name"] for c in self.list("?q=0501")["results"]], ["Koffi Yao"])
        self.assertProblem(self.client.get(f"{self.url}?segment=riches"), 400, "validation_error")

    def test_detail_by_opaque_id_and_404_for_another_shop(self):
        self.authenticate(self.manager)
        aya_id = self.list("?segment=loyal")["results"][0]["id"]
        detail = self.client.get(f"{self.url}/{aya_id}").json()
        self.assertEqual((detail["phone"], detail["payment_favorite"], len(detail["orders"])), ("+2250708091011", "wave", 3))

        other = make_shop("ailleurs")
        stranger = Customer.objects.create(shop=other, phone="+2250700000000", name="Ailleurs")
        self.assertProblem(self.client.get(f"{self.url}/{stranger.public_id}"), 404, "not_found")

    def test_summary_and_threshold(self):
        self.authenticate(self.manager)
        summary = self.client.get(f"{self.url}/summary").json()
        self.assertEqual((summary["total"], summary["loyal"], summary["at_risk"], summary["loyalty_threshold"]), (3, 1, 1, 3))
        self.assertEqual(len(summary["loyal_top"][0]["monthly"]), 6)

        self.assertEqual(self.client.patch(f"{self.url}/settings", {"loyalty_threshold": 4}).json(), {"loyalty_threshold": 4})
        self.assertEqual(self.client.get(f"{self.url}/summary").json()["loyal"], 0)
        self.assertTrue(AuditEvent.objects.filter(action="loyalty_threshold_changed").exists())
        self.assertProblem(self.client.patch(f"{self.url}/settings", {"loyalty_threshold": 51}), 400, "validation_error")

    def test_only_the_owner_names_a_vip_even_without_orders(self):
        self.authenticate(self.manager)
        self.assertProblem(self.client.post(f"{self.url}/vip", {"phone": "07 77 66 55 44", "name": "Tantie Rose"}), 403, "permission_denied")

        self.authenticate(self.owner)
        vip = self.client.post(f"{self.url}/vip", {"phone": "07 77 66 55 44", "name": "Tantie Rose"}).json()
        self.assertEqual((vip["name"], vip["vip"], vip["loyal"], vip["order_count"], vip["orders"]), ("Tantie Rose", True, True, 0, []))
        self.assertIn("Tantie Rose", [c["name"] for c in self.list("?segment=loyal")["results"]])
        self.assertTrue(AuditEvent.objects.filter(action="customer_vip_set").exists())

        removed = self.client.delete(f"{self.url}/{vip['id']}/vip").json()
        self.assertFalse(removed["vip"])

    def test_sellers_do_not_see_customers(self):
        self.authenticate(self.seller)
        self.assertProblem(self.client.get(self.url), 403, "permission_denied")
