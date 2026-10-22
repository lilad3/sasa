import io

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_shop


def picture(fmt="PNG", size=(1200, 800), exif=False):
    image = Image.new("RGB", size, (255, 122, 31))
    out = io.BytesIO()
    kwargs = {}
    if exif:
        data = Image.Exif()
        data[0x8825] = {2: (5.0, 20.0, 0.0)}  # GPS : latitude
        data[0x010F] = "Téléphone de test"
        kwargs["exif"] = data
    image.save(out, format=fmt, **kwargs)
    return out.getvalue()


class LogoTests(ApiTestCase):
    """Logo (docs/chantier-p4.md §G) : lu d'après le contenu, réencodé en PNG, servi sans surprise."""

    def setUp(self):
        self.shop = make_shop("maison-test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.url = "/api/v1/shops/maison-test/logo"

    def upload(self, content, name="logo.png", content_type="image/png"):
        return self.client.post(self.url, {"logo": SimpleUploadedFile(name, content, content_type=content_type)}, format="multipart")

    def test_jpeg_with_gps_is_reencoded_as_a_clean_png(self):
        self.authenticate(self.owner)
        response = self.upload(picture("JPEG", exif=True), name="photo.jpg", content_type="image/jpeg")
        self.assertEqual(response.status_code, 200, response.content)
        version = response.json()["logo_version"]

        served = self.client.get("/api/v1/storefront/maison-test/logo")
        self.assertEqual(served["Content-Type"], "image/png")
        self.assertEqual(served["X-Content-Type-Options"], "nosniff")
        image = Image.open(io.BytesIO(served.content))
        self.assertEqual((image.format, max(image.size)), ("PNG", 512))
        self.assertFalse(image.getexif())
        self.assertEqual(self.client.get("/api/v1/storefront/maison-test").json()["logo_version"], version)
        self.assertEqual(self.client.get("/api/v1/me/shops").json()[0]["logo_version"], version)
        self.assertTrue(AuditEvent.objects.filter(action="shop_logo_changed").exists())

    def test_svg_gif_and_disguised_files_are_refused(self):
        self.authenticate(self.owner)
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'
        self.assertProblem(self.upload(svg, name="logo.png"), 415, "unsupported_file")
        self.assertProblem(self.upload(picture("GIF"), name="logo.gif", content_type="image/gif"), 415, "unsupported_file")
        self.assertProblem(self.upload(b"MZ\x90\x00 pas une image", name="logo.png"), 415, "unsupported_file")

    def test_size_limit_and_roles(self):
        self.authenticate(self.owner)
        self.assertProblem(self.upload(b"0" * (2 * 1024 * 1024 + 1)), 413, "file_too_large")

        manager = make_member("manager@example.ci", self.shop, "manager")
        self.authenticate(manager)
        self.assertProblem(self.upload(picture()), 403, "permission_denied")
        manager.memberships.update(grants=["storefront.edit"])
        self.assertEqual(self.upload(picture()).status_code, 200)

    def test_no_logo_is_a_404_and_delete_removes_it(self):
        self.assertProblem(self.client.get("/api/v1/storefront/maison-test/logo"), 404, "not_found")
        self.authenticate(self.owner)
        self.upload(picture())
        self.assertEqual(self.client.delete(self.url).status_code, 204)
        self.assertIsNone(self.client.get("/api/v1/storefront/maison-test").json()["logo_version"])
