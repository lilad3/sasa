"""Catalogue des styles de vitrine (feuille de route thèmes, étape 1)."""

from django.test import SimpleTestCase

from shops.design_catalog import STYLES, THEMES, selectable_themes


class ThemeCatalogTests(SimpleTestCase):
    def test_new_styles_are_selectable(self):
        self.assertEqual(selectable_themes(), ["kitchen", "wardrobe", "tailor", "tech", "market"])

    def test_old_themes_stay_valid_but_hidden(self):
        for key in ("essentiel", "epicerie", "beaute", "artisanat", "piece-phare"):
            self.assertTrue(THEMES[key]["legacy"])
            self.assertNotIn(key, selectable_themes())

    def test_every_style_has_collection_section(self):
        for key in STYLES:
            self.assertIn("collection", THEMES[key]["sections"])
            self.assertFalse(THEMES[key]["legacy"])
