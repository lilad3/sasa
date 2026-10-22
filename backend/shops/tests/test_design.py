"""Lot 3 de P5 : éditeur « Ma boutique » et thèmes par métier (docs/chantier-p5.md §3)."""

import copy
from datetime import timedelta
from unittest.mock import patch

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_order, make_shop
from shops.models import Product, Shop, StorefrontVersion

SHOP = "/api/v1/shops/maison-test"
STOREFRONT = "/api/v1/storefront/maison-test"

BASE = {
    "version": 1,
    "theme": "epicerie",
    "motion": "soft",
    "cover": "featured",
    "sections": ["livraison", "demandes", "collection", "suivi"],
    "texts": {"tagline": "Le meilleur d'ici, livré en 24 h.", "story": ""},
}


def config(**changes):
    value = copy.deepcopy(BASE)
    texts = changes.pop("texts", None)
    value.update(changes)
    if texts is not None:
        value["texts"].update(texts)
    return value


class DesignTestCase(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.authenticate(self.owner)

    def use_plan(self, plan):
        Shop.objects.filter(pk=self.shop.pk).update(plan=plan)

    def save(self, value=None):
        return self.client.put(f"{SHOP}/storefront/draft", {"config": value if value is not None else config()})

    def publish(self):
        return self.client.post(f"{SHOP}/storefront/publish")


class ValidationTests(DesignTestCase):
    def test_a_valid_config_becomes_the_draft_and_is_updated_in_place(self):
        response = self.save()
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["number"], 1)
        self.assertEqual(response.json()["config"], BASE)
        second = self.save(config(motion="none")).json()
        self.assertEqual((second["number"], second["config"]["motion"]), (1, "none"))
        self.assertEqual(StorefrontVersion.objects.count(), 1)

    def test_closed_schema(self):
        cases = {
            "clé inconnue": {**config(), "css": "body{display:none}"},
            "clé inconnue dans les textes": config(texts={"html": "<b>x</b>"}),
            "thème inconnu": config(theme="restaurant"),
            "mouvement inconnu": config(motion="fou"),
            "section inconnue": config(sections=["collection", "carrousel"]),
            "section en double": config(sections=["collection", "collection"]),
            "sans la collection": config(sections=["livraison", "suivi"]),
            "accroche trop longue": config(texts={"tagline": "x" * 81}),
            "HTML dans l'accroche": config(texts={"tagline": "<script>alert(1)</script>"}),
            "mauvaise version": config(version=2),
            "pas un objet": ["epicerie"],
        }
        for label, value in cases.items():
            with self.subTest(label):
                self.assertProblem(self.save(value), 400, "validation_error")
        self.assertProblem(self.client.put(f"{SHOP}/storefront/draft", {}), 400, "validation_error")
        self.assertFalse(StorefrontVersion.objects.exists())

    def test_texts_are_trimmed_and_newlines_kept_in_the_story(self):
        self.use_plan("pro")
        saved = self.save(config(theme="artisanat", texts={"tagline": "  Fait main  ", "story": "Depuis 2019.\nÀ Cocody."})).json()
        self.assertEqual(saved["config"]["texts"], {"tagline": "Fait main", "story": "Depuis 2019.\nÀ Cocody."})


class PlanTests(DesignTestCase):
    def test_free_plan_keeps_its_two_themes_fixed_sections_and_no_story(self):
        self.assertEqual(self.save(config(theme="essentiel", sections=["livraison", "collection", "suivi"])).status_code, 200)
        self.assertProblem(self.save(config(theme="beaute", sections=["collection", "histoire", "livraison", "suivi"])), 403, "plan_limit_reached")
        self.assertProblem(self.save(config(sections=["collection", "livraison"])), 403, "plan_limit_reached")
        self.assertProblem(self.save(config(texts={"story": "Notre histoire"})), 403, "plan_limit_reached")

        overview = self.client.get(f"{SHOP}/storefront").json()
        allowed = {theme["id"]: theme["allowed"] for theme in overview["themes"]}
        self.assertEqual(allowed, {"essentiel": True, "epicerie": True, "beaute": False, "artisanat": False, "piece-phare": False})
        self.assertEqual(overview["limits"]["versions_kept"], 1)
        self.assertFalse(overview["limits"]["custom_sections"])

    def test_pro_plan_opens_everything(self):
        self.use_plan("pro")
        value = config(theme="piece-phare", sections=["collection", "histoire"], texts={"story": "Une seule pièce par mois."})
        self.assertEqual(self.save(value).status_code, 200)
        self.assertTrue(all(theme["allowed"] for theme in self.client.get(f"{SHOP}/storefront").json()["themes"]))

    def test_a_plan_that_drops_cannot_publish_a_pro_draft_but_keeps_what_is_online(self):
        self.use_plan("pro")
        self.save(config(theme="beaute", sections=["collection", "histoire"]))
        self.publish()
        self.save(config(theme="artisanat", sections=["histoire", "collection"]))
        self.use_plan("free")
        self.assertProblem(self.publish(), 403, "plan_limit_reached")
        self.assertEqual(self.client.get(STOREFRONT).json()["design"]["theme"], "beaute")


