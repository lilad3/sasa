"""Fabriques communes aux tests de la fiche produit (docs/chantier-a2-produits.md)."""

import json
import uuid

from core.testing import ApiTestCase, make_member, make_shop
from shops import stock
from shops.models import Product, StockReason

SHOP = "/api/v1/shops/maison-test"
STOREFRONT = "/api/v1/storefront/maison-test"
CUSTOMER = {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody"}


def reauth(client, password="pirogue-lagune-mangue"):
    return client.post("/api/v1/auth/reauth", {"password": password})


def walk(value):
    """Toutes les clés d'un JSON, à n'importe quelle profondeur."""
    if isinstance(value, dict):
        for key, item in value.items():
            yield key
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)


class ProductCase(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.manager = make_member("fatou@example.ci", self.shop, "manager")
        self.seller = make_member("koffi@example.ci", self.shop, "seller")
        self.other_shop = make_shop("autre-boutique", "Autre Boutique")
        self.other_owner = make_member("autre@example.ci", self.other_shop, "owner")

    def product(self, sku="KAR", stock_count=10, shop=None, **fields):
        """Un produit avec son mouvement de départ : l'invariant stock == somme des delta tient dès la création."""
        shop = shop or self.shop
        fields.setdefault("slug", sku.lower())
        fields.setdefault("name", f"Produit {sku}")
        fields.setdefault("price", 2500)
        product = Product.objects.create(shop=shop, sku=sku, stock=0, **fields)
        if stock_count:
            from django.db import transaction

            with transaction.atomic():
                stock.apply(product.pk, stock_count, StockReason.INITIAL, shop=shop)
            product.refresh_from_db()
        return product

    def order(self, items, key=None, **extra):
        body = {"items": items, "customer": CUSTOMER, "payment_method": "wave", **extra}
        return self.client.post(
            f"{STOREFRONT}/orders", json.dumps(body), content_type="application/json", HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4())
        )

    def assertLedger(self, *products):
        """L'invariant : le stock de chaque produit est la somme de ses mouvements."""
        from django.db.models import Sum

        from shops.models import StockMovement

        for product in products or Product.objects.all():
            product.refresh_from_db()
            total = StockMovement.objects.filter(product=product).aggregate(total=Sum("delta"))["total"] or 0
            self.assertEqual(product.stock, total, f"{product.sku} : stock {product.stock} ≠ somme des mouvements {total}")
