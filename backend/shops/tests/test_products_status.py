"""A2.1, A2.2 : statut, prix barré, limite du plan (docs/chantier-a2-produits.md)."""

import re
from pathlib import Path

from django.conf import settings

from audit.models import AuditEvent
from shops.models import Product, ProductPhoto

from .products_base import SHOP, STOREFRONT, ProductCase
from .test_logo import picture


class StatusTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.live = self.product("LIVE", slug="live", status="active")
        self.draft = self.product("DRAFT", slug="draft", status="draft")
        self.archived = self.product("OLD", slug="old", status="archived")

    def test_only_active_is_public_even_by_direct_calls(self):
        listed = [p["slug"] for p in self.client.get(f"{STOREFRONT}/products").json()]
        self.assertEqual(listed, ["live"])
        self.assertEqual(self.client.get(f"{STOREFRONT}/products/draft").status_code, 404)
        self.assertEqual(self.client.get(f"{STOREFRONT}/products/old").status_code, 404)
        self.assertEqual(self.client.get(f"{STOREFRONT}").json()["product_count"], 1)

    def test_draft_and_archived_cannot_be_ordered(self):
        for product in (self.draft, self.archived):
            response = self.order([{"product_id": str(product.pk), "quantity": 1}])
            self.assertProblem(response, 400, "validation_error")
            code = response.json()["errors"]["items.0.product_id"][0]["code"]
            self.assertEqual(code, "product_unavailable")
            product.refresh_from_db()
            self.assertEqual(product.stock, 10)

    def test_photos_of_draft_and_archived_are_not_public(self):
        photos = {}
        for product in (self.live, self.draft, self.archived):
            photos[product.sku] = ProductPhoto.objects.create(
                shop=self.shop, product=product, position=0, image=b"RIFFxxxxWEBP", version="v1"
            )
        self.assertEqual(self.client.get(f"{STOREFRONT}/photos/{photos['LIVE'].pk}", HTTP_ACCEPT="image/webp").status_code, 200)
        for sku in ("DRAFT", "OLD"):
            response = self.client.get(f"{STOREFRONT}/photos/{photos[sku].pk}", HTTP_ACCEPT="image/webp")
            self.assertEqual(response.status_code, 404)

    def test_team_reads_a_draft_photo_by_the_member_route_only(self):
        photo = ProductPhoto.objects.create(shop=self.shop, product=self.draft, position=0, image=b"RIFFxxxxWEBP", version="v1")
        url = f"{SHOP}/products/{self.draft.pk}/photos/{photo.pk}/image"
        self.assertEqual(self.client.get(url, HTTP_ACCEPT="image/webp").status_code, 401)
        self.authenticate(self.seller)
        response = self.client.get(url, HTTP_ACCEPT="image/webp")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.authenticate(self.other_owner)
        self.assertEqual(self.client.get(url, HTTP_ACCEPT="image/webp").status_code, 404)

    def test_default_list_hides_archived_and_filters_work(self):
        self.authenticate(self.manager)
        slugs = lambda params="": sorted(p["slug"] for p in self.client.get(f"{SHOP}/products{params}").json()["results"])  # noqa: E731
        self.assertEqual(slugs(), ["draft", "live"])
        self.assertEqual(slugs("?status=archived"), ["old"])
        self.assertEqual(slugs("?status=all"), ["draft", "live", "old"])
        self.assertProblem(self.client.get(f"{SHOP}/products?status=nope"), 400, "validation_error")

    def test_leaving_active_removes_the_feature_and_is_logged(self):
        self.authenticate(self.owner)
        self.assertEqual(self.client.put(f"{SHOP}/products/{self.live.pk}/featured").status_code, 200)
        response = self.client.patch(f"{SHOP}/products/{self.live.pk}", {"status": "draft"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()["is_featured"])
        self.assertEqual(response.json()["status"], "draft")
        self.assertFalse(response.json()["is_active"])
        self.assertEqual(AuditEvent.objects.filter(action="product_featured", metadata__change="removed").count(), 1)
        event = AuditEvent.objects.get(action="product_status_changed")
        self.assertEqual((event.metadata["previous"], event.metadata["new"]), ("active", "draft"))
        self.assertEqual(self.client.put(f"{SHOP}/products/{self.live.pk}/featured").status_code, 409)

    def test_is_active_cannot_be_written(self):
        self.authenticate(self.owner)
        response = self.client.patch(f"{SHOP}/products/{self.live.pk}", {"is_active": False}, format="json")
        self.assertProblem(response, 400, "validation_error")
        self.live.refresh_from_db()
        self.assertEqual(self.live.status, "active")

    def test_archived_does_not_count_in_the_plan_and_unarchiving_needs_room(self):
        # Plan Gratuit : 25 produits. 3 existent (1 archivé) → 2 comptent.
        self.assertEqual(self.client.get(f"{SHOP}/products").status_code, 401)
        self.authenticate(self.owner)
        overview = self.client.get(f"{SHOP}/products/overview").json()
        self.assertEqual((overview["count"], overview["active"], overview["draft"], overview["archived"]), (2, 1, 1, 1))
        for n in range(23):
            self.product(f"F{n}", slug=f"f{n}")
        self.assertProblem(
            self.client.patch(f"{SHOP}/products/{self.archived.pk}", {"status": "draft"}, format="json"), 403, "plan_limit_reached"
        )
        self.assertProblem(self.client.post(f"{SHOP}/products", {"sku": "NEW", "name": "Nouveau", "price": 1000}, format="json"), 403, "plan_limit_reached")
        # Créer un archivé ne coûte rien dans le plan.
        created = self.client.post(f"{SHOP}/products", {"sku": "RANGE", "name": "Rangé", "price": 1000, "status": "archived"}, format="json")
        self.assertEqual(created.status_code, 201, created.content)

    def test_technical_archive_cap(self):
        from shops import plans

        self.authenticate(self.owner)
        with self.settings():
            original = plans.ARCHIVE_LIMIT
            plans.ARCHIVE_LIMIT = 1
            try:
                self.assertProblem(
                    self.client.patch(f"{SHOP}/products/{self.draft.pk}", {"status": "archived"}, format="json"), 409, "archive_limit"
                )
            finally:
                plans.ARCHIVE_LIMIT = original

    def test_guard_no_production_query_filters_or_writes_is_active(self):
        """Seul `status` décide ; `is_active` n'est plus qu'une propriété de lecture (et la colonne gelée)."""
        offenders = []
        for path in sorted(Path(settings.BASE_DIR, "shops").glob("*.py")):
            if path.name == "team.py":  # User.is_active : le compte, pas le produit
                continue
            for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
                if re.search(r"is_active\s*=|is_active__|\"is_active\":", line) and not re.search(r"legacy_is_active|serializers\.|csv|field == |\"actif\"", line):
                    offenders.append(f"{path.name}:{number}: {line.strip()}")
        self.assertEqual(offenders, ["public_api.py:60: \"is_active\": product.is_active,"])


class CompareAtPriceTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.item = self.product("PAG", slug="pagne", price=8000)
        self.authenticate(self.owner)

    def patch(self, **body):
        return self.client.patch(f"{SHOP}/products/{self.item.pk}", body, format="json")

    def test_compare_at_must_be_above_price_on_create_and_patch(self):
        response = self.client.post(f"{SHOP}/products", {"sku": "X1", "name": "Pagne", "price": 8000, "compare_at_price": 8000}, format="json")
        self.assertProblem(response, 400, "validation_error")
        self.assertEqual(response.json()["errors"]["compare_at_price"][0]["code"], "compare_at_invalid")
        ok = self.client.post(f"{SHOP}/products", {"sku": "X2", "name": "Pagne bis", "price": 8000, "compare_at_price": 10000}, format="json")
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(self.patch(compare_at_price=7000).status_code, 400)
        self.assertEqual(self.patch(compare_at_price=10000).status_code, 200)
        # Une hausse de prix qui rejoint le barré est refusée, même sans toucher au barré.
        refused = self.patch(price=10000)
        self.assertEqual(refused.json()["errors"]["compare_at_price"][0]["code"], "compare_at_invalid")
        self.assertEqual(self.patch(compare_at_price=None).status_code, 200)
        self.assertEqual(self.patch(price=10000).status_code, 200)

    def test_storefront_shows_it_with_a_floored_percent_and_orders_ignore_it(self):
        self.patch(compare_at_price=10000)
        public = self.client.get(f"{STOREFRONT}/products/pagne").json()
        self.assertEqual((public["compare_at_price"], public["discount_percent"]), (10000, 20))
        self.patch(price=6667, compare_at_price=10000)
        self.assertEqual(self.client.get(f"{STOREFRONT}/products/pagne").json()["discount_percent"], 33)
        self.client.credentials()
        with_barre = self.order([{"product_id": str(self.item.pk), "quantity": 2}]).json()["total"]
        Product.objects.filter(pk=self.item.pk).update(compare_at_price=None)
        without = self.order([{"product_id": str(self.item.pk), "quantity": 2}]).json()["total"]
        self.assertEqual(with_barre, without)
