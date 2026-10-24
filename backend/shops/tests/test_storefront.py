import uuid

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_shop
from shops.models import Order, Product

BASE = "/api/v1/storefront/maison-test"


class StorefrontTestCase(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.karite = Product.objects.create(
            shop=self.shop, sku="KAR", slug="karite", name="Beurre de karité", category="Beauté", price=2500, stock=10
        )
        self.pagne = Product.objects.create(
            shop=self.shop, sku="PAG", slug="pagne", name="Pagne baoulé", category="Artisanat", price=35000, stock=2
        )
        self.hidden = Product.objects.create(
            shop=self.shop, sku="OLD", slug="ancien", name="Ancien article", price=1000, stock=5, status="draft"
        )

    def order_body(self, **overrides):
        body = {
            "items": [{"product_id": str(self.karite.pk), "quantity": 2}],
            "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody", "landmark": "Près de la pharmacie"},
            "payment_method": "wave",
            "expected_total": 2 * 2500 + 1500,
            "website": "",
        }
        body.update(overrides)
        return body

    def post_order(self, body=None, key=None):
        return self.client.post(
            f"{BASE}/orders", body or self.order_body(), HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4())
        )


class StorefrontReadTests(StorefrontTestCase):
    def test_shop_is_public_and_lists_delivery_zones(self):
        body = self.client.get(BASE).json()
        self.assertEqual(body["name"], "Maison Test")
        self.assertEqual(body["accent"], "orange")
        self.assertEqual(body["product_count"], 2)
        self.assertIn({"id": "Abidjan|Cocody", "city": "Abidjan", "commune": "Cocody", "label": "Cocody, Abidjan", "fee": 1500, "delay_hours": 24}, body["delivery_zones"])

    def test_products_hide_inactive_ones_and_exact_stock(self):
        products = self.client.get(f"{BASE}/products").json()
        self.assertEqual([p["slug"] for p in products], ["pagne", "karite"])  # tri par rayon puis par nom
        pagne = products[0]
        self.assertNotIn("stock", pagne)
        self.assertEqual((pagne["in_stock"], pagne["low_stock"], pagne["max_quantity"]), (True, True, 2))

    def test_inactive_product_and_unknown_shop_give_404(self):
        self.assertProblem(self.client.get(f"{BASE}/products/ancien"), 404, "not_found")
        self.assertProblem(self.client.get("/api/v1/storefront/inconnue"), 404, "not_found")

    def test_a_token_is_ignored_on_public_routes(self):
        self.client.bearer("jeton-invalide")
        self.assertEqual(self.client.get(BASE).status_code, 200)

    def test_still_requires_the_bff_secret(self):
        response = self.client.get(BASE, HTTP_X_AKWABA_BFF="faux")
        self.assertProblem(response, 403, "bff_required")


class CheckoutTests(StorefrontTestCase):
    def test_order_is_priced_by_the_server_and_decrements_stock(self):
        response = self.post_order()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["total"], 6500)
        order = Order.objects.get(reference=response.json()["reference"])
        self.assertEqual((order.subtotal, order.delivery_fee, order.customer_phone), (5000, 1500, "+2250707123456"))
        self.assertEqual((order.customer_city, order.customer_commune), ("Abidjan", "Cocody"))
        self.karite.refresh_from_db()
        self.assertEqual(self.karite.stock, 8)
        self.assertTrue(AuditEvent.objects.filter(action="order_placed", shop_slug="maison-test").exists())

    def test_same_key_and_same_content_returns_the_same_order(self):
        key = uuid.uuid4()
        first = self.post_order(key=key).json()
        second = self.post_order(key=key)
        self.assertEqual(second.status_code, 201)
        self.assertEqual(second.json(), first)
        self.assertEqual(Order.objects.filter(shop=self.shop).count(), 1)

    def test_same_key_with_other_content_is_a_conflict(self):
        key = uuid.uuid4()
        self.post_order(key=key)
        other = self.order_body(items=[{"product_id": str(self.karite.pk), "quantity": 3}], expected_total=None)
        other.pop("expected_total")
        self.assertProblem(self.post_order(other, key=key), 409, "idempotency_conflict")

    def test_missing_idempotency_key_is_rejected(self):
        response = self.client.post(f"{BASE}/orders", self.order_body())
        self.assertProblem(response, 400, "validation_error")
        self.assertIn("Idempotency-Key", response.json()["errors"])

    def test_changed_total_is_reported_before_paying(self):
        response = self.post_order(self.order_body(expected_total=5000))
        self.assertProblem(response, 409, "price_changed")
        self.assertEqual(response.json()["total"], 6500)
        self.assertFalse(Order.objects.exists())

    def test_not_enough_stock_names_the_line(self):
        body = self.order_body(items=[{"product_id": str(self.pagne.pk), "quantity": 3}])
        body.pop("expected_total")
        response = self.post_order(body)
        self.assertProblem(response, 409, "out_of_stock")
        self.assertEqual(response.json()["errors"]["items.0.quantity"][0]["available"], 2)
        self.pagne.refresh_from_db()
        self.assertEqual(self.pagne.stock, 2)

    def test_hidden_or_foreign_products_cannot_be_ordered(self):
        other_shop = make_shop("autre")
        foreign = Product.objects.create(shop=other_shop, sku="X", slug="x", name="X", price=100, stock=5)
        for product in (self.hidden, foreign):
            body = self.order_body(items=[{"product_id": str(product.pk), "quantity": 1}])
            body.pop("expected_total")
            response = self.post_order(body)
            self.assertProblem(response, 400, "validation_error")
            self.assertIn("items.0.product_id", response.json()["errors"])

    def test_inputs_are_validated(self):
        body = self.order_body(customer={"name": "<script>", "phone": "06 12 34 56 78", "city": "Paris", "landmark": ""})
        errors = self.post_order(body).json()["errors"]
        self.assertEqual(errors["customer.name"][0]["code"], "invalid_characters")
        self.assertEqual(errors["customer.phone"][0]["code"], "invalid_phone")

    def test_unknown_delivery_zone_is_rejected(self):
        body = self.order_body(customer={"name": "Aya", "phone": "0707123456", "city": "Paris"})
        errors = self.post_order(body).json()["errors"]
        self.assertEqual(errors["customer.city"][0]["code"], "delivery_unavailable")

    def test_honeypot_looks_accepted_but_creates_nothing(self):
        response = self.post_order(self.order_body(website="https://spam.example"))
        self.assertEqual(response.status_code, 201)
        self.assertIn("reference", response.json())
        self.assertFalse(Order.objects.exists())
        self.assertTrue(AuditEvent.objects.filter(action="checkout_bot_blocked").exists())

    def test_orders_are_limited_per_ip(self):
        for _ in range(10):
            body = self.order_body(items=[{"product_id": str(self.karite.pk), "quantity": 1}])
            body.pop("expected_total")
            self.post_order(body)
        self.assertProblem(self.post_order(), 429, "too_many_requests")
