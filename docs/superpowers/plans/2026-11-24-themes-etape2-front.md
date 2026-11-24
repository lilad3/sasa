# Thèmes Akwaba — étape 2 : les 5 styles dans la vitrine (front)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** supprimer les anciens thèmes partout, puis afficher les 5 styles (Market, Kitchen, Wardrobe, Tailor, Tech) dans la vraie vitrine Next, à partir des démos validées.

**Architecture:** un dossier par style dans `frontend/src/features/storefront/themes/<style>/` (`index.tsx` + `<style>.css`, classes préfixées par le style). Les parties communes (livraison, suivi, image produit, bouton panier) restent dans `themes/parts.tsx` ; les gestes communs (FLIP, vol vers le panier) vont dans `themes/motion.ts`. Le panier et la commande restent la page commune (`storefront-app.tsx`). Les produits réels ont des photos : chaque style garde sa mise en scène mais affiche `ProductImage`, jamais les dessins SVG des démos.

**Tech Stack:** Next 16.4.2, React 19.3, Tailwind v4, TypeScript ; Django pour la donnée.

**Spec:** démos validées `scratchpad/<restauration|femme|homme|tech|general>/*.html` ; décisions du 24/11/2026 (mémoire `project-akwaba-themes-secteurs`).

## Global Constraints

- Ids : `kitchen`, `wardrobe`, `tailor`, `tech`, `market` ; packs : ceux de `backend/shops/packs.py`.
- Thème par défaut d'une boutique qui n'a rien publié : `market`, pack `general`.
- Anciens thèmes supprimés du code ; les vitrines publiées avec un ancien thème passent à `market` (migration de données).
- Téléphone d'abord (390 px), `prefers-reduced-motion` et `data-motion="none|soft"` respectés, rien qui déborde en largeur.
- Aucune vidéo ni univers ici (étapes 3 et 4) : prévoir seulement l'emplacement.
- Vérification : `npx tsc --noEmit`, `npm run lint`, `npm run build`, tests Django, puis parcours au navigateur (ajouter, panier, commande) à 390 px.

## Review Focus

- Boutique sans photo : chaque style doit rester beau (repli `ProductImage`).
- Boutique avec 1 seul produit, ou 60 produits.
- Produit en rupture : pas de bouton d'ajout actif.
- Mode congé : bandeau visible, commande fermée.
- Aperçu de l'éditeur (`preview`) : on regarde, on ne commande pas.

---

### Task 1: Supprimer les anciens thèmes (back + front)
- Back : retirer `essentiel`, `epicerie`, `beaute`, `artisanat`, `piece-phare` de `THEMES` (plus de clé `legacy`), `default_config()` → `market`/`general`, migration de données `StorefrontVersion.config.theme` ancien → `market` (pack `general`), `demo.py` et `seed_demo` mis à jour, tests adaptés (`test_design`, `test_storefront`, `test_theme_catalog`, `test_generation_api`).
- Front : supprimer `themes/artisanat|beaute|epicerie|piece-phare.tsx` et leurs règles dans `themes.css` ; `THEME_IDS` = 5 styles, `PACK_IDS`, `StorefrontDesign.pack` ; `THEME_META` des 5 styles ; `designSchema` avec `pack` ; `editor.tsx` (vignettes) ; `storefront-app.tsx` : un style pas encore porté s'affiche avec la mise en page commune.
- Vérif : tests Django verts, `tsc`, `lint`, `build`.

### Task 2: Market
### Task 3: Kitchen (avec suivi de commande en direct côté client)
### Task 4: Wardrobe
### Task 5: Tailor
### Task 6: Tech

Pour chaque style (Tasks 2 à 6) : composant `themes/<style>/index.tsx` qui reçoit `ThemeProps`, CSS du style, branché dans `THEMES` de `storefront-app.tsx` ; reprend la mise en scène de la démo (forme support, geste typographique, fond, technique maîtresse) avec les photos réelles ; vérif `tsc` + `lint` + `build` + parcours au navigateur à 390 px.
