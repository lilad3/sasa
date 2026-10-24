from django.core.files.uploadedfile import SimpleUploadedFile

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_order, make_shop
from shops.models import Product


def reauth(client, password="pirogue-lagune-mangue"):
    return client.post("/api/v1/auth/reauth", {"password": password})


class ProductTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.shop.plan = "pro"
        self.shop.save()
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.seller = make_member("seller@example.ci", self.shop, "seller")
        self.url = "/api/v1/shops/maison-test/products"

    def test_owner_creates_edits_and_deletes_a_product(self):
        self.authenticate(self.owner)
        created = self.client.post(self.url, {"sku": "KAR-500", "name": "Karité 500 g", "price": 2500, "stock": 3})
        self.assertEqual(created.status_code, 201, created.content)
        product = created.json()
        self.assertEqual(product["slug"], "karite-500-g")

        patched = self.client.patch(f"{self.url}/{product['id']}", {"price": 2800, "low_stock_threshold": 4})
        self.assertEqual(patched.json()["price"], 2800)
        self.assertEqual(self.client.get(f"{self.url}?stock=low").json()["count"], 1)
        self.assertEqual(self.client.delete(f"{self.url}/{product['id']}").status_code, 204)

    def test_seller_reads_but_cannot_write(self):
        self.authenticate(self.seller)
        self.assertEqual(self.client.get(self.url).status_code, 200)
        self.assertProblem(self.client.post(self.url, {"sku": "X", "name": "Test", "price": 100}), 403, "permission_denied")

    def test_sku_is_unique_and_image_must_be_https(self):
        Product.objects.create(shop=self.shop, sku="KAR", slug="karite", name="Karité", price=2500)
        self.authenticate(self.owner)
        response = self.client.post(
            self.url, {"sku": "kar", "name": "Autre", "price": 100, "image_url": "javascript:alert(1)//x.png"}
        )
        self.assertProblem(response, 400, "validation_error")
        self.assertEqual(set(response.json()["errors"]), {"sku", "image_url"})

    def test_free_plan_stops_at_25_products(self):
        self.shop.plan = "free"
        self.shop.save()
        Product.objects.bulk_create(
            Product(shop=self.shop, sku=f"P{i}", slug=f"p{i}", name=f"Produit {i}", price=100) for i in range(25)
        )
        self.authenticate(self.owner)
        response = self.client.post(self.url, {"sku": "P25", "name": "Un de trop", "price": 100})
        self.assertProblem(response, 403, "plan_limit_reached")
        self.assertEqual(response.json()["limit"], 25)

    def test_product_of_another_shop_is_invisible(self):
        other = make_shop("autre")
        foreign = Product.objects.create(shop=other, sku="X", slug="x", name="Ailleurs", price=100)
        self.authenticate(self.owner)
        self.assertProblem(self.client.get(f"{self.url}/{foreign.pk}"), 404, "not_found")
        self.assertProblem(self.client.patch(f"{self.url}/{foreign.pk}", {"price": 1}), 404, "not_found")


class ImportTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.shop.plan = "pro"
        self.shop.save()
        self.authenticate(make_member("owner@example.ci", self.shop, "owner"))
        self.url = "/api/v1/shops/maison-test/products/import"

    def upload(self, text, name="catalogue.csv", dry_run=False, encoding="utf-8-sig"):
        data = {"file": SimpleUploadedFile(name, text.encode(encoding), content_type="text/csv")}
        if dry_run:
            data["dry_run"] = "1"
        return self.client.post(self.url, data, format="multipart")

    def test_excel_csv_with_semicolons_is_previewed_then_imported(self):
        csv = "Référence;Nom;Prix;Stock;Catégorie;Actif\nKAR-500;Karité 500 g;2 500 F;12;Beauté;oui\nCAF-250;Café de Man;3000;0;Épicerie;non\n"
        preview = self.upload(csv, dry_run=True).json()
        self.assertEqual((preview["created"], preview["error_count"]), (2, 0))
        self.assertFalse(Product.objects.exists())

        report = self.upload(csv).json()
        self.assertEqual(report["created"], 2)
        self.assertEqual(Product.objects.get(sku="KAR-500").price, 2500)
        self.assertEqual(Product.objects.get(sku="CAF-250").status, "draft")

    def test_one_bad_line_imports_nothing(self):
        report = self.upload("sku,nom,prix\nA1,Bon produit,100\nA2,Mauvais prix,douze\n").json()
        self.assertEqual(report["created"], 0)
        # Une seule erreur pour le prix illisible, pas une seconde « champ obligatoire ».
        self.assertEqual([(e["line"], e["field"], e["code"]) for e in report["errors"]], [(3, "price", "invalid_number")])
        self.assertFalse(Product.objects.exists())

    def test_existing_sku_is_updated_and_empty_cells_keep_values(self):
        Product.objects.create(shop=self.shop, sku="A1", slug="a1", name="Ancien nom", price=100, stock=7)
        report = self.upload("sku;nom;prix;stock\nA1;Nouveau nom;150;\n").json()
        self.assertEqual(report["updated"], 1)
        product = Product.objects.get(sku="A1")
        self.assertEqual((product.name, product.price, product.stock), ("Nouveau nom", 150, 7))

    def test_wrong_type_size_and_plan_are_refused(self):
        self.assertProblem(self.upload("x", name="catalogue.xlsx"), 415, "unsupported_file")
        self.assertProblem(self.upload("sku\n" + "A" * 600_000), 413, "file_too_large")
        self.shop.plan = "free"
        self.shop.save()
        self.assertProblem(self.upload("sku;nom;prix\nA1;Produit;100\n"), 403, "plan_limit_reached")


class ExportTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.url = "/api/v1/shops/maison-test/orders/export"

    def test_export_needs_a_fresh_confirmation(self):
        self.authenticate(self.owner)
        self.assertProblem(self.client.get(self.url), 403, "reauth_required")

    def test_spreadsheet_formulas_are_neutralised_and_export_is_logged(self):
        make_order(self.shop, customer_name="=CMD()", customer_landmark="+33 rue du piège")
        self.authenticate(self.owner)
        self.assertEqual(reauth(self.client).status_code, 200)

        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertIn("attachment", response["Content-Disposition"])
        content = response.content.decode("utf-8-sig")
        self.assertIn(";'=CMD();", content)
        self.assertIn(";'+33 rue du piège;", content)
        self.assertTrue(AuditEvent.objects.filter(action="orders_exported", actor_id=self.owner.pk).exists())

    def test_seller_cannot_export(self):
        self.authenticate(make_member("seller@example.ci", self.shop, "seller"))
        self.assertProblem(self.client.get(self.url), 403, "permission_denied")


class ApiKeyTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.shop.plan = "pro"
        self.shop.save()
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        Product.objects.create(shop=self.shop, sku="KAR", slug="karite", name="Karité", price=2500)
        self.url = "/api/v1/shops/maison-test/api-keys"

    def create_key(self, scopes=("catalog:read",)):
        self.authenticate(self.owner)
        reauth(self.client)
        response = self.client.post(self.url, {"name": "Comptabilité", "scopes": list(scopes)})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def public(self, path, key):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {key}")
        return self.client.get(f"/api/public/v1/{path}")

    def test_creating_a_key_needs_a_fresh_confirmation(self):
        self.authenticate(self.owner)
        self.assertProblem(self.client.post(self.url, {"name": "Test", "scopes": ["catalog:read"]}), 403, "reauth_required")

    def test_the_full_key_is_shown_once_and_never_stored(self):
        created = self.create_key()
        key = created["key"]
        self.assertRegex(key, r"^akw_live_[A-Za-z0-9]{8}_[A-Za-z0-9]{32}$")
        secret = key.rsplit("_", 1)[1]
        from shops.models import ApiKey

        stored = ApiKey.objects.get()
        self.assertNotIn(secret, str(stored.__dict__))
        self.client.credentials()
        self.authenticate(self.owner)
        self.assertNotIn("key", self.client.get(self.url).json()[0])

    def test_key_reads_its_shop_within_its_scopes(self):
        key = self.create_key()["key"]
        products = self.public("products", key)
        self.assertEqual(products.status_code, 200, products.content)
        self.assertEqual(products.json()["results"][0]["sku"], "KAR")
        self.assertProblem(self.public("orders", key), 403, "scope_missing")

    def test_revoked_or_forged_keys_are_refused(self):
        created = self.create_key()
        self.client.credentials()
        self.authenticate(self.owner)
        self.assertEqual(self.client.delete(f"{self.url}/{created['id']}").status_code, 204)
        self.assertProblem(self.public("products", created["key"]), 401, "api_key_invalid")
        forged = created["key"][:-4] + "AAAA"
        self.assertProblem(self.public("products", forged), 401, "api_key_invalid")

    def test_free_plan_cannot_create_keys(self):
        self.shop.plan = "free"
        self.shop.save()
        self.authenticate(self.owner)
        reauth(self.client)
        self.assertProblem(self.client.post(self.url, {"name": "Test", "scopes": ["catalog:read"]}), 403, "plan_limit_reached")

    def test_public_api_does_not_accept_the_merchant_session(self):
        tokens = self.authenticate(self.owner)
        self.client.bearer(tokens["access"])
        self.assertProblem(self.client.get("/api/public/v1/products"), 401, "api_key_invalid")


class PlanTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.authenticate(self.owner)

    def test_changing_plan_needs_confirmation_and_downgrade_checks_usage(self):
        self.assertProblem(self.client.post("/api/v1/shops/maison-test/plan", {"plan": "pro"}), 403, "reauth_required")
        reauth(self.client)
        self.assertEqual(self.client.post("/api/v1/shops/maison-test/plan", {"plan": "pro"}).json()["current"], "pro")

        make_member("seller@example.ci", self.shop, "seller")
        self.assertProblem(self.client.post("/api/v1/shops/maison-test/plan", {"plan": "free"}), 409, "plan_too_small")

    def test_manager_cannot_see_or_change_the_plan(self):
        self.authenticate(make_member("manager@example.ci", self.shop, "manager"))
        self.assertProblem(self.client.get("/api/v1/shops/maison-test/plans"), 403, "permission_denied")


class SettingsTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.authenticate(make_member("owner@example.ci", self.shop, "owner"))
        self.url = "/api/v1/shops/maison-test/settings"

    def test_vacation_closes_the_storefront_checkout(self):
        response = self.client.patch(self.url, {"vacation_active": True, "vacation_message": "De retour lundi."})
        self.assertTrue(response.json()["vacation"]["on_vacation"])

        storefront = self.client.get("/api/v1/storefront/maison-test").json()
        self.assertEqual(storefront["vacation"]["message"], "De retour lundi.")
        order = self.client.post("/api/v1/storefront/maison-test/orders", {}, HTTP_IDEMPOTENCY_KEY="0f8fad5b-d9cb-469f-a165-70867728950e")
        self.assertProblem(order, 409, "shop_on_vacation")

    def test_free_plan_keeps_the_default_colour_and_html_is_refused(self):
        self.assertProblem(self.client.patch(self.url, {"accent": "indigo"}), 403, "plan_limit_reached")
        self.assertProblem(self.client.patch(self.url, {"name": "<script>Boutique</script>"}), 400, "validation_error")


class TrackingTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.order = make_order(self.shop, phone="+2250701020304")
        self.url = "/api/v1/storefront/maison-test/track"

    def test_reference_and_last_digits_show_the_status_only(self):
        response = self.client.post(self.url, {"reference": self.order.reference.lower().replace("-", ""), "phone_last4": "0304"})
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body["status"], "pending")
        self.assertNotIn("phone", str(body))
        self.assertNotIn("landmark", str(body))

    def test_wrong_digits_look_like_an_unknown_reference_and_guessing_is_limited(self):
        wrong = self.client.post(self.url, {"reference": self.order.reference, "phone_last4": "9999"})
        unknown = self.client.post(self.url, {"reference": "ZZZ-ZZZ", "phone_last4": "0304"})
        self.assertProblem(wrong, 404, "not_found")
        self.assertEqual(wrong.json()["detail"], unknown.json()["detail"])
        for _ in range(4):
            self.client.post(self.url, {"reference": self.order.reference, "phone_last4": "0000"})
        self.assertProblem(self.client.post(self.url, {"reference": self.order.reference, "phone_last4": "0304"}), 429, "too_many_requests")


class OrderNoteTests(ApiTestCase):
    def test_team_notes_appear_on_the_order_and_never_in_the_storefront(self):
        shop = make_shop("maison-test")
        order = make_order(shop)
        self.authenticate(make_member("seller@example.ci", shop, "seller", first_name="Koffi", last_name="Yao"))
        url = f"/api/v1/shops/maison-test/orders/{order.pk}"
        self.assertEqual(self.client.post(f"{url}/notes", {"body": "Client injoignable, rappeler à 18 h"}).status_code, 201)
        notes = self.client.get(url).json()["notes"]
        self.assertEqual((notes[0]["author_name"], notes[0]["body"]), ("Koffi Yao", "Client injoignable, rappeler à 18 h"))


class LowStockTests(ApiTestCase):
    def test_dashboard_lists_products_at_their_threshold(self):
        shop = make_shop("maison-test")
        Product.objects.create(shop=shop, sku="A", slug="a", name="Presque vide", price=100, stock=2, low_stock_threshold=3)
        Product.objects.create(shop=shop, sku="B", slug="b", name="Bien rempli", price=100, stock=50)
        Product.objects.create(shop=shop, sku="C", slug="c", name="Plus en vente", price=100, stock=0, status="draft")
        self.authenticate(make_member("owner@example.ci", shop, "owner"))
        low = self.client.get("/api/v1/shops/maison-test/dashboard?period=7d").json()["low_stock"]
        self.assertEqual((low["count"], low["items"][0]["name"]), (1, "Presque vide"))

