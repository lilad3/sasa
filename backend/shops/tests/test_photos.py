"""Lot 2 de P5 : photos de produit et produit à la une (docs/chantier-p5.md §2)."""

import io
from datetime import timedelta
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_order, make_shop
from shops.models import Product, ProductPhoto

from .test_logo import picture

SHOP = "/api/v1/shops/maison-test"
STOREFRONT = "/api/v1/storefront/maison-test"


class PhotoTestCase(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.manager = make_member("fatou@example.ci", self.shop, "manager")
        self.seller = make_member("koffi@example.ci", self.shop, "seller")
        self.karite = Product.objects.create(shop=self.shop, sku="KAR", slug="karite", name="Beurre de karité", price=2500, stock=10)
        self.pagne = Product.objects.create(shop=self.shop, sku="PAG", slug="pagne", name="Pagne baoulé", price=35000, stock=3)

    def photos_url(self, product=None):
        return f"{SHOP}/products/{(product or self.karite).pk}/photos"

    def upload(self, content=None, product=None, name="photo.jpg", content_type="image/jpeg"):
        content = picture("JPEG") if content is None else content
        file = SimpleUploadedFile(name, content, content_type=content_type)
        return self.client.post(self.photos_url(product), {"photo": file}, format="multipart")

    def positions(self, product=None):
        return list((product or self.karite).photos.order_by("position").values_list("pk", "position"))


class PhotoUploadTests(PhotoTestCase):
    def test_photo_is_reencoded_as_webp_without_exif_and_served_safely(self):
        self.authenticate(self.owner)
        response = self.upload(picture("JPEG", size=(2400, 1600), exif=True))
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["position"], 0)

        served = self.client.get(f"{STOREFRONT}/photos/{body['id']}", HTTP_ACCEPT="image/webp")
        self.assertEqual(served["Content-Type"], "image/webp")
        self.assertEqual(served["X-Content-Type-Options"], "nosniff")
        self.assertEqual(served["Content-Security-Policy"], "default-src 'none'; sandbox")
        image = Image.open(io.BytesIO(served.content))
        self.assertEqual((image.format, image.size), ("WEBP", (1200, 800)))
        self.assertFalse(image.getexif())
        self.assertNotIn(b"Exif", served.content[:4096])

        # La fiche marchande et la vitrine publient la photo, dans l'ordre.
        expected = [{"id": body["id"], "version": body["version"]}]
        self.assertEqual(self.client.get(f"{SHOP}/products/{self.karite.pk}").json()["photos"], expected)
        listed = {p["slug"]: p["photos"] for p in self.client.get(f"{STOREFRONT}/products").json()}
        self.assertEqual(listed["karite"], expected)
        self.assertEqual(listed["pagne"], [])

    def test_png_with_transparency_keeps_it(self):
        self.authenticate(self.owner)
        out = io.BytesIO()
        Image.new("RGBA", (300, 300), (255, 122, 31, 0)).save(out, format="PNG")
        photo_id = self.upload(out.getvalue(), name="photo.png", content_type="image/png").json()["id"]
        image = Image.open(io.BytesIO(self.client.get(f"{STOREFRONT}/photos/{photo_id}").content))
        self.assertEqual(image.mode, "RGBA")

    def test_files_that_are_not_photos_are_refused(self):
        self.authenticate(self.owner)
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'
        self.assertProblem(self.upload(svg, name="photo.jpg"), 415, "unsupported_file")
        self.assertProblem(self.upload(picture("GIF"), name="photo.gif", content_type="image/gif"), 415, "unsupported_file")
        self.assertProblem(self.upload(b"MZ\x90\x00 pas une image"), 415, "unsupported_file")
        self.assertProblem(self.upload(b"0" * (2 * 1024 * 1024 + 1)), 413, "file_too_large")
        # 6 000 × 5 000 = 30 millions de pixels : refusée d'après l'en-tête, avant tout décodage.
        huge = io.BytesIO()
        Image.new("1", (6000, 5000)).save(huge, format="PNG")
        self.assertProblem(self.upload(huge.getvalue(), name="photo.png", content_type="image/png"), 415, "unsupported_file")
        self.assertProblem(self.client.post(self.photos_url(), {}, format="multipart"), 400, "validation_error")
        self.assertFalse(ProductPhoto.objects.exists())

    def test_three_photos_at_most(self):
        self.authenticate(self.owner)
        for _ in range(3):
            self.assertEqual(self.upload().status_code, 201)
        self.assertProblem(self.upload(), 409, "photo_limit")
        self.assertEqual([position for _, position in self.positions()], [0, 1, 2])

    def test_roles_and_other_shops(self):
        self.authenticate(self.seller)
        self.assertProblem(self.upload(), 403, "permission_denied")

        self.authenticate(self.manager)
        self.assertEqual(self.upload().status_code, 201)

        other = make_shop("autre-boutique")
        stranger = make_member("autre@example.ci", other, "owner")
        self.authenticate(stranger)
        self.assertProblem(self.upload(), 404, "not_found")
        # Un produit d'une autre boutique, visé depuis la sienne.
        self.assertProblem(self.client.post(f"/api/v1/shops/autre-boutique/products/{self.karite.pk}/photos", {}, format="multipart"), 404, "not_found")

    def test_upload_rate_limit(self):
        self.authenticate(self.owner)
        with patch("shops.photos.UPLOAD_LIMIT", (2, 3600)):
            self.assertEqual(self.upload().status_code, 201)
            # Même un envoi refusé compte : la limite passe avant le travail de Pillow.
            self.assertProblem(self.upload(b"pas une image"), 415, "unsupported_file")
            self.assertProblem(self.upload(), 429, "too_many_requests")


