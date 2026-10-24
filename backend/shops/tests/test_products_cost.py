"""A2.3 : le coût d'achat est au propriétaire seul, et nulle part ailleurs (revue d'Alice)."""

import io

from django.core.files.uploadedfile import SimpleUploadedFile

from audit.models import AuditEvent
from shops.models import Membership, Product

from .products_base import SHOP, STOREFRONT, ProductCase, reauth, walk

KEYS = {"cost", "margin_amount", "margin_percent"}


def has_cost_key(payload):
    return bool(KEYS & set(walk(payload)))


class CostTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.item = self.product("KAR", price=8000, cost=5000)

    def test_owner_sees_cost_and_margin(self):
        self.authenticate(self.owner)
        body = self.client.get(f"{SHOP}/products/{self.item.pk}").json()
        self.assertEqual((body["cost"], body["margin_amount"], body["margin_percent"]), (5000, 3000, 38))
        listed = self.client.get(f"{SHOP}/products").json()["results"][0]
        self.assertEqual(listed["cost"], 5000)

    def test_loss_and_rounding(self):
        Product.objects.filter(pk=self.item.pk).update(cost=9000)
        self.authenticate(self.owner)
        body = self.client.get(f"{SHOP}/products/{self.item.pk}").json()
        self.assertEqual((body["margin_amount"], body["margin_percent"]), (-1000, -12))

    def test_cost_is_absent_everywhere_for_manager_and_seller(self):
        """Chaque réponse est parcourue : la clé `cost` ou `margin*` ne doit apparaître nulle part."""
        for user in (self.manager, self.seller):
            self.authenticate(user)
            payloads = [
                self.client.get(f"{SHOP}/products").json(),
                self.client.get(f"{SHOP}/products/{self.item.pk}").json(),
                self.client.get(f"{SHOP}/products/overview").json(),
                self.client.get(f"{SHOP}/products/{self.item.pk}/stock-movements").json(),
                self.client.get(f"{SHOP}/orders").json(),
                self.client.get(f"{SHOP}/dashboard").json() if user is self.manager else {},
            ]
            if user is self.manager:
                payloads.append(self.client.patch(f"{SHOP}/products/{self.item.pk}", {"price": 8500}, format="json").json())
                payloads.append(self.client.post(f"{SHOP}/products", {"sku": "NEW", "name": "Nouveau", "price": 900}, format="json").json())
                dup = self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate")
                self.assertEqual(dup.status_code, 201, dup.content)
                payloads.append(dup.json())
                bulk = self.client.post(f"{SHOP}/products/bulk", {"ids": [str(self.item.pk)], "action": {"type": "tag_add", "label": "x"}}, format="json")
                payloads.append(bulk.json())
            for payload in payloads:
                self.assertFalse(has_cost_key(payload), payload)

    def test_copy_by_a_manager_keeps_the_cost_server_side(self):
        self.authenticate(self.manager)
        copy_id = self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate").json()["id"]
        self.assertEqual(Product.objects.get(pk=copy_id).cost, 5000)

    def test_storefront_and_keyed_api_never_carry_it(self):
        self.assertFalse(has_cost_key(self.client.get(f"{STOREFRONT}/products").json()))
        self.assertFalse(has_cost_key(self.client.get(f"{STOREFRONT}/products/{self.item.slug}").json()))
        self.assertFalse(has_cost_key(self.client.get(f"{STOREFRONT}").json()))
        from shops.public_api import public_product

        self.assertFalse(has_cost_key(public_product(self.item)))

    def test_writing_cost_is_refused_not_ignored(self):
        self.authenticate(self.manager)
        self.assertProblem(self.client.patch(f"{SHOP}/products/{self.item.pk}", {"cost": 1}, format="json"), 403, "permission_denied")
        self.assertProblem(self.client.post(f"{SHOP}/products", {"sku": "N", "name": "Nouveau", "price": 900, "cost": 1}, format="json"), 403, "permission_denied")
        self.assertProblem(self.client.patch(f"{SHOP}/products/{self.item.pk}", {"cost": None}, format="json"), 403, "permission_denied")
        self.item.refresh_from_db()
        self.assertEqual(self.item.cost, 5000)
        self.authenticate(self.owner)
        self.assertEqual(self.client.patch(f"{SHOP}/products/{self.item.pk}", {"cost": 4000}, format="json").json()["margin_amount"], 4000)

    def test_an_injected_grant_gives_nothing(self):
        Membership.objects.filter(user=self.manager).update(grants=["products.cost", "storefront.edit"])
        self.authenticate(self.manager)
        self.assertFalse(has_cost_key(self.client.get(f"{SHOP}/products/{self.item.pk}").json()))
        self.assertProblem(self.client.patch(f"{SHOP}/products/{self.item.pk}", {"cost": 1}, format="json"), 403, "permission_denied")

    def test_no_sort_or_filter_on_cost_for_a_non_owner(self):
        """Sinon le tri serait un oracle sur le coût."""
        self.product("B", price=1000, cost=100)
        self.authenticate(self.manager)
        for query in ("sort=cost", "sort=-margin", "cost=5000", "margin_min=10", "cost_max=10", "COST=1"):
            self.assertProblem(self.client.get(f"{SHOP}/products?{query}"), 400, "validation_error")
        self.authenticate(self.owner)
        ordered = [p["sku"] for p in self.client.get(f"{SHOP}/products?sort=cost").json()["results"]]
        self.assertEqual(ordered, ["B", "KAR"])
        ordered = [p["sku"] for p in self.client.get(f"{SHOP}/products?sort=-margin").json()["results"]]
        self.assertEqual(ordered, ["KAR", "B"])

    def test_journal_never_holds_the_cost(self):
        self.authenticate(self.owner)
        self.client.patch(f"{SHOP}/products/{self.item.pk}", {"cost": 4321}, format="json")
        for event in AuditEvent.objects.all():
            self.assertNotIn("cost", str(event.metadata))
            self.assertNotIn("4321", str(event.metadata))
        report = self.client.get(f"{SHOP}/activity?type=tout")
        self.assertNotIn("4321", report.content.decode())


class CostImportTests(ProductCase):
    def upload(self, text):
        file = SimpleUploadedFile("produits.csv", text.encode(), content_type="text/csv")
        return self.client.post(f"{SHOP}/products/import", {"file": file}, format="multipart")

    def setUp(self):
        super().setUp()
        self.shop.plan = "pro"
        self.shop.save()

    def test_cost_column_is_refused_for_a_manager_and_never_echoed(self):
        self.authenticate(self.manager)
        response = self.upload("sku;nom;prix;cout\nA1;Un;1000;123456\n")
        self.assertProblem(response, 403, "permission_denied")
        self.assertNotIn("123456", response.content.decode())
        self.assertFalse(Product.objects.filter(sku="A1").exists())

    def test_owner_imports_cost_and_the_report_never_repeats_it(self):
        self.authenticate(self.owner)
        response = self.upload("sku;nom;prix;cout\nA1;Un;1000;654321\n")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn("654321", response.content.decode())
        self.assertEqual(Product.objects.get(sku="A1").cost, 654321)
