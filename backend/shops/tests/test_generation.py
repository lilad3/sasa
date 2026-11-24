"""Règles qui choisissent le style, le pack et les catégories à partir des réponses d'inscription."""

from django.test import SimpleTestCase

from shops.generation import generate
from shops.packs import PACKS


class GenerationTests(SimpleTestCase):
    def test_restaurant(self):
        self.assertEqual(generate("restaurant", [], "tous"), {"style": "kitchen", "pack": "plats", "categories": list(PACKS["plats"].categories)})

    def test_shoes_only_man(self):
        self.assertEqual(
            generate("mode", ["chaussures"], "homme"),
            {"style": "tailor", "pack": "chaussures", "categories": ["Baskets", "Ville", "Sandales", "Nouveautés"]},
        )

    def test_shoes_only_woman(self):
        self.assertEqual(generate("mode", ["chaussures"], "femme")["style"], "wardrobe")

    def test_mode_several_focus(self):
        result = generate("mode", ["vetements", "sacs"], "femme")
        self.assertEqual((result["style"], result["pack"]), ("wardrobe", "mode-femme"))
        self.assertEqual(result["categories"], ["Vêtements", "Sacs"])

    def test_mode_man_several_focus(self):
        self.assertEqual(generate("mode", ["vetements", "chaussures"], "homme")["pack"], "mode-homme")

    def test_mode_tous_defaults_to_wardrobe(self):
        self.assertEqual(generate("mode", [], "tous")["pack"], "mode-femme")

    def test_telephones(self):
        self.assertEqual(generate("telephones", [], "tous")["style"], "tech")

    def test_beaute(self):
        self.assertEqual(generate("beaute", ["parfums"], "femme")["pack"], "parfums-beaute")

    def test_other_sectors_are_market(self):
        for sector in ("epicerie", "maison", "artisanat", "autre"):
            self.assertEqual(generate(sector, [], "tous"), {"style": "market", "pack": "general", "categories": list(PACKS["general"].categories)})

    def test_unknown_focus_ignored(self):
        self.assertEqual(generate("restaurant", ["chaussures"], "tous")["pack"], "plats")

    def test_duplicate_focus_counts_once(self):
        self.assertEqual(generate("mode", ["sacs", "sacs"], "femme")["pack"], "sacs")

    def test_bad_sector_raises(self):
        with self.assertRaises(ValueError):
            generate("voitures", [], "tous")

    def test_bad_audience_raises(self):
        with self.assertRaises(ValueError):
            generate("mode", [], "enfants")
