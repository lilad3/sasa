from datetime import timedelta

from core.testing import ApiTestCase, make_member, make_order, make_shop
from shops.models import Order, Product


class DashboardTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.authenticate(make_member("owner@example.ci", self.shop, "owner"))
        self.karite = Product.objects.create(shop=self.shop, sku="KAR", slug="karite", name="Karité", price=2500)

    def test_numbers_exclude_cancelled_orders_and_compare_with_previous_period(self):
        make_order(self.shop, total=10_000, status="delivered", phone="+2250700000001", product=self.karite, quantity=4)
        make_order(self.shop, total=6_000, age=timedelta(days=2), phone="+2250500000002")
        make_order(self.shop, total=50_000, status="cancelled")
        make_order(self.shop, total=4_000, status="delivered", age=timedelta(days=10))

        body = self.client.get("/api/v1/shops/maison-test/dashboard?period=7d").json()

        self.assertEqual(body["currency"], "XOF")
        self.assertEqual(body["kpis"]["revenue"], {"value": 16_000, "previous": 4_000})
        self.assertEqual(body["kpis"]["orders"], {"value": 2, "previous": 1})
        self.assertEqual(body["kpis"]["average_basket"]["value"], 8_000)
        self.assertEqual(body["kpis"]["customers"]["value"], 2)
        self.assertEqual(len(body["revenue_series"]), 7)
        self.assertEqual(body["revenue_series"][-1]["revenue"], 10_000)
        self.assertEqual(body["top_products"][0], {"id": str(self.karite.pk), "name": "Karité", "units": 4, "revenue": 10_000})
        self.assertEqual(len(body["recent_orders"]), 4)

    def test_unknown_period_is_a_validation_error(self):
        response = self.client.get("/api/v1/shops/maison-test/dashboard?period=1y")
        self.assertProblem(response, 400, "validation_error")
        self.assertIn("period", response.json()["errors"])


class OrderTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.authenticate(make_member("owner@example.ci", self.shop, "owner"))

    def url(self, order):
        return f"/api/v1/shops/maison-test/orders/{order.pk}"

    def test_status_follows_the_allowed_transitions(self):
        order = make_order(self.shop)
        self.assertEqual(self.client.patch(self.url(order), {"status": "confirmed"}).status_code, 200)
        self.assertProblem(self.client.patch(self.url(order), {"status": "delivered"}), 409, "invalid_transition")
        self.assertEqual(self.client.patch(self.url(order), {"status": "shipped"}).status_code, 200)

    def test_delivered_order_is_final(self):
        order = make_order(self.shop, status="delivered")
        self.assertProblem(self.client.patch(self.url(order), {"status": "cancelled"}), 409, "invalid_transition")

    def test_unknown_status_is_a_validation_error(self):
        response = self.client.patch(self.url(make_order(self.shop)), {"status": "perdue"})
        self.assertProblem(response, 400, "validation_error")
        self.assertIn("status", response.json()["errors"])

    def test_list_filters_and_paginates(self):
        for _ in range(3):
            make_order(self.shop)
        make_order(self.shop, status="delivered")

        pending = self.client.get("/api/v1/shops/maison-test/orders?status=pending").json()
        self.assertEqual(pending["count"], 3)
        page = self.client.get("/api/v1/shops/maison-test/orders?page_size=2&page=2").json()
        self.assertEqual((page["page"], page["pages"], len(page["results"])), (2, 2, 2))


class DemoDataTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.manager = make_member("manager@example.ci", self.shop, "manager")

    def test_owner_generates_demo_data(self):
        self.authenticate(self.owner)
        response = self.client.post("/api/v1/shops/maison-test/demo-data")

        self.assertEqual(response.status_code, 201)
        self.assertGreater(response.json()["orders"], 100)
        self.assertFalse(Order.objects.filter(shop=self.shop, is_demo=False).exists())

    def test_running_it_twice_replaces_instead_of_piling_up(self):
        self.authenticate(self.owner)
        first = self.client.post("/api/v1/shops/maison-test/demo-data").json()
        second = self.client.post("/api/v1/shops/maison-test/demo-data").json()
        self.assertEqual(Order.objects.filter(shop=self.shop).count(), second["orders"])
        self.assertEqual(first, second)

    def test_manager_cannot_generate_demo_data(self):
        self.authenticate(self.manager)
        self.assertProblem(self.client.post("/api/v1/shops/maison-test/demo-data"), 403, "permission_denied")

    def test_real_orders_are_never_mixed_with_demo_data(self):
        make_order(self.shop)
        self.authenticate(self.owner)
        self.assertProblem(self.client.post("/api/v1/shops/maison-test/demo-data"), 409, "shop_not_empty")