class PhotoOrderTests(PhotoTestCase):
    def setUp(self):
        super().setUp()
        self.authenticate(self.owner)
        self.ids = [self.upload().json()["id"] for _ in range(3)]

    def test_main_moves_a_photo_first_and_keeps_the_others_in_order(self):
        response = self.client.put(f"{self.photos_url()}/{self.ids[2]}/main")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([p["id"] for p in response.json()], [self.ids[2], self.ids[0], self.ids[1]])
        self.assertEqual([str(pk) for pk, _ in self.positions()], [self.ids[2], self.ids[0], self.ids[1]])

    def test_delete_closes_the_gap(self):
        self.assertEqual(self.client.delete(f"{self.photos_url()}/{self.ids[0]}").status_code, 204)
        self.assertEqual([(str(pk), position) for pk, position in self.positions()], [(self.ids[1], 0), (self.ids[2], 1)])
        # La place libérée resservira.
        self.assertEqual(self.upload().json()["position"], 2)

    def test_a_photo_of_another_product_or_shop_is_a_404(self):
        self.assertProblem(self.client.delete(f"{self.photos_url(self.pagne)}/{self.ids[0]}"), 404, "not_found")
        self.assertProblem(self.client.put(f"{self.photos_url(self.pagne)}/{self.ids[0]}/main"), 404, "not_found")
        make_shop("autre-boutique")
        self.assertProblem(self.client.get(f"/api/v1/storefront/autre-boutique/photos/{self.ids[0]}", HTTP_ACCEPT="image/webp"), 404, "not_found")
        self.assertEqual(self.karite.photos.count(), 3)

    def test_seller_cannot_reorder_or_delete(self):
        self.authenticate(self.seller)
        self.assertProblem(self.client.put(f"{self.photos_url()}/{self.ids[1]}/main"), 403, "permission_denied")
        self.assertProblem(self.client.delete(f"{self.photos_url()}/{self.ids[1]}"), 403, "permission_denied")

    def test_deleting_the_product_deletes_its_photos(self):
        self.assertEqual(self.client.delete(f"{SHOP}/products/{self.karite.pk}").status_code, 204)
        self.assertFalse(ProductPhoto.objects.exists())
        self.assertProblem(self.client.get(f"{STOREFRONT}/photos/{self.ids[0]}"), 404, "not_found")


