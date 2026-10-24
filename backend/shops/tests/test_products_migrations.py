"""Migrations shops 0009 et 0010 : les boutiques existantes ne changent pas, aller et retour (docs/chantier-a2-produits.md §A2.13)."""

import uuid

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase

BEFORE = [("shops", "0008_versions_vitrine")]
AFTER = [("shops", "0010_historique_stock_precommande")]


class A2MigrationTests(TransactionTestCase):
    def _fixture_teardown(self):
        pass  # les triggers du journal d'audit refusent le flush (voir test_stock_concurrency)

    def migrate(self, targets):
        executor = MigrationExecutor(connection)
        executor.migrate(targets)
        executor.loader.build_graph()
        return executor.loader.project_state(targets).apps

    def tearDown(self):
        self.migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())

    def test_existing_shops_are_unchanged_and_the_migration_round_trips(self):
        old = self.migrate(BEFORE)
        Shop, Product, Order, OrderItem = (old.get_model("shops", name) for name in ("Shop", "Product", "Order", "OrderItem"))
        shop = Shop.objects.create(slug=f"avant-{uuid.uuid4().hex[:6]}", name="Avant A2")
        live = Product.objects.create(shop=shop, sku="LIVE", slug="live", name="En vente", price=1000, stock=12, is_active=True)
        hidden = Product.objects.create(shop=shop, sku="HID", slug="hid", name="Masqué", price=2000, stock=3, is_active=False)
        empty = Product.objects.create(shop=shop, sku="EMP", slug="emp", name="Épuisé", price=500, stock=0, is_active=True)
        order = Order.objects.create(shop=shop, payment_method="wave", customer_name="Aya", customer_phone="+2250707000001", customer_city="Abidjan", subtotal=3000, total=3000)
        OrderItem.objects.create(order=order, product=live, name="En vente", unit_price=1000, quantity=3, line_total=3000)
        total_stock = sum(Product.objects.filter(shop=shop).values_list("stock", flat=True))

        new = self.migrate(AFTER)
        Product, StockMovement, OrderItem = (new.get_model("shops", name) for name in ("Product", "StockMovement", "OrderItem"))
        statuses = dict(Product.objects.filter(shop_id=shop.pk).values_list("sku", "status"))
        self.assertEqual(statuses, {"LIVE": "active", "HID": "draft", "EMP": "active"})
        self.assertEqual(sum(Product.objects.filter(shop_id=shop.pk).values_list("stock", flat=True)), total_stock)
        movements = StockMovement.objects.filter(shop_id=shop.pk)
        self.assertEqual(sorted((m.product.sku, m.delta, m.stock_after, m.reason) for m in movements), [("HID", 3, 3, "initial"), ("LIVE", 12, 12, "initial")])
        self.assertFalse(movements.filter(product_id=empty.pk).exists())
        item = OrderItem.objects.get(order_id=order.pk)
        self.assertEqual((item.quantity, item.from_stock, item.backorder_days), (3, 3, 0))
        new_product = Product.objects.get(pk=live.pk)
        self.assertEqual((new_product.cost, new_product.compare_at_price, new_product.allow_backorder, new_product.sold_by), (None, None, False, "piece"))

        # Retour : « archivé » et « brouillon » redeviennent masqués, « actif » reste en vente.
        Product.objects.filter(pk=empty.pk).update(status="archived")
        back = self.migrate(BEFORE)
        flags = dict(back.get_model("shops", "Product").objects.filter(shop_id=shop.pk).values_list("sku", "is_active"))
        self.assertEqual(flags, {"LIVE": True, "HID": False, "EMP": False})
