"""A2.5, A2.6, A2.9, A2.10 : étiquettes, duplication, import CSV, champs par secteur."""

from dataclasses import replace
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile

from audit.models import AuditEvent
from shops import plans
from shops.models import Product, ProductPhoto, ProductTag, StockMovement

from .products_base import SHOP, STOREFRONT, ProductCase


class TagTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.item = self.product("KAR", slug="kar")
        self.authenticate(self.manager)

    def patch(self, tags, item=None):
        return self.client.patch(f"{SHOP}/products/{(item or self.item).pk}", {"tags": tags}, format="json")

    def test_duplicates_without_case_or_accents_merge(self):
        response = self.patch(["Cadeau", "cadeau", "Câdeau", "Fait main"])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["tags"], ["Cadeau", "Fait main"])

    def test_limits_and_plain_text(self):
        self.assertEqual(self.patch([f"t{n}" for n in range(10)]).status_code, 200)
        over = self.patch([f"t{n}" for n in range(11)])
        self.assertEqual(over.json()["errors"]["tags"][0]["code"], "tags_limit")
        self.assertEqual(self.patch(["x" * 31]).status_code, 400)
        self.assertEqual(self.patch(["<b>gras</b>"]).status_code, 400)
        self.assertEqual(self.patch(["   "]).status_code, 400)
        self.assertEqual(self.item.tags.count(), 10)

    def test_patch_replaces_the_list(self):
        self.patch(["a", "b"])
        self.assertEqual(self.patch(["c"]).json()["tags"], ["c"])
        self.assertEqual(self.client.patch(f"{SHOP}/products/{self.item.pk}", {"price": 3000}, format="json").json()["tags"], ["c"])

    def test_one_display_form_per_shop_and_sorted_suggestions(self):
        other = self.product("B", slug="b")
        third = self.product("C", slug="c")
        self.patch(["cadeau"], self.item)
        self.patch(["Cadeau", "Fait main"], other)
        self.patch(["Cadeau"], third)
        suggestions = self.client.get(f"{SHOP}/products/tags").json()
        self.assertEqual(suggestions, [{"label": "Cadeau", "count": 3}, {"label": "Fait main", "count": 1}])
        self.assertEqual(self.client.get(f"{SHOP}/products/tags?q=FAI").json(), [{"label": "Fait main", "count": 1}])
        self.assertEqual(self.client.get(f"{SHOP}/products/{self.item.pk}").json()["tags"], ["Cadeau"])
        self.assertEqual(self.client.get(f"{SHOP}/products/overview").json()["tags"][0]["label"], "Cadeau")

    def test_filter_by_tag_requires_all_and_normalizes(self):
        other = self.product("B", slug="b")
        self.patch(["Cadeau", "Fait main"], self.item)
        self.patch(["Cadeau"], other)
        slugs = lambda q: sorted(p["slug"] for p in self.client.get(f"{SHOP}/products?{q}").json()["results"])  # noqa: E731
        self.assertEqual(slugs("tag=CÂDEAU"), ["b", "kar"])
        self.assertEqual(slugs("tag=cadeau,fait main"), ["kar"])
        self.assertEqual(self.client.get(f"{SHOP}/products?tag=a,b,c,d").status_code, 400)

    def test_tags_are_never_public_and_never_cross_shops(self):
        self.patch(["Secret"])
        self.client.credentials()
        self.assertNotIn("tags", self.client.get(f"{STOREFRONT}/products/kar").json())
        self.authenticate(self.other_owner)
        self.assertEqual(self.client.get(f"{SHOP}/products/tags").status_code, 404)


class DuplicateTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.item = self.product(
            "KAR", slug="kar", stock_count=9, price=5000, compare_at_price=6000, cost=3000, category="Soins", description="Beurre pur",
            allow_backorder=True, backorder_days=4, sold_by="kg", is_featured=True,
        )
        ProductTag.objects.create(shop=self.shop, product=self.item, label="Cadeau", key="cadeau")
        for position in range(3):
            ProductPhoto.objects.create(shop=self.shop, product=self.item, position=position, image=b"RIFFaaaaWEBP", version=f"v{position}")

    def test_copy_is_a_draft_with_no_stock_no_feature_and_everything_else(self):
        self.authenticate(self.owner)
        response = self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate")
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        copy = Product.objects.get(pk=body["id"])
        self.assertEqual((copy.status, copy.stock, copy.is_featured, copy.is_demo), ("draft", 0, False, False))
        self.assertEqual((copy.name, copy.sku, copy.slug), ("Copie de Produit KAR", "KAR-COPIE", "copie-de-produit-kar"))
        self.assertEqual((copy.price, copy.compare_at_price, copy.cost, copy.category, copy.sold_by, copy.backorder_days), (5000, 6000, 3000, "Soins", "kg", 4))
        self.assertFalse(StockMovement.objects.filter(product=copy).exists())
        self.assertEqual(sorted(t.label for t in copy.tags.all()), ["Cadeau"])
        self.assertEqual(copy.photos.count(), 3)
        self.assertEqual({p.pk for p in copy.photos.all()} & {p.pk for p in self.item.photos.all()}, set())
        self.item.refresh_from_db()
        self.assertEqual((self.item.stock, self.item.is_featured), (9, True))
        again = self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate").json()
        self.assertEqual(again["sku"], "KAR-COPIE-2")
        self.assertNotEqual(again["slug"], body["slug"])
        self.assertEqual(AuditEvent.objects.filter(action="product_duplicated").count(), 2)
        self.assertEqual(AuditEvent.objects.filter(action="product_duplicated").first().metadata["source"], "Produit KAR")

    def test_name_is_not_prefixed_twice_and_sku_fits_in_40(self):
        Product.objects.filter(pk=self.item.pk).update(name="Copie de Beurre", sku="K" * 40)
        self.authenticate(self.owner)
        body = self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate").json()
        self.assertEqual(body["name"], "Copie de Beurre")
        self.assertEqual(len(body["sku"]), 40)
        self.assertTrue(body["sku"].endswith("-COPIE"))

    def test_archived_can_be_copied_seller_cannot_other_shop_is_404_plan_is_enforced(self):
        Product.objects.filter(pk=self.item.pk).update(status="archived")
        self.authenticate(self.manager)
        self.assertEqual(self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate").status_code, 201)
        self.authenticate(self.seller)
        self.assertProblem(self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate"), 403, "permission_denied")
        self.authenticate(self.other_owner)
        self.assertEqual(self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate").status_code, 404)
        self.authenticate(self.owner)
        for n in range(30):
            Product.objects.create(shop=self.shop, sku=f"F{n}", slug=f"f{n}", name=f"F{n}", price=100)
        self.assertProblem(self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate"), 403, "plan_limit_reached")

    def test_rate_limit(self):
        from shops.catalog import DUPLICATE_LIMIT

        self.shop.plan = "business"
        self.shop.save()
        self.authenticate(self.owner)
        for _ in range(DUPLICATE_LIMIT[0]):
            self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate")
        self.assertProblem(self.client.post(f"{SHOP}/products/{self.item.pk}/duplicate"), 429, "too_many_requests")


class ImportTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.shop.plan = "pro"
        self.shop.save()
        self.authenticate(self.owner)

    def upload(self, text, dry_run=False):
        file = SimpleUploadedFile("produits.csv", text.encode(), content_type="text/csv")
        return self.client.post(f"{SHOP}/products/import", {"file": file, "dry_run": "1" if dry_run else ""}, format="multipart")

    def test_a_file_from_before_a2_gives_the_same_report(self):
        self.product("OLD", slug="old", stock_count=3, price=1000)
        response = self.upload("sku;nom;prix;stock;actif\nOLD;Ancien;1200;5;non\nNEW;Neuf;900;2;oui\n")
        body = response.json()
        self.assertEqual((response.status_code, body["rows"], body["created"], body["updated"], body["error_count"]), (200, 2, 1, 1, 0))
        self.assertEqual(set(body), {"dry_run", "rows", "created", "updated", "error_count", "errors"})
        self.assertEqual(Product.objects.get(sku="OLD").status, "draft")
        self.assertEqual(Product.objects.get(sku="NEW").status, "active")

    def test_new_columns(self):
        response = self.upload("sku;nom;prix;statut;prix_barre;etiquettes\nA1;Un;1000;brouillon;1500;Cadeau|Fait main\nA2;Deux;1000;Archivé;;\n")
        self.assertEqual(response.status_code, 200, response.content)
        one = Product.objects.get(sku="A1")
        self.assertEqual((one.status, one.compare_at_price, sorted(t.label for t in one.tags.all())), ("draft", 1500, ["Cadeau", "Fait main"]))
        self.assertEqual(Product.objects.get(sku="A2").status, "archived")

    def test_statut_wins_over_actif_and_unknown_status_is_a_line_error(self):
        self.upload("sku;nom;prix;actif;statut\nA1;Un;1000;non;actif\n")
        self.assertEqual(Product.objects.get(sku="A1").status, "active")
        bad = self.upload("sku;nom;prix;statut\nA3;Trois;1000;bientôt\n").json()
        self.assertEqual((bad["error_count"], bad["errors"][0]["code"], bad["errors"][0]["field"]), (1, "invalid_choice", "status"))

    def test_compare_at_rule_applies_and_all_or_nothing_holds(self):
        body = self.upload("sku;nom;prix;prix_barre\nA1;Un;1000;900\nA2;Deux;500;\n").json()
        self.assertEqual(body["errors"][0]["field"], "compare_at_price")
        self.assertFalse(Product.objects.filter(sku__in=["A1", "A2"]).exists())

    def test_imported_stock_creates_import_movements_and_nothing_when_unchanged(self):
        existing = self.product("OLD", slug="old", stock_count=3)
        self.upload("sku;nom;prix;stock\nOLD;Ancien;1000;8\nNEW;Neuf;900;2\n")
        self.assertEqual([(m.delta, m.reason) for m in StockMovement.objects.filter(product=existing).order_by("created_at")], [(3, "initial"), (5, "import")])
        new = Product.objects.get(sku="NEW")
        self.assertEqual([(m.delta, m.reason) for m in new.movements.all()], [(2, "import")])
        self.upload("sku;nom;prix;stock\nOLD;Ancien;1000;8\n")
        self.assertEqual(StockMovement.objects.filter(product=existing).count(), 2)
        self.assertLedger(existing, new)

    def test_archived_rows_do_not_count_against_the_plan_but_unarchiving_does(self):
        small = replace(plans.PLANS["pro"], products=3)
        for n in range(3):
            self.product(f"F{n}", slug=f"f{n}", stock_count=0)
        with patch.dict(plans.PLANS, {"pro": small}):
            full = self.upload("sku;nom;prix\nNEW;Neuf;900\n").json()
            self.assertEqual(full["errors"][0]["code"], "plan_limit_reached")
            self.assertEqual(self.upload("sku;nom;prix;statut\nNEW;Neuf;900;archive\n").json()["error_count"], 0)
            self.assertEqual(Product.objects.get(sku="NEW").status, "archived")
            self.assertEqual(self.upload("sku;nom;prix;statut\nNEW;Neuf;900;actif\n").json()["errors"][0]["code"], "plan_limit_reached")


class SectorFieldTests(ProductCase):
    def setUp(self):
        super().setUp()
        self.authenticate(self.manager)
        self.item = self.product("KAR", slug="kar")

    def patch(self, **body):
        return self.client.patch(f"{SHOP}/products/{self.item.pk}", body, format="json")

    def test_closed_lists_and_ranges(self):
        self.assertEqual(self.patch(condition="cassé").status_code, 400)
        self.assertEqual(self.patch(sold_by="mètre").status_code, 400)
        self.assertEqual(self.patch(warranty_months=0).status_code, 400)
        self.assertEqual(self.patch(warranty_months=61).status_code, 400)
        ok = self.patch(condition="refurbished", warranty_months=12, sold_by="kg", bulky=True)
        self.assertEqual(ok.status_code, 200, ok.content)

    def test_made_to_order_needs_a_delay(self):
        refused = self.patch(made_to_order=True)
        self.assertEqual(refused.json()["errors"]["made_to_order"][0]["code"], "made_to_order_needs_delay")
        ok = self.patch(made_to_order=True, allow_backorder=True, backorder_days=14)
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(self.patch(allow_backorder=False).status_code, 400)

    def test_public_details_hold_only_what_is_filled(self):
        self.client.credentials()
        self.assertEqual(self.client.get(f"{STOREFRONT}/products/kar").json()["details"], {})
        Product.objects.filter(pk=self.item.pk).update(condition="used", warranty_months=6, sold_by="tas", made_to_order=True, bulky=True)
        details = self.client.get(f"{STOREFRONT}/products/kar").json()["details"]
        self.assertEqual(details, {"condition": "used", "warranty_months": 6, "sold_by": "tas", "made_to_order": True, "bulky": True})

    def test_values_survive_and_html_is_refused_in_text_fields(self):
        self.patch(condition="new")
        self.assertEqual(self.client.get(f"{SHOP}/products/{self.item.pk}").json()["condition"], "new")
        self.assertEqual(self.patch(name="<script>x</script>").status_code, 400)