class LifecycleTests(DesignTestCase):
    def test_publish_archive_and_storefront(self):
        public = self.client.get(STOREFRONT).json()["design"]
        self.assertEqual((public["theme"], public["sections"]), ("essentiel", ["livraison", "collection", "suivi"]))

        self.assertProblem(self.publish(), 409, "no_draft")
        self.save()
        published = self.publish()
        self.assertEqual(published.status_code, 200, published.content)
        self.assertEqual(published.json()["status"], "published")
        self.assertEqual(self.client.get(STOREFRONT).json()["design"], BASE)
        self.assertIsNone(self.client.get(f"{SHOP}/storefront").json()["draft"])
        event = AuditEvent.objects.get(action="storefront_published")
        self.assertEqual((event.metadata["number"], event.metadata["theme"]), (1, "epicerie"))

    def test_versions_kept_depend_on_the_plan(self):
        for motion in ("full", "soft", "none"):
            self.save(config(motion=motion))
            self.publish()
        # Gratuit : une seule version gardée, celle en ligne.
        self.assertEqual([(v["number"], v["status"]) for v in self.client.get(f"{SHOP}/storefront/versions").json()], [(3, "published")])

        self.use_plan("pro")
        for motion in ("full", "soft"):
            self.save(config(motion=motion))
            self.publish()
        listed = [(v["number"], v["status"]) for v in self.client.get(f"{SHOP}/storefront/versions").json()]
        self.assertEqual(listed, [(5, "published"), (4, "archived"), (3, "archived")])

    def test_restore_copies_an_old_version_into_the_draft(self):
        self.use_plan("pro")
        self.save(config(motion="none"))
        self.publish()
        self.save(config(motion="full"))
        self.publish()
        restored = self.client.post(f"{SHOP}/storefront/versions/1/restore")
        self.assertEqual(restored.status_code, 200, restored.content)
        self.assertEqual((restored.json()["status"], restored.json()["config"]["motion"]), ("draft", "none"))
        self.assertTrue(AuditEvent.objects.filter(action="storefront_restored").exists())
        self.assertProblem(self.client.post(f"{SHOP}/storefront/versions/99/restore"), 404, "not_found")
        # La reprise passe aussi par le plan.
        self.save(config(theme="beaute", sections=["collection"]))
        self.publish()
        self.use_plan("free")
        self.assertProblem(self.client.post(f"{SHOP}/storefront/versions/3/restore"), 403, "plan_limit_reached")

    def test_discarding_the_draft(self):
        self.save()
        self.assertEqual(self.client.delete(f"{SHOP}/storefront/draft").status_code, 204)
        self.assertEqual(self.client.delete(f"{SHOP}/storefront/draft").status_code, 204)
        self.assertFalse(StorefrontVersion.objects.exists())

    def test_save_rate_limit(self):
        with patch("shops.design.SAVE_LIMIT", (2, 3600)):
            self.save()
            self.save()
            self.assertProblem(self.save(), 429, "too_many_requests")


class RightsTests(DesignTestCase):
    def test_roles_and_other_shops(self):
        manager = make_member("fatou@example.ci", self.shop, "manager")
        seller = make_member("koffi@example.ci", self.shop, "seller")
        for user in (seller, manager):
            with self.subTest(user=user.email):
                self.authenticate(user)
                self.assertProblem(self.client.get(f"{SHOP}/storefront"), 403, "permission_denied")
                self.assertProblem(self.save(), 403, "permission_denied")
        manager.memberships.update(grants=["storefront.edit"])
        self.authenticate(manager)
        self.assertEqual(self.save().status_code, 200)
        self.assertEqual(self.publish().status_code, 200)

        self.authenticate(make_member("autre@example.ci", make_shop("autre-boutique"), "owner"))
        self.assertProblem(self.client.get(f"{SHOP}/storefront"), 404, "not_found")
        self.assertProblem(self.publish(), 404, "not_found")


class PopularTests(DesignTestCase):
    def test_popular_products_on_the_storefront(self):
        karite = Product.objects.create(shop=self.shop, sku="KAR", slug="karite", name="Karité", price=2500, stock=10)
        cafe = Product.objects.create(shop=self.shop, sku="CAF", slug="cafe", name="Café", price=3000, stock=10)
        savon = Product.objects.create(shop=self.shop, sku="SAV", slug="savon", name="Savon", price=1000, stock=0)
        make_order(self.shop, product=karite, quantity=2)
        make_order(self.shop, product=cafe, quantity=5)
        make_order(self.shop, product=karite, quantity=9, status="cancelled")
        make_order(self.shop, product=savon, quantity=20)  # épuisé
        make_order(self.shop, product=karite, quantity=30, age=timedelta(days=45))  # trop ancien
        self.assertEqual(self.client.get(STOREFRONT).json()["popular"], [str(cafe.pk), str(karite.pk)])