class FeaturedTests(PhotoTestCase):
    def feature(self, product):
        return self.client.put(f"{SHOP}/products/{product.pk}/featured")

    def cover(self):
        return self.client.get(STOREFRONT).json()["featured"]

    def test_one_featured_product_per_shop(self):
        self.authenticate(self.owner)
        self.assertEqual(self.feature(self.karite).status_code, 200)
        self.assertEqual(self.feature(self.pagne).status_code, 200)
        self.assertEqual(list(Product.objects.filter(is_featured=True).values_list("slug", flat=True)), ["pagne"])
        self.assertEqual(self.cover(), {"product_id": str(self.pagne.pk), "source": "chosen"})
        self.assertTrue(self.client.get(f"{SHOP}/products/{self.pagne.pk}").json()["is_featured"])
        # Reposer la même une ne journalise rien de plus.
        self.feature(self.pagne)
        self.assertEqual(AuditEvent.objects.filter(action="product_featured").count(), 2)

        self.assertEqual(self.client.delete(f"{SHOP}/products/{self.pagne.pk}/featured").status_code, 200)
        self.assertEqual(self.client.delete(f"{SHOP}/products/{self.pagne.pk}/featured").status_code, 200)
        self.assertFalse(Product.objects.filter(is_featured=True).exists())
        changes = list(AuditEvent.objects.filter(action="product_featured").order_by("id").values_list("metadata__change", flat=True))
        self.assertEqual(changes, ["set", "set", "removed"])

    def test_the_product_form_cannot_set_the_flag(self):
        self.authenticate(self.owner)
        self.client.patch(f"{SHOP}/products/{self.karite.pk}", {"is_featured": True})
        self.assertFalse(Product.objects.get(pk=self.karite.pk).is_featured)

    def test_hidden_product_cannot_be_featured(self):
        self.authenticate(self.owner)
        Product.objects.filter(pk=self.karite.pk).update(is_active=False)
        self.assertProblem(self.feature(self.karite), 409, "product_inactive")

    def test_storefront_edit_is_required(self):
        self.authenticate(self.seller)
        self.assertProblem(self.feature(self.karite), 403, "permission_denied")
        self.authenticate(self.manager)
        self.assertProblem(self.feature(self.karite), 403, "permission_denied")
        self.manager.memberships.update(grants=["storefront.edit"])
        self.assertEqual(self.feature(self.karite).status_code, 200)

        other = make_shop("autre-boutique")
        self.authenticate(make_member("autre@example.ci", other, "owner"))
        self.assertProblem(self.client.put(f"/api/v1/shops/autre-boutique/products/{self.karite.pk}/featured"), 404, "not_found")
        self.assertProblem(self.feature(self.pagne), 404, "not_found")

    def test_cover_falls_back_to_best_seller_then_price(self):
        # Sans une ni vente : le plus cher en stock.
        self.assertEqual(self.cover(), {"product_id": str(self.pagne.pk), "source": "price"})

        # Le karité se vend mieux sur 30 jours ; les commandes annulées et anciennes ne comptent pas.
        make_order(self.shop, product=self.karite, quantity=4)
        make_order(self.shop, product=self.pagne, quantity=9, status="cancelled")
        make_order(self.shop, product=self.pagne, quantity=9, age=timedelta(days=40))
        make_order(self.shop, product=self.pagne, quantity=2)
        self.assertEqual(self.cover(), {"product_id": str(self.karite.pk), "source": "best_seller"})

        # Un produit à la une épuisé ou masqué cède la place.
        Product.objects.filter(pk=self.pagne.pk).update(is_featured=True, stock=0)
        self.assertEqual(self.cover()["source"], "best_seller")
        Product.objects.filter(pk=self.pagne.pk).update(stock=3)
        self.assertEqual(self.cover(), {"product_id": str(self.pagne.pk), "source": "chosen"})

        Product.objects.update(stock=0)
        self.assertIsNone(self.cover())
