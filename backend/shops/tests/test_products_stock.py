"""A2.4 et A2.7 : historique du stock, précommande, annulation qui remet le stock (docs/chantier-a2-produits.md)."""

import re
from pathlib import Path

from django.conf import settings

from audit.models import AuditEvent
from shops.demo import generate_demo_data
from shops.models import Order, OrderItem, Product, StockMovement

from .products_base import SHOP, STOREFRONT, ProductCase


def line(product, quantity=1):
    return {"product_id": str(product.pk), "quantity": quantity}


class AdjustStockTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.item = self.product("KAR", stock_count=12)
        self.url = f"{SHOP}/products/{self.item.pk}/stock"

    def adjust(self, **body):
        return self.client.post(self.url, body, format="json")

    def test_adjust_writes_a_movement_with_reason_author_and_journal(self):
        self.authenticate(self.manager)
        response = self.adjust(delta=5, reason="received", note="Livraison du lundi")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["stock"], 17)
        self.assertEqual((body["movement"]["delta"], body["movement"]["stock_after"], body["movement"]["label"]), (5, 17, "Réception"))
        self.assertTrue(body["movement"]["actor"]["is_you"])
        event = AuditEvent.objects.get(action="product_stock_adjusted")
        self.assertEqual((event.metadata["delta"], event.metadata["reason"]), (5, "received"))
        self.assertNotIn("Livraison", str(event.metadata))
        self.assertLedger(self.item)

    def test_count_is_a_correction_and_unchanged_count_writes_nothing(self):
        self.authenticate(self.owner)
        body = self.adjust(count=7).json()
        self.assertEqual((body["stock"], body["movement"]["delta"], body["movement"]["reason"]), (7, -5, "correction"))
        response = self.adjust(count=7)
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["movement"])
        self.assertEqual(StockMovement.objects.filter(product=self.item).count(), 2)
        self.assertLedger(self.item)

    def test_quantity_and_reason_are_mandatory_and_must_agree(self):
        self.authenticate(self.owner)
        self.assertProblem(self.adjust(delta=3), 400, "validation_error")
        self.assertEqual(self.adjust(delta=3).json()["errors"]["reason"][0]["code"], "reason_required")
        self.assertEqual(self.adjust(reason="received").json()["errors"]["delta"][0]["code"], "delta_required")
        self.assertEqual(self.adjust(delta=0, reason="correction").json()["errors"]["delta"][0]["code"], "delta_required")
        self.assertEqual(self.adjust(delta=-2, reason="received").json()["errors"]["reason"][0]["code"], "reason_sign_mismatch")
        self.assertEqual(self.adjust(delta=2, reason="damaged").json()["errors"]["reason"][0]["code"], "reason_sign_mismatch")
        self.assertEqual(self.adjust(delta=2, reason="sold").status_code, 400)
        self.assertEqual(self.adjust(delta=2, reason="received", note="<b>x</b>").status_code, 400)
        self.assertEqual(Product.objects.get(pk=self.item.pk).stock, 12)

    def test_never_below_zero(self):
        self.authenticate(self.owner)
        response = self.adjust(delta=-13, reason="damaged")
        self.assertProblem(response, 409, "stock_below_zero")
        self.assertEqual(response.json()["available"], 12)
        self.assertEqual(self.adjust(delta=-12, reason="damaged").json()["stock"], 0)
        self.assertLedger(self.item)

    def test_patch_cannot_write_stock(self):
        self.authenticate(self.owner)
        response = self.client.patch(f"{SHOP}/products/{self.item.pk}", {"stock": 99}, format="json")
        self.assertProblem(response, 400, "validation_error")
        self.assertEqual(response.json()["errors"]["stock"][0]["code"], "stock_use_adjust")
        self.assertEqual(Product.objects.get(pk=self.item.pk).stock, 12)

    def test_seller_reads_the_history_but_cannot_adjust_and_other_shop_is_404(self):
        self.authenticate(self.owner)
        self.adjust(delta=1, reason="received")
        self.authenticate(self.seller)
        self.assertProblem(self.adjust(delta=1, reason="received"), 403, "permission_denied")
        history = self.client.get(f"{SHOP}/products/{self.item.pk}/stock-movements").json()
        self.assertEqual([m["delta"] for m in history["results"]], [1, 12])
        self.authenticate(self.other_owner)
        self.assertEqual(self.client.get(f"{SHOP}/products/{self.item.pk}/stock-movements").status_code, 404)
        self.assertEqual(self.adjust(delta=1, reason="received").status_code, 404)

    def test_history_shows_50_and_paginates_with_before(self):
        self.authenticate(self.owner)
        for _ in range(54):
            self.adjust(delta=1, reason="received")
        page = self.client.get(f"{SHOP}/products/{self.item.pk}/stock-movements").json()
        self.assertEqual(len(page["results"]), 50)
        more = self.client.get(f"{SHOP}/products/{self.item.pk}/stock-movements", {"before": page["next_before"]}).json()
        self.assertEqual(len(more["results"]), 5)
        self.assertIsNone(more["next_before"])
        self.assertProblem(self.client.get(f"{SHOP}/products/{self.item.pk}/stock-movements?before=hier"), 400, "validation_error")

    def test_rate_limit(self):
        from shops.catalog import STOCK_ADJUST_LIMIT

        self.authenticate(self.owner)
        for _ in range(STOCK_ADJUST_LIMIT[0]):
            self.adjust(delta=1, reason="received")
        self.assertProblem(self.adjust(delta=1, reason="received"), 429, "too_many_requests")

    def test_movements_are_append_only(self):
        movement = StockMovement.objects.get(product=self.item)
        movement.note = "modifié"
        with self.assertRaises(RuntimeError):
            movement.save()

    def test_creation_with_stock_writes_the_opening_movement(self):
        self.authenticate(self.owner)
        created = self.client.post(f"{SHOP}/products", {"sku": "NEW", "name": "Nouveau", "price": 900, "stock": 8}, format="json").json()
        movements = StockMovement.objects.filter(product_id=created["id"])
        self.assertEqual([(m.delta, m.reason, m.stock_after) for m in movements], [(8, "initial", 8)])
        self.assertEqual(created["stock"], 8)


