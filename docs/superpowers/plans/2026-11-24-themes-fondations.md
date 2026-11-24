# Thèmes Akwaba — feuille de route et étape 1 (fondations)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** poser le socle serveur des nouveaux thèmes : catalogue des 5 styles, catalogue des packs, règles qui « génèrent » le thème d'une boutique à partir de ses réponses, et l'API qui l'applique.

**Architecture:** thème d'une boutique = **style** (kitchen, wardrobe, tailor, tech, market) × **pack** (spécialité : sections, champs produit, catégories par défaut). Les deux catalogues sont des modules Python feuilles, comme `design_catalog.py`. La génération est une fonction pure (réponses → style, pack, catégories), testée seule ; l'API l'applique en publiant une version de vitrine.

**Tech Stack:** Django 6.1 + DRF, SQLite, tests `core.testing.ApiTestCase` (lancés avec `python manage.py test`).

**Spec:** décisions du fondateur du 24/11/2026 (mémoire `project-akwaba-themes-secteurs`, `project-akwaba-automatique-par-defaut`) et démos validées : `scratchpad/<restauration|femme|homme|tech|general>/*.html`.

## Feuille de route (une étape = un plan, livrable seul)

1. **Fondations (ce plan)** : catalogues styles + packs, règles de génération, API.
2. **Vitrine** : les 5 styles en composants Next (portage des démos), sections par pack, vidéos et univers branchés plus tard.
3. **Univers de catégorie** dans les 5 styles, automatiques (couleur tirée des photos, article mis en avant = meilleure vente sinon dernier ajouté), réglables dans « Ma boutique ».
4. **Vidéos produit** (10 s max) partout, limitées par plan. **Bloquant : hébergement vidéo à choisir par le fondateur** (Vercel refuse > 4,5 Mo, PythonAnywhere gratuit = 512 Mo).
5. **Inscription** : « Que vendez-vous ? » → « Surtout quoi ? » → « Pour qui ? » → écran « Votre boutique se prépare… ».
6. **Espace marchand téléphone par style** (comme « Côté vendeuse » de Wardrobe) : ajouter un article en photo, looks, écran cuisine, champs du pack.
7. **Page Thèmes** avec cadenas selon l'offre, puis éditeur.

## Global Constraints

