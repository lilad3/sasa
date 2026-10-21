from core.testing import ApiTestCase, make_member, make_order, make_shop, without_request_id


class ShopAccessTests(ApiTestCase):
    """Rôles et isolation entre boutiques (docs/contrat-api.md §2.8 et §2.9)."""

    def setUp(self):
        self.shop = make_shop("maison-test")
        self.other_shop = make_shop("autre-boutique")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.seller = make_member("seller@example.ci", self.shop, "seller")
        self.stranger = make_member("stranger@example.ci", self.other_shop, "owner")
        self.order = make_order(self.shop)
        self.foreign_order = make_order(self.other_shop)

    def test_seller_cannot_see_the_dashboard(self):
        self.authenticate(self.seller)
        self.assertProblem(self.client.get("/api/v1/shops/maison-test/dashboard"), 403, "permission_denied")

    def test_seller_can_process_orders(self):
        self.authenticate(self.seller)
        self.assertEqual(self.client.get("/api/v1/shops/maison-test/orders").status_code, 200)
        self.assertEqual(self.client.get("/api/v1/shops/maison-test/orders/counts").json()["pending"], 1)
        response = self.client.patch(f"/api/v1/shops/maison-test/orders/{self.order.pk}", {"status": "confirmed"})
        self.assertEqual(response.json()["status"], "confirmed")

    def test_other_shop_is_invisible(self):
        self.authenticate(self.stranger)
        for path in ["dashboard", "orders", "orders/counts", f"orders/{self.order.pk}"]:
            with self.subTest(path=path):
                self.assertProblem(self.client.get(f"/api/v1/shops/maison-test/{path}"), 404, "not_found")

    def test_foreign_shop_looks_exactly_like_a_missing_one(self):
        self.authenticate(self.stranger)
        foreign = self.client.get("/api/v1/shops/maison-test/dashboard")
        missing = self.client.get("/api/v1/shops/n-existe-pas/dashboard")
        self.assertEqual(without_request_id(foreign), without_request_id(missing))

    def test_order_of_another_shop_cannot_be_reached_through_mine(self):
        self.authenticate(self.owner)
        url = f"/api/v1/shops/maison-test/orders/{self.foreign_order.pk}"
        self.assertProblem(self.client.get(url), 404, "not_found")
        self.assertProblem(self.client.patch(url, {"status": "cancelled"}), 404, "not_found")
        self.foreign_order.refresh_from_db()
        self.assertEqual(self.foreign_order.status, "pending")

    def test_listing_never_leaks_other_shops(self):
        self.authenticate(self.owner)
        ids = [order["id"] for order in self.client.get("/api/v1/shops/maison-test/orders").json()["results"]]
        self.assertEqual(ids, [str(self.order.pk)])

    def test_anonymous_visitor_is_not_authenticated(self):
        self.assertProblem(self.client.get("/api/v1/shops/maison-test/dashboard"), 401, "not_authenticated")

    def test_my_shops_lists_role_and_permissions(self):
        self.authenticate(self.seller)
        [membership] = self.client.get("/api/v1/me/shops").json()

        self.assertEqual(membership["role"], "seller")
        self.assertIn("orders.manage", membership["permissions"])
        self.assertNotIn("dashboard.view", membership["permissions"])