class DeleteKeepsTheProofTests(ProductCase):
    def test_a_product_with_history_is_not_deleted_but_archived(self):
        item = self.product("KAR")
        self.authenticate(self.owner)
        self.client.post(f"{SHOP}/products/{item.pk}/stock", {"delta": -1, "reason": "damaged"}, format="json")
        response = self.client.delete(f"{SHOP}/products/{item.pk}")
        self.assertProblem(response, 409, "product_has_history")
        self.assertTrue(Product.objects.filter(pk=item.pk).exists())
        self.assertEqual(self.client.patch(f"{SHOP}/products/{item.pk}", {"status": "archived"}, format="json").status_code, 200)

    def test_a_fresh_product_can_be_deleted_and_the_deletion_is_logged(self):
        item = self.product("KAR")
        self.authenticate(self.owner)
        self.assertEqual(self.client.delete(f"{SHOP}/products/{item.pk}").status_code, 204)
        event = AuditEvent.objects.get(action="product_deleted")
        self.assertEqual(event.target_label, item.name)

    def test_a_sold_product_cannot_be_deleted(self):
        item = self.product("KAR")
        self.order([line(item, 2)])
        self.authenticate(self.owner)
        self.assertProblem(self.client.delete(f"{SHOP}/products/{item.pk}"), 409, "product_has_history")


