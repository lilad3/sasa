"""
Concurrence réelle sur le stock (docs/chantier-a2-produits.md §A2.13, revue d'Alice) : plusieurs connexions, en même
temps, sur une base de test sur fichier (config/settings.py, DATABASES.TEST). Pas un script joint : le test est dans la suite.

Ces tests sont des TransactionTestCase (les écritures se valident vraiment) ; Django les exécute après les TestCase.
Le « flush » de fin de test est désactivé, car les triggers du journal d'audit refusent tout DELETE : chaque test
travaille donc dans sa propre boutique.
"""

import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor

from django.db import connection, transaction
from django.test import TransactionTestCase, override_settings

from accounts.sessions import open_session
from core.testing import BffClient, make_member, make_shop
from shops import stock
from shops.models import Order, OrderItem, Product, StockMovement, StockReason

CUSTOMER = {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody"}


@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ConcurrencyCase(TransactionTestCase):
    def _fixture_teardown(self):
        pass  # voir la docstring du module

    def setUp(self):
        suffix = uuid.uuid4().hex[:8]
        self.slug = f"course-{suffix}"
        self.shop = make_shop(self.slug, "Course")
        self.owner = make_member(f"owner-{suffix}@example.ci", self.shop, "owner")
        self.manager = make_member(f"manager-{suffix}@example.ci", self.shop, "manager")

    def product(self, stock_count, sku="DER", **fields):
        product = Product.objects.create(shop=self.shop, sku=f"{sku}-{uuid.uuid4().hex[:4]}", slug=f"p-{uuid.uuid4().hex[:8]}", name="Dernier article", price=1000, stock=0, **fields)
        if stock_count:
            with transaction.atomic():
                stock.apply(product.pk, stock_count, StockReason.INITIAL, shop=self.shop)
        return product

    def run_parallel(self, calls):
        """Lance les appels exactement en même temps (une barrière) et renvoie leurs résultats."""
        barrier = threading.Barrier(len(calls))

        def run(index_call):
            index, call = index_call
            try:
                barrier.wait(timeout=10)
                return call(index)
            finally:
                connection.close()

        with ThreadPoolExecutor(max_workers=len(calls)) as pool:
            return list(pool.map(run, enumerate(calls)))

    def storefront_order(self, product, quantity=1):
        def call(index):
            client = BffClient(HTTP_X_CLIENT_IP=f"203.0.113.{index + 1}")
            body = {"items": [{"product_id": str(product.pk), "quantity": quantity}], "customer": CUSTOMER, "payment_method": "wave"}
            response = client.post(
                f"/api/v1/storefront/{self.slug}/orders", json.dumps(body), content_type="application/json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4())
            )
            return response.status_code, response.json().get("code")

        return call

    def assertLedger(self, product):
        product.refresh_from_db()
        total = sum(StockMovement.objects.filter(product=product).values_list("delta", flat=True))
        self.assertEqual(product.stock, total)

    def test_the_last_item_ordered_twice_at_once_goes_to_one_buyer(self):
        item = self.product(1)
        results = self.run_parallel([self.storefront_order(item)] * 2)
        self.assertEqual(sorted(code for code, _ in results), [201, 409], results)
        self.assertEqual([code for status, code in results if status == 409], ["out_of_stock"])
        item.refresh_from_db()
        self.assertEqual(item.stock, 0)
        self.assertEqual(Order.objects.filter(shop=self.shop).count(), 1)
        self.assertEqual(StockMovement.objects.filter(product=item, reason="sold").count(), 1)
        self.assertLedger(item)

    def test_twenty_buyers_for_the_last_item(self):
        item = self.product(1)
        results = self.run_parallel([self.storefront_order(item)] * 20)
        self.assertEqual([status for status, _ in results].count(201), 1, results)
        self.assertEqual(Order.objects.filter(shop=self.shop).count(), 1)
        item.refresh_from_db()
        self.assertEqual(item.stock, 0)
        self.assertLedger(item)

    def test_twenty_buyers_five_in_stock_sells_exactly_five(self):
        item = self.product(5)
        results = self.run_parallel([self.storefront_order(item)] * 20)
        self.assertEqual([status for status, _ in results].count(201), 5, results)
        item.refresh_from_db()
        self.assertEqual(item.stock, 0)
        self.assertEqual(sum(OrderItem.objects.filter(product=item).values_list("from_stock", flat=True)), 5)
        self.assertLedger(item)

    def test_preorder_never_drives_the_stock_below_zero_nor_past_the_limit(self):
        item = self.product(1, allow_backorder=True, backorder_days=5, backorder_limit=4)
        results = self.run_parallel([self.storefront_order(item)] * 10)
        # 1 en stock + 4 en précommande au plus.
        self.assertEqual([status for status, _ in results].count(201), 5, results)
        item.refresh_from_db()
        self.assertEqual(item.stock, 0)
        self.assertLedger(item)

    def test_two_cancellations_at_once_give_the_stock_back_once(self):
        item = self.product(10)
        self.run_parallel([self.storefront_order(item, 4)])
        order = Order.objects.get(shop=self.shop)
        item.refresh_from_db()
        self.assertEqual(item.stock, 6)
        _, tokens = open_session(self.manager, None)

        def cancel(index):
            client = BffClient()
            client.bearer(tokens["access"])
            response = client.patch(f"/api/v1/shops/{self.slug}/orders/{order.pk}", {"status": "cancelled"}, format="json")
            return response.status_code

        results = self.run_parallel([cancel] * 4)
        self.assertTrue(all(status in (200, 409) for status in results), results)
        self.assertIn(200, results)
        item.refresh_from_db()
        self.assertEqual(item.stock, 10)
        self.assertEqual(StockMovement.objects.filter(product=item, reason="cancelled").count(), 1)
        self.assertLedger(item)

    def test_simultaneous_bulk_tag_additions_never_pass_ten(self):
        item = self.product(0)
        _, tokens = open_session(self.owner, None)
        from shops import tags

        with transaction.atomic():
            tags.replace_tags(item, [f"t{n}" for n in range(9)])

        def add(index):
            client = BffClient()
            client.bearer(tokens["access"])
            response = client.post(
                f"/api/v1/shops/{self.slug}/products/bulk",
                {"ids": [str(item.pk)], "action": {"type": "tag_add", "label": f"nouvelle{index}"}},
                format="json",
            )
            return response.status_code

        results = self.run_parallel([add] * 4)
        self.assertEqual(sorted(results), [200, 409, 409, 409], results)
        self.assertEqual(item.tags.count(), 10)

    def test_creations_at_the_plan_limit_fill_exactly_the_free_places(self):
        _, tokens = open_session(self.owner, None)
        for n in range(24):  # plan Gratuit : 25 produits, il reste une place
            self.product(0, sku=f"F{n}")

        def create(index):
            client = BffClient()
            client.bearer(tokens["access"])
            response = client.post(f"/api/v1/shops/{self.slug}/products", {"sku": f"N{index}", "name": f"Nouveau {index}", "price": 900}, format="json")
            return response.status_code

        results = self.run_parallel([create] * 4)
        self.assertEqual(sorted(results), [201, 403, 403, 403], results)
        self.assertEqual(Product.objects.filter(shop=self.shop).count(), 25)
