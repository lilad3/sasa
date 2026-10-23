"""
Courses de PostgreSQL (docs/chantier-a2-fondations.md §5.2). Sur SQLite, les écritures sont déjà sérialisées
(transaction_mode IMMEDIATE) et un test à fils d'exécution n'aurait pas de sens : tout est sauté.
"""

import time
import unittest
import uuid
from unittest import mock

from django.db import connection

from accounts.sessions import open_session
from audit.models import AuditEvent
from audit.services import record, verify_chain
from core.testing import BffClient, _transaction_case, make_member, make_order, make_shop, run_parallel
from shops.models import Order, Product, ProductPhoto

postgres_only = unittest.skipUnless(connection.vendor == "postgresql", "courses propres à PostgreSQL")
Base = _transaction_case()


def api_client(user):
    client = BffClient()
    _, tokens = open_session(user, None)
    client.bearer(tokens["access"])
    return client


@postgres_only
class CheckoutRaceTests(Base):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.product = Product.objects.create(shop=self.shop, sku="PAG", slug="pagne", name="Pagne", price=35000, stock=1)

    def body(self):
        return {
            "items": [{"product_id": str(self.product.pk), "quantity": 1}],
            "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody"},
            "payment_method": "wave",
            "expected_total": 35000 + 1500,
            "website": "",
        }

    def order(self, key):
        return lambda: BffClient().post("/api/v1/storefront/maison-test/orders", self.body(), HTTP_IDEMPOTENCY_KEY=str(key))

    def test_two_orders_for_the_last_item_sell_it_once(self):
        first, second = run_parallel(self.order(uuid.uuid4()), self.order(uuid.uuid4()))

        self.assertEqual(sorted([first.status_code, second.status_code]), [201, 409], [first.content, second.content])
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 0)
        self.assertEqual(Order.objects.count(), 1)

    def test_the_same_idempotency_key_sent_twice_gives_the_same_answer_not_a_500(self):
        self.product.stock = 5
        self.product.save()
        key = uuid.uuid4()

        first, second = run_parallel(self.order(key), self.order(key))

        self.assertEqual({first.status_code, second.status_code}, {201}, [first.content, second.content])
        self.assertEqual(first.json()["reference"], second.json()["reference"])
        self.assertEqual(Order.objects.count(), 1)
        self.product.refresh_from_db()
        self.assertEqual(self.product.stock, 4)


@postgres_only
class AuditChainRaceTests(Base):
    def test_simultaneous_events_never_fork_the_chain(self):
        def writer(tag):
            return lambda: [record("login_failed", email=f"{tag}{n}@example.ci") for n in range(15)]

        results = run_parallel(*(writer(tag) for tag in "abcd"))

        self.assertFalse([r for r in results if isinstance(r, Exception)], results)
        self.assertEqual(AuditEvent.objects.count(), 60)
        report = verify_chain()
        self.assertTrue(report.ok, report.reason)
        hashes = list(AuditEvent.objects.order_by("id").values_list("previous_hash", flat=True))
        self.assertEqual(len(set(hashes)), 60)  # chaque maillon a un seul successeur


@postgres_only
class OrderStatusRaceTests(Base):
    def test_shipped_and_cancelled_cannot_both_win(self):
        shop = make_shop("maison-test")
        owner = make_member("owner@example.ci", shop, "owner")
        order = make_order(shop, status="confirmed")
        url = f"/api/v1/shops/maison-test/orders/{order.pk}"

        def change(status):
            return lambda: api_client(owner).patch(url, {"status": status})

        # La fenêtre entre la lecture du statut et son écriture est courte : on l'élargit pour que la course se produise.
        real = Order.can_become

        def slow_can_become(self, target):
            allowed = real(self, target)
            time.sleep(0.3)
            return allowed

        with mock.patch.object(Order, "can_become", slow_can_become):
            first, second = run_parallel(change("shipped"), change("cancelled"))

        statuses = sorted([first.status_code, second.status_code])
        self.assertEqual(statuses, [200, 409], [first.content, second.content])
        self.assertEqual(AuditEvent.objects.filter(action="order_status_changed").count(), 1)
        order.refresh_from_db()
        self.assertIn(order.status, ("shipped", "cancelled"))


@postgres_only
class PlanLimitRaceTests(Base):
    def test_two_products_for_the_last_free_slot_create_only_one(self):
        shop = make_shop("maison-test")  # plan gratuit : 25 produits
        owner = make_member("owner@example.ci", shop, "owner")
        Product.objects.bulk_create(
            Product(shop=shop, sku=f"P{n}", slug=f"p{n}", name=f"Produit {n}", price=1000, stock=1) for n in range(24)
        )

        def create(n):
            return lambda: api_client(owner).post(
                "/api/v1/shops/maison-test/products",
                {"sku": f"NEW{n}", "name": f"Nouveau {n}", "price": 1000, "stock": 1},
            )

        first, second = run_parallel(create(1), create(2))

        self.assertEqual(sorted([first.status_code, second.status_code]), [201, 403], [first.content, second.content])
        self.assertEqual(Product.objects.count(), 25)


@postgres_only
class PhotoRaceTests(Base):
    def test_two_simultaneous_main_photo_changes_keep_unique_ranks(self):
        shop = make_shop("maison-test")
        owner = make_member("owner@example.ci", shop, "owner")
        product = Product.objects.create(shop=shop, sku="KAR", slug="karite", name="Karité", price=2500, stock=3)
        photos = [
            ProductPhoto.objects.create(shop=shop, product=product, position=n, image=b"x", version=f"v{n}") for n in range(3)
        ]

        def make_main(photo):
            return lambda: api_client(owner).put(f"/api/v1/shops/maison-test/products/{product.pk}/photos/{photo.pk}/main")

        first, second = run_parallel(make_main(photos[1]), make_main(photos[2]))

        self.assertEqual([first.status_code, second.status_code], [200, 200], [first.content, second.content])
        self.assertEqual(sorted(ProductPhoto.objects.filter(product=product).values_list("position", flat=True)), [0, 1, 2])