class SaleAndBackorderTests(ProductCase):
    def test_sale_takes_stock_with_a_sold_movement(self):
        item = self.product("KAR", stock_count=5)
        response = self.order([line(item, 2)])
        self.assertEqual(response.status_code, 201, response.content)
        item.refresh_from_db()
        self.assertEqual(item.stock, 3)
        sold = StockMovement.objects.get(product=item, reason="sold")
        self.assertEqual((sold.delta, sold.stock_after, sold.order.reference, sold.actor_name), (-2, 3, response.json()["reference"], ""))
        self.assertEqual(OrderItem.objects.get().from_stock, 2)
        self.assertLedger(item)

    def test_out_of_stock_without_the_option_keeps_the_old_answer(self):
        item = self.product("KAR", stock_count=1)
        response = self.order([line(item, 2)])
        self.assertProblem(response, 409, "out_of_stock")
        self.assertEqual(response.json()["errors"]["items.0.quantity"][0]["available"], 1)
        self.assertFalse(Order.objects.exists())
        item.refresh_from_db()
        self.assertEqual(item.stock, 1)

    def test_backorder_takes_what_exists_and_promises_the_rest(self):
        item = self.product("KAR", stock_count=2, allow_backorder=True, backorder_days=7)
        response = self.order([line(item, 5)])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["backorder_days"], 7)
        item.refresh_from_db()
        self.assertEqual(item.stock, 0)
        order_item = OrderItem.objects.get()
        self.assertEqual((order_item.quantity, order_item.from_stock, order_item.backorder_days), (5, 2, 7))
        self.assertLedger(item)
        # Stock à zéro : précommande intégrale, sans mouvement, jamais négatif.
        second = self.order([line(item, 3)])
        self.assertEqual(second.status_code, 201)
        item.refresh_from_db()
        self.assertEqual(item.stock, 0)
        self.assertEqual(OrderItem.objects.latest("id").from_stock, 0)
        self.assertEqual(StockMovement.objects.filter(product=item, reason="sold").count(), 1)

    def test_backorder_days_are_required_with_the_option(self):
        self.authenticate(self.owner)
        item = self.product("KAR")
        response = self.client.patch(f"{SHOP}/products/{item.pk}", {"allow_backorder": True}, format="json")
        self.assertEqual(response.json()["errors"]["backorder_days"][0]["code"], "backorder_days_required")
        ok = self.client.patch(f"{SHOP}/products/{item.pk}", {"allow_backorder": True, "backorder_days": 7}, format="json")
        self.assertEqual(ok.status_code, 200)
        off = self.client.patch(f"{SHOP}/products/{item.pk}", {"allow_backorder": False}, format="json").json()
        self.assertIsNone(off["backorder_days"])

    def test_backorder_limit_caps_open_preorders_without_an_account(self):
        item = self.product("KAR", stock_count=0, allow_backorder=True, backorder_days=7, backorder_limit=20)
        self.assertEqual(self.order([line(item, 15)]).status_code, 201)
        refused = self.order([line(item, 6)])
        self.assertProblem(refused, 409, "out_of_stock")
        self.assertEqual(refused.json()["errors"]["items.0.quantity"][0]["available"], 5)
        self.assertEqual(self.order([line(item, 5)]).status_code, 201)
        # Une commande annulée libère sa part de précommande.
        self.authenticate(self.owner)
        first = Order.objects.order_by("created_at").first()
        self.client.patch(f"{SHOP}/orders/{first.pk}", {"status": "cancelled"}, format="json")
        self.client.credentials()
        self.assertEqual(self.order([line(item, 10)]).status_code, 201)

    def test_default_limit_is_20(self):
        self.assertEqual(self.product("KAR").backorder_limit, 20)

    def test_public_availability(self):
        plain = self.product("A", stock_count=3, slug="a", low_stock_threshold=5)
        full = self.product("B", stock_count=50, slug="b")
        empty = self.product("C", stock_count=0, slug="c")
        pre = self.product("D", stock_count=0, slug="d", allow_backorder=True, backorder_days=7)
        unique = self.product("E", stock_count=4, slug="e", one_of_a_kind=True)
        got = {p["slug"]: p for p in self.client.get(f"{STOREFRONT}/products").json()}
        self.assertEqual(got["a"]["availability"], "low_stock")
        self.assertEqual(got["b"]["availability"], "in_stock")
        self.assertEqual((got["c"]["availability"], got["c"]["orderable"], got["c"]["max_quantity"]), ("out_of_stock", False, 0))
        self.assertEqual((got["d"]["availability"], got["d"]["backorder_days"], got["d"]["max_quantity"], got["d"]["in_stock"]), ("preorder", 7, 99, False))
        self.assertEqual((got["e"]["max_quantity"], got["e"]["details"]), (1, {"one_of_a_kind": True}))
        self.assertEqual(got["b"]["max_quantity"], 50)
        self.assertNotIn("stock", got["b"])
        self.assertProblem(self.order([line(unique, 2)]), 409, "out_of_stock")
        del plain, full, empty

    def test_cover_and_popular_keep_a_preorder_product_after_stocked_ones(self):
        stocked = self.product("A", stock_count=5, slug="a")
        pre = self.product("D", stock_count=0, slug="d", allow_backorder=True, backorder_days=3)
        empty = self.product("C", stock_count=0, slug="c")
        self.order([line(stocked, 1), line(pre, 1)])
        shop = self.client.get(STOREFRONT).json()
        self.assertEqual(shop["popular"], [str(stocked.pk), str(pre.pk)])
        self.assertNotIn(str(empty.pk), shop["popular"])
        self.assertEqual(shop["featured"]["product_id"], str(stocked.pk))

    def test_dashboard_low_stock_ignores_draft_and_archived(self):
        self.product("A", stock_count=1, slug="a")
        self.product("B", stock_count=1, slug="b", status="draft")
        self.product("C", stock_count=1, slug="c", status="archived")
        self.authenticate(self.owner)
        low = self.client.get(f"{SHOP}/dashboard").json()["low_stock"]
        self.assertEqual([i["sku"] for i in low["items"]], ["A"])


class CancellationTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.item = self.product("KAR", stock_count=10)

    def cancel(self, order):
        return self.client.patch(f"{SHOP}/orders/{order.pk}", {"status": "cancelled"}, format="json")

    def test_cancelling_puts_back_exactly_what_was_taken_once(self):
        self.order([line(self.item, 4)])
        order = Order.objects.get()
        self.authenticate(self.manager)
        self.assertEqual(self.cancel(order).status_code, 200)
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock, 10)
        back = StockMovement.objects.get(product=self.item, reason="cancelled")
        self.assertEqual((back.delta, back.order_id), (4, order.pk))
        self.assertTrue(back.actor_name)
        # Annuler une commande déjà annulée est sans effet : le stock ne revient pas une deuxième fois.
        again = self.cancel(order)
        self.assertEqual(again.status_code, 200)
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock, 10)
        self.assertEqual(StockMovement.objects.filter(reason="cancelled").count(), 1)
        self.assertLedger(self.item)

    def test_a_non_cancellable_status_does_not_touch_stock(self):
        self.order([line(self.item, 4)])
        order = Order.objects.get()
        Order.objects.filter(pk=order.pk).update(status="delivered")
        self.authenticate(self.manager)
        self.assertProblem(self.cancel(order), 409, "invalid_transition")
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock, 6)

    def test_pure_preorder_gives_nothing_back_and_mixed_gives_only_the_taken_part(self):
        pre = self.product("PRE", stock_count=2, slug="pre", allow_backorder=True, backorder_days=5)
        self.order([line(pre, 5)])
        order = Order.objects.get()
        self.authenticate(self.manager)
        self.cancel(order)
        pre.refresh_from_db()
        self.assertEqual(pre.stock, 2)
        self.assertLedger(pre)
        self.client.credentials()
        empty = self.product("EMPTY", stock_count=0, slug="empty", allow_backorder=True, backorder_days=5)
        self.order([line(empty, 3)])
        order = Order.objects.latest("created_at")
        self.authenticate(self.manager)
        self.cancel(order)
        empty.refresh_from_db()
        self.assertEqual(empty.stock, 0)
        self.assertFalse(StockMovement.objects.filter(product=empty, reason="cancelled").exists())

    def test_archived_product_still_gets_its_stock_back_and_deleted_product_is_skipped(self):
        self.order([line(self.item, 3)])
        order = Order.objects.get()
        Product.objects.filter(pk=self.item.pk).update(status="archived")
        self.authenticate(self.manager)
        self.cancel(order)
        self.item.refresh_from_db()
        self.assertEqual(self.item.stock, 10)
        gone = self.product("GONE", stock_count=5, slug="gone")
        self.client.credentials()
        self.order([line(gone, 2)])
        order = Order.objects.latest("created_at")
        OrderItem.objects.filter(order=order).update(product=None)
        self.authenticate(self.manager)
        self.assertEqual(self.cancel(order).status_code, 200)

    def test_the_database_itself_refuses_a_second_return_for_the_same_line(self):
        from django.db import IntegrityError, transaction

        self.order([line(self.item, 2)])
        order = Order.objects.get()
        self.authenticate(self.manager)
        self.cancel(order)
        with self.assertRaises(IntegrityError), transaction.atomic():
            StockMovement.objects.create(shop=self.shop, product=self.item, delta=2, stock_after=12, reason="cancelled", order=order)