- Noms de styles en anglais : `kitchen` Kitchen, `wardrobe` Wardrobe, `tailor` Tailor, `tech` Tech, `market` Market.
- Packs de lancement : `plats`, `mode-femme`, `mode-homme`, `chaussures`, `sacs`, `bijoux-montres`, `parfums-beaute`, `tech`, `general`.
- Secteurs de l'inscription (validés le 23/10) : `restaurant`, `mode`, `telephones`, `beaute`, `epicerie`, `maison`, `artisanat`, `autre`.
- Public : `femme`, `homme`, `tous`.
- Les anciens thèmes (`essentiel`, `epicerie`, `beaute`, `artisanat`, `piece-phare`) restent valides pour les vitrines déjà publiées, mais ne sont plus proposés (`legacy: True`).
- Le style généré pour la boutique est toujours permis, quel que soit le plan ; changer pour un autre style suit la colonne `plan` (proposition : tous `pro` ; **choix d'argent du fondateur**, une seule constante à changer).
- Configuration de vitrine = JSON fermé : clé inconnue refusée, valeurs prises dans des listes (règle existante de `design.py`).
- Textes et messages d'erreur en français, termes standards.

## Review Focus

- Réponses incohérentes (secteur `restaurant` + focus `chaussures`) : le focus hors secteur est ignoré, on ne plante pas.
- Focus vide ou plusieurs focus : pack général du secteur, une catégorie par focus coché.
- Générer deux fois (marchand qui revient en arrière) : la seconde génération remplace la première, une seule version publiée.
- Boutique déjà publiée sur un ancien thème : rien ne change tant qu'elle ne génère pas.
- Un vendeur (rôle sans `storefront.edit`) ne peut pas générer.

---

### Task 1: Catalogue des styles

**Files:**
- Modify: `backend/shops/design_catalog.py`
- Test: `backend/shops/tests/test_theme_catalog.py`

**Interfaces:**
- Produces: `THEMES[key]` gagne les clés `legacy: bool` et `sections`; nouveaux `STYLES = ("kitchen", "wardrobe", "tailor", "tech", "market")`; `selectable_themes() -> list[str]` (non legacy, ordre de `STYLES`).

- [ ] **Step 1: Write the failing test**

```python
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
```

- [ ] **Step 2:** `cd backend && .venv/Scripts/python manage.py test shops.tests.test_theme_catalog` → FAIL (import).
- [ ] **Step 3:** ajouter les 5 styles à `THEMES` (`label` = nom anglais, `plan` = `"pro"`, `legacy` = `False`, `sections` = `("collection", "livraison", "suivi")`), `legacy: True` sur les anciens, `STYLES`, `selectable_themes()`. `DesignView.get` ne liste que `selectable_themes()` plus le thème publié s'il est legacy.
- [ ] **Step 4:** relancer ce test et `shops.tests.test_design` → PASS.
- [ ] **Step 5:** commit `Thèmes : catalogue des 5 styles, anciens thèmes conservés en legacy`.

### Task 2: Catalogue des packs

**Files:**
- Create: `backend/shops/packs.py`
- Test: `backend/shops/tests/test_packs.py`

**Interfaces:**
- Produces: `PACKS: dict[str, Pack]` ; `@dataclass(frozen=True) class Pack: id: str; label: str; styles: tuple[str, ...]; default_style: str; categories: tuple[str, ...]; fields: tuple[str, ...]; sections: tuple[str, ...]` ; `PRODUCT_FIELDS = ("taille", "pointure", "coloris", "etat", "garantie", "stockage", "unite", "prix_gros", "poids", "options_plat", "contenance", "matiere")`.

- [ ] **Step 1: Write the failing test**

```python
class PackTests(SimpleTestCase):
    def test_launch_packs(self):
        self.assertEqual(list(PACKS), ["plats", "mode-femme", "mode-homme", "chaussures", "sacs", "bijoux-montres", "parfums-beaute", "tech", "general"])

    def test_pack_coherence(self):
        for pack in PACKS.values():
            self.assertIn(pack.default_style, pack.styles)
            self.assertTrue(set(pack.styles) <= set(STYLES))
            self.assertTrue(set(pack.fields) <= set(PRODUCT_FIELDS))
            self.assertGreaterEqual(len(pack.categories), 3)

    def test_chaussures(self):
        p = PACKS["chaussures"]
        self.assertEqual(p.styles, ("tailor", "wardrobe"))
        self.assertIn("pointure", p.fields)
        self.assertNotIn("essayer-le-look", p.sections)
```

- [ ] **Step 2:** lancer → FAIL.
- [ ] **Step 3:** écrire `packs.py`. Valeurs : `plats` (kitchen ; Plats, Grillades, Boissons, Desserts ; options_plat ; sections video, univers) · `mode-femme` (wardrobe ; Hauts, Bas, Robes, Chaussures, Sacs, Bijoux ; taille, coloris ; essayer-le-look, video, univers) · `mode-homme` (tailor ; Chemises, Pantalons, Costumes, Pagne, Chaussures, Accessoires ; taille, pointure, coloris ; essayer-le-look, video, univers) · `chaussures` (tailor, wardrobe ; Baskets, Ville, Sandales, Nouveautés ; pointure, coloris ; video, univers, sorties) · `sacs` (wardrobe, tailor ; Sacs à main, Sacs à dos, Pochettes, Valises ; coloris, matiere) · `bijoux-montres` (wardrobe, tailor ; Colliers, Bracelets, Boucles d'oreilles, Montres ; matiere) · `parfums-beaute` (wardrobe ; Parfums, Soins, Maquillage, Cheveux ; contenance) · `tech` (tech ; Téléphones, Ordinateurs, Tablettes, Accessoires ; etat, garantie, stockage, coloris ; comparateur, reprise) · `general` (market ; Nouveautés, Maison, Divers, Promotions ; unite, prix_gros, poids). Toutes les sections de pack incluent `video` et `univers`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `Thèmes : catalogue des 9 packs de lancement`.

### Task 3: Règles de génération

**Files:**
- Create: `backend/shops/generation.py`
- Test: `backend/shops/tests/test_generation.py`

**Interfaces:**
- Consumes: `PACKS`, `STYLES`.
- Produces: `SECTORS`, `AUDIENCES`, `FOCUS_BY_SECTOR: dict[str, tuple[str, ...]]` (focus permis par secteur : `mode` → chaussures, sacs, vetements, bijoux ; `beaute` → parfums, soins ; `telephones` → telephones, ordinateurs) ; `generate(sector: str, focus: list[str], audience: str) -> dict` renvoyant `{"style": str, "pack": str, "categories": list[str]}`.

- [ ] **Step 1: Write the failing test** (cas de la spec)

```python
def test_restaurant(self): self.assertEqual(generate("restaurant", [], "tous")["style"], "kitchen")
def test_shoes_only_man(self):
    self.assertEqual(generate("mode", ["chaussures"], "homme"), {"style": "tailor", "pack": "chaussures", "categories": ["Baskets", "Ville", "Sandales", "Nouveautés"]})
def test_shoes_only_woman(self): self.assertEqual(generate("mode", ["chaussures"], "femme")["style"], "wardrobe")
def test_mode_several_focus(self):
    r = generate("mode", ["vetements", "sacs"], "femme")
    self.assertEqual((r["style"], r["pack"]), ("wardrobe", "mode-femme"))
def test_mode_tous_defaults_to_wardrobe(self): self.assertEqual(generate("mode", [], "tous")["pack"], "mode-femme")
def test_telephones(self): self.assertEqual(generate("telephones", [], "tous")["style"], "tech")
def test_beaute(self): self.assertEqual(generate("beaute", ["parfums"], "femme")["pack"], "parfums-beaute")
def test_other_sectors_are_market(self):
    for s in ("epicerie", "maison", "artisanat", "autre"): self.assertEqual(generate(s, [], "tous"), {"style": "market", "pack": "general", "categories": list(PACKS["general"].categories)})
def test_unknown_focus_ignored(self): self.assertEqual(generate("restaurant", ["chaussures"], "tous")["pack"], "plats")
def test_bad_sector_raises(self):
    with self.assertRaises(ValueError): generate("voitures", [], "tous")
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** implémenter. Règle : focus filtrés par `FOCUS_BY_SECTOR` ; un seul focus spécialisé → son pack (`chaussures`, `sacs`, `bijoux` → bijoux-montres, `parfums`/`soins` → parfums-beaute) ; sinon pack du secteur (`mode` → mode-femme si audience `femme` ou `tous`, mode-homme si `homme`). Style = `default_style` du pack, sauf pack à deux styles : `homme` → tailor, sinon wardrobe. Catégories = celles du pack ; plusieurs focus en mode → libellés des focus (Vêtements, Chaussures, Sacs, Bijoux).
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `Thèmes : règles qui choisissent style, pack et catégories`.

### Task 4: Boutique : secteur, pack et API de génération

**Files:**
- Modify: `backend/shops/models.py` (Shop) + migration
- Modify: `backend/shops/design.py`, `backend/shops/design_catalog.py`, `backend/shops/urls.py`
- Test: `backend/shops/tests/test_generation_api.py`

**Interfaces:**
- Consumes: `generate()`, `clean_config`, `DesignScopedView`.
- Produces: `Shop.sector` (CharField 20, blank), `Shop.pack` (CharField 30, blank), `Shop.generated_style` (CharField 20, blank) ; config de vitrine : nouvelle clé `pack` (choix dans `PACKS` ou `""`) ; `POST /api/v1/shops/<slug>/design/generate` body `{"sector", "focus": [], "audience"}` → 201 `{"style", "pack", "categories", "published": version_payload}`.

- [ ] **Step 1: Write the failing tests**

```python
def test_generate_publishes_style_and_pack(self):
    r = self.client.post(f"{SHOP}/design/generate", {"sector": "mode", "focus": ["chaussures"], "audience": "homme"}, format="json")
    self.assertEqual(r.status_code, 201)
    self.assertEqual(r.json()["published"]["config"]["theme"], "tailor")
    self.shop.refresh_from_db()
    self.assertEqual((self.shop.sector, self.shop.pack, self.shop.generated_style), ("mode", "chaussures", "tailor"))

def test_generated_style_allowed_on_free_plan(self): ...  # plan free, generate tech → 201 ; PUT draft avec theme "kitchen" → 403 plan_limit_reached
def test_generate_twice_keeps_one_published(self): ...  # 2 POST → StorefrontVersion published count == 1
def test_seller_cannot_generate(self): ...  # rôle seller → 403
def test_bad_sector_is_400(self): ...  # {"sector": "voitures"} → 400
def test_legacy_published_untouched(self): ...  # vitrine publiée en "epicerie" reste lisible sur /storefront tant qu'on ne génère pas
```

- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** champs + migration (`makemigrations shops`) ; `clean_config` accepte `pack` (défaut `""`) ; `check_plan` laisse passer `config["theme"] == shop.generated_style` ; `DesignGenerateView(DesignScopedView)` (`permission_by_method = {"POST": "storefront.edit"}`, limite `enforce` comme `SAVE_LIMIT`, `record()` d'audit `design.generated`) qui publie la config `default_config(style)` + `pack`, archive l'ancienne publiée comme le fait la publication existante, et sauve les 3 champs.
- [ ] **Step 4:** `manage.py test shops` complet → PASS (aucune régression sur les 513 tests).
- [ ] **Step 5:** commit `Thèmes : génération du thème de la boutique (API)`.
