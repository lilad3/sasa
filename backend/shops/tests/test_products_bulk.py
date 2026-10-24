"""A2.8 : modification en masse, tout ou rien (revue d'Alice : B1, identifiants étrangers, journal)."""

import uuid

from audit.models import AuditEvent
from shops.models import Product, StockMovement

from .products_base import SHOP, ProductCase, reauth


class BulkTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.items = [self.product(f"P{n}", slug=f"p{n}", price=10000, stock_count=10) for n in range(3)]
        self.foreign = self.product("X", slug="x", shop=self.other_shop, price=777, stock_count=4)
        self.url = f"{SHOP}/products/bulk"

    def bulk(self, action, ids=None):
        ids = [str(p.pk) for p in self.items] if ids is None else ids
        return self.client.post(self.url, {"ids": ids, "action": action}, format="json")

    def prices(self):
        return [Product.objects.get(pk=p.pk).price for p in self.items]

    def test_seller_cannot(self):
        self.authenticate(self.seller)
        self.assertProblem(self.bulk({"type": "tag_add", "label": "x"}), 403, "permission_denied")

    def test_price_percent_rounds_to_5_francs_and_returns_no_product(self):
        self.authenticate(self.manager)
        Product.objects.filter(pk=self.items[1].pk).update(price=1234)
        Product.objects.filter(pk=self.items[2].pk).update(price=3)
        response = self.bulk({"type": "price", "mode": "percent", "value": 10})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"count": 3, "action": "price"})
        self.assertEqual(self.prices(), [11000, 1355, 5])  # 1234 × 1,1 = 1357,4 → 1355 ; 3,3 → 5 minimum

    def test_price_set(self):
        self.authenticate(self.manager)
        self.assertEqual(self.bulk({"type": "price", "mode": "set", "value": 12000}).status_code, 200)
        self.assertEqual(self.prices(), [12000] * 3)

    def test_b1_lowering_prices_needs_the_stronger_confirmation_and_is_a_security_event(self):
        self.authenticate(self.owner)
        self.assertProblem(self.bulk({"type": "price", "mode": "percent", "value": -90}), 403, "reauth_required")
        self.assertEqual(self.prices(), [10000] * 3)
        self.assertFalse(AuditEvent.objects.filter(action="products_bulk_updated").exists())
        self.assertEqual(reauth(self.client).status_code, 200)
        self.assertEqual(self.bulk({"type": "price", "mode": "percent", "value": -90}).status_code, 200)
        self.assertEqual(self.prices(), [1000] * 3)
        event = AuditEvent.objects.get(action="products_bulk_updated")
        self.assertEqual((event.category, event.severity), ("security", "warning"))
        self.assertTrue(event.metadata["lowered"])
        # Le propriétaire le retrouve dans la vue « sensible » du journal de sa boutique.
        sensitive = self.client.get(f"{SHOP}/activity").json()["results"]
        self.assertIn("products_bulk_updated", [e["type"] for e in sensitive])

    def test_raising_prices_or_other_actions_need_no_reauth_and_stay_ordinary(self):
        self.authenticate(self.manager)
        self.assertEqual(self.bulk({"type": "price", "mode": "percent", "value": 5}).status_code, 200)
        self.assertEqual(self.bulk({"type": "tag_add", "label": "soldes"}).status_code, 200)
        for event in AuditEvent.objects.filter(action="products_bulk_updated"):
            self.assertEqual((event.category, event.severity), ("business", "info"))

    def test_a_foreign_id_looks_exactly_like_an_unknown_id_and_changes_nothing(self):
        self.authenticate(self.manager)
        action = {"type": "price", "mode": "set", "value": 1}
        foreign = self.bulk(action, [str(self.items[0].pk), str(self.foreign.pk)])
        unknown = self.bulk(action, [str(self.items[0].pk), str(uuid.uuid4())])
        self.assertProblem(foreign, 400, "invalid_selection")
        self.assertEqual(foreign.status_code, unknown.status_code)
        strip = lambda r: {k: v for k, v in r.json().items() if k != "request_id"}  # noqa: E731
        self.assertEqual(strip(foreign), strip(unknown))
        self.assertNotIn(str(self.foreign.pk), foreign.content.decode())
        self.assertEqual(self.prices(), [10000] * 3)
        self.assertEqual(Product.objects.get(pk=self.foreign.pk).price, 777)
        self.assertFalse(AuditEvent.objects.filter(action="products_bulk_updated").exists())

    def test_all_or_nothing_with_the_failing_products_listed(self):
        self.authenticate(self.manager)
        Product.objects.filter(pk=self.items[2].pk).update(stock=0)
        StockMovement.objects.filter(product=self.items[2]).delete()
        before = StockMovement.objects.count()
        response = self.bulk({"type": "stock", "mode": "add", "value": -3, "reason": "damaged"})
        self.assertProblem(response, 409, "bulk_failed")
        errors = response.json()["errors"]
        self.assertEqual([(e["product_id"], e["code"]) for e in errors], [(str(self.items[2].pk), "stock_below_zero")])
        self.assertEqual(StockMovement.objects.count(), before)
        self.assertEqual([Product.objects.get(pk=p.pk).stock for p in self.items], [10, 10, 0])
        self.assertFalse(AuditEvent.objects.filter(action="products_bulk_updated").exists())

    def test_compare_at_blocks_a_price_that_reaches_it(self):
        self.authenticate(self.manager)
        Product.objects.filter(pk=self.items[0].pk).update(compare_at_price=11000)
        response = self.bulk({"type": "price", "mode": "percent", "value": 10})
        self.assertProblem(response, 409, "bulk_failed")
        self.assertEqual(response.json()["errors"][0]["code"], "compare_at_invalid")
        self.assertEqual(self.prices(), [10000] * 3)

    def test_stock_action_needs_a_reason_and_writes_one_movement_per_product(self):
        self.authenticate(self.manager)
        self.assertEqual(self.bulk({"type": "stock", "mode": "add", "value": 2}).json()["errors"]["action.reason"][0]["code"], "reason_required")
        before = StockMovement.objects.count()
        self.assertEqual(self.bulk({"type": "stock", "mode": "add", "value": 5, "reason": "received", "note": "Lot 7"}).status_code, 200)
        self.assertEqual(StockMovement.objects.count(), before + 3)
        self.assertEqual(self.bulk({"type": "stock", "mode": "set", "value": 4, "reason": "correction"}).status_code, 200)
        self.assertEqual([Product.objects.get(pk=p.pk).stock for p in self.items], [4, 4, 4])
        self.assertEqual(self.bulk({"type": "stock", "mode": "set", "value": 4, "reason": "damaged"}).status_code, 400)
        self.assertLedger(*self.items)
        event = AuditEvent.objects.filter(action="products_bulk_updated").first()
        self.assertEqual(AuditEvent.objects.filter(action="products_bulk_updated").count(), 2)
        self.assertNotIn("Lot 7", str(event.metadata))

    def test_status_action_removes_the_feature_and_respects_the_plan(self):
        self.authenticate(self.owner)
        self.client.put(f"{SHOP}/products/{self.items[0].pk}/featured")
        self.assertEqual(self.bulk({"type": "status", "status": "archived"}).status_code, 200)
        self.assertEqual({Product.objects.get(pk=p.pk).status for p in self.items}, {"archived"})
        self.assertFalse(Product.objects.get(pk=self.items[0].pk).is_featured)
        self.assertEqual(Product.objects.get(pk=self.items[0].pk).legacy_is_active, False)
        for n in range(25):
            self.product(f"F{n}", slug=f"f{n}")
        self.assertProblem(self.bulk({"type": "status", "status": "active"}), 403, "plan_limit_reached")

    def test_tags_add_and_remove(self):
        self.authenticate(self.manager)
        self.bulk({"type": "tag_add", "label": "Cadeau"})
        self.assertEqual(self.bulk({"type": "tag_add", "label": "cadeau"}).status_code, 200)
        self.assertEqual(sorted(t.label for t in self.items[0].tags.all()), ["Cadeau"])
        self.assertEqual(self.bulk({"type": "tag_remove", "label": "CÂDEAU"}).status_code, 200)
        self.assertEqual(self.items[0].tags.count(), 0)
        self.assertEqual(self.bulk({"type": "tag_remove", "label": "absente"}).status_code, 200)

    def test_tag_limit_fails_everything(self):
        self.authenticate(self.manager)
        self.client.patch(f"{SHOP}/products/{self.items[0].pk}", {"tags": [f"t{n}" for n in range(10)]}, format="json")
        response = self.bulk({"type": "tag_add", "label": "onzième"})
        self.assertProblem(response, 409, "bulk_failed")
        self.assertEqual(response.json()["errors"][0]["code"], "tags_limit")
        self.assertEqual(self.items[1].tags.count(), 0)

    def test_shape_limits(self):
        self.authenticate(self.manager)
        action = {"type": "tag_add", "label": "x"}
        self.assertProblem(self.bulk(action, []), 400, "validation_error")
        many = [str(self.items[0].pk)] * 2
        self.assertProblem(self.bulk(action, many), 400, "validation_error")
        self.assertProblem(self.bulk(action, [str(uuid.uuid4()) for _ in range(101)]), 400, "validation_error")
        self.assertProblem(self.bulk({"type": "cost", "value": 1}), 400, "validation_error")
        self.assertProblem(self.bulk({"type": "price", "mode": "percent", "value": -95}), 400, "validation_error")
        self.assertProblem(self.bulk({"type": "price", "mode": "percent", "value": 0}), 400, "validation_error")

    def test_rate_limits(self):
        from shops.bulk import MEMBER_LIMIT

        self.authenticate(self.manager)
        for _ in range(MEMBER_LIMIT[0]):
            self.bulk({"type": "tag_add", "label": "x"})
        self.assertProblem(self.bulk({"type": "tag_add", "label": "x"}), 429, "too_many_requests")

    def test_hundred_products_at_once(self):
        many = [self.product(f"M{n}", slug=f"m{n}", stock_count=0) for n in range(100)]
        self.shop.plan = "pro"
        self.shop.save()
        self.authenticate(self.owner)
        response = self.bulk({"type": "tag_add", "label": "lot"}, [str(p.pk) for p in many])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["count"], 100)
        self.assertEqual(AuditEvent.objects.filter(action="products_bulk_updated").count(), 1)