class GuardTests(ProductCase):
    PATTERN = re.compile(r"\.update\([^)]*\bstock\s*=|\bstock\s*=\s*F\(|\.stock\s*[-+]?=[^=]|\.bulk_update\(|\"stock\"\]?\s*\)?\.update")

    def test_only_stock_py_writes_the_stock_column(self):
        offenders = []
        for path in sorted(Path(settings.BASE_DIR).rglob("*.py")):
            relative = path.relative_to(settings.BASE_DIR).as_posix()
            if any(part in relative for part in ("migrations/", "tests/", ".venv/")) or relative == "shops/stock.py":
                continue
            for number, text in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if self.PATTERN.search(text) and not text.strip().startswith("#"):
                    offenders.append(f"{relative}:{number}: {text.strip()}")
        self.assertEqual(offenders, [])

    def test_the_guard_does_catch_a_write(self):
        for bad in ("Product.objects.filter(pk=1).update(stock=F('stock') - 1)", "product.stock -= 1", "x.update(updated_at=now, stock=3)"):
            self.assertTrue(self.PATTERN.search(bad), bad)
        self.assertFalse(self.PATTERN.search("products.filter(stock__gt=0)"))


class LedgerInvariantTests(ProductCase):
    def test_stock_equals_the_sum_of_movements_after_a_busy_day(self):
        a, b = self.product("A", stock_count=20, slug="a"), self.product("B", stock_count=5, slug="b", allow_backorder=True, backorder_days=2)
        self.order([line(a, 3), line(b, 7)])
        self.order([line(a, 1)])
        self.authenticate(self.manager)
        self.client.post(f"{SHOP}/products/{a.pk}/stock", {"delta": 4, "reason": "returned"}, format="json")
        self.client.post(f"{SHOP}/products/{b.pk}/stock", {"count": 9}, format="json")
        self.client.post(f"{SHOP}/products/bulk", {"ids": [str(a.pk), str(b.pk)], "action": {"type": "stock", "mode": "add", "value": -1, "reason": "damaged"}}, format="json")
        first = Order.objects.order_by("created_at").first()
        self.client.patch(f"{SHOP}/orders/{first.pk}", {"status": "cancelled"}, format="json")
        self.assertLedger()

    def test_demo_data_respects_the_invariant(self):
        generate_demo_data(self.shop)
        self.assertLedger()
        self.assertTrue(StockMovement.objects.filter(shop=self.shop).exists())
