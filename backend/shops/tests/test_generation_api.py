"""API de génération du thème : publie le style et le pack choisis par les règles."""

import copy

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_shop
from shops.models import Shop, StorefrontVersion

SHOP = "/api/v1/shops/maison-test"
STOREFRONT = "/api/v1/storefront/maison-test"
SHOES_MAN = {"sector": "mode", "focus": ["chaussures"], "audience": "homme"}


class GenerationApiTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.authenticate(self.owner)

    def generate(self, body):
        return self.client.post(f"{SHOP}/storefront/generate", body, format="json")

    def published(self):
        return StorefrontVersion.objects.filter(shop=self.shop, status=StorefrontVersion.Status.PUBLISHED)

    def test_generate_publishes_style_and_pack(self):
        response = self.generate(SHOES_MAN)
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual((body["style"], body["pack"]), ("tailor", "chaussures"))
        self.assertEqual(body["categories"], ["Baskets", "Ville", "Sandales", "Nouveautés"])
        self.assertEqual(body["published"]["config"]["theme"], "tailor")
        self.assertEqual(body["published"]["config"]["pack"], "chaussures")
        self.shop.refresh_from_db()
        self.assertEqual((self.shop.sector, self.shop.pack, self.shop.generated_style), ("mode", "chaussures", "tailor"))
        self.assertTrue(AuditEvent.objects.filter(action="storefront_published", shop_id=self.shop.pk).exists())

    def test_generated_style_allowed_on_free_plan_but_not_others(self):
        self.assertEqual(self.generate({"sector": "telephones", "focus": [], "audience": "tous"}).status_code, 201)
        config = copy.deepcopy(self.published().get().config)
        self.assertEqual(self.client.put(f"{SHOP}/storefront/draft", {"config": config}, format="json").status_code, 200)
        config["theme"] = "kitchen"
        self.assertProblem(self.client.put(f"{SHOP}/storefront/draft", {"config": config}, format="json"), 403, "plan_limit_reached")
        allowed = {t["id"]: t["allowed"] for t in self.client.get(f"{SHOP}/storefront").json()["themes"]}
        self.assertTrue(allowed["tech"])
        self.assertFalse(allowed["kitchen"])

    def test_generate_twice_keeps_one_published(self):
        self.generate(SHOES_MAN)
        self.assertEqual(self.generate({"sector": "restaurant", "focus": [], "audience": "tous"}).status_code, 201)
        self.assertEqual(self.published().count(), 1)
        self.assertEqual(self.published().get().config["theme"], "kitchen")
        self.shop.refresh_from_db()
        self.assertEqual(self.shop.pack, "plats")

    def test_seller_cannot_generate(self):
        seller = make_member("seller@example.ci", self.shop, "seller")
        self.authenticate(seller)
        self.assertEqual(self.generate(SHOES_MAN).status_code, 403)

    def test_bad_answers_are_400(self):
        self.assertEqual(self.generate({"sector": "voitures", "focus": [], "audience": "tous"}).status_code, 400)
        self.assertEqual(self.generate({"sector": "mode", "focus": "chaussures", "audience": "tous"}).status_code, 400)
        self.assertEqual(self.generate({"sector": "mode", "focus": [], "audience": "enfants"}).status_code, 400)
        self.assertEqual(self.published().count(), 0)

    def test_storefront_shows_generated_theme(self):
        self.generate(SHOES_MAN)
        self.client.logout()
        design = self.client.get(STOREFRONT).json()["design"]
        self.assertEqual((design["theme"], design["pack"]), ("tailor", "chaussures"))

    def test_existing_legacy_storefront_untouched(self):
        StorefrontVersion.objects.create(
            shop=self.shop, number=1, status=StorefrontVersion.Status.PUBLISHED,
            config={"version": 1, "theme": "epicerie", "motion": "soft", "cover": "featured",
                    "sections": ["livraison", "demandes", "collection", "suivi"], "texts": {"tagline": "", "story": ""}},
        )
        self.assertEqual(self.client.get(STOREFRONT).json()["design"]["theme"], "epicerie")
        ids = [t["id"] for t in self.client.get(f"{SHOP}/storefront").json()["themes"]]
        self.assertEqual(ids[-1], "epicerie")
        self.assertEqual(Shop.objects.get(pk=self.shop.pk).pack, "")
