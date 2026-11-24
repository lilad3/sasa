"""Catalogue des packs (spécialités) de lancement."""

from django.test import SimpleTestCase

from shops.design_catalog import STYLES
from shops.packs import PACKS, PRODUCT_FIELDS


class PackTests(SimpleTestCase):
    def test_launch_packs(self):
        self.assertEqual(
            list(PACKS),
            ["plats", "mode-femme", "mode-homme", "chaussures", "sacs", "bijoux-montres", "parfums-beaute", "tech", "general"],
        )

    def test_pack_coherence(self):
        for pack in PACKS.values():
            self.assertIn(pack.default_style, pack.styles)
            self.assertTrue(set(pack.styles) <= set(STYLES))
            self.assertTrue(set(pack.fields) <= set(PRODUCT_FIELDS))
            self.assertGreaterEqual(len(pack.categories), 3)
            # Vidéos et univers de catégorie : partout (décision du 24/11/2026).
            self.assertIn("video", pack.sections)
            self.assertIn("univers", pack.sections)

    def test_chaussures(self):
        pack = PACKS["chaussures"]
        self.assertEqual(pack.styles, ("tailor", "wardrobe"))
        self.assertIn("pointure", pack.fields)
        self.assertNotIn("essayer-le-look", pack.sections)
