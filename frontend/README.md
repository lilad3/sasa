# Akwaba — front (Next.js)

Le site public et l'espace marchand d'Akwaba. Le navigateur ne parle jamais à Django : les Server Components et les Server Actions de Next appellent l'API de serveur à serveur (voir [`../docs/contrat-api.md`](../docs/contrat-api.md), §1).

## Lancer en local

Prérequis : Node 20 ou plus, et le backend lancé sur `http://127.0.0.1:8000` (voir [`../backend/README.md`](../backend/README.md)).

```bash
cd frontend
npm install
cp .env.example .env.local   # BFF_SHARED_SECRET = la même valeur que dans backend/.env
npm run dev                  # http://localhost:3000
```

Avant de pousser : `npm run lint` et `npm run build` (le build vérifie aussi les types).

> **Piège connu.** Après une modification des couleurs dans `src/app/globals.css` (bloc `@theme`), relancez `npm run dev` : avec la règle Turbopack du projet, le serveur de développement ne recharge pas les nouveaux jetons. Si un ancien CSS persiste, supprimez le dossier `.next`.

## Les pages

| Adresse | Pour qui | Contenu |
|---|---|---|
| `/` | Visiteurs, futurs marchands, partenaires | Landing : animation d'ouverture, fonctionnalités, sécurité, partenaires et API, tarifs, FAQ |
| `/boutique/[slug]` | Les clients d'une boutique, sans compte | Vitrine, panier, commande (exemple : `/boutique/maison-adjoua`) |
| `/connexion`, `/inscription`, `/mot-de-passe-oublie`… | Marchands | Authentification (2FA, appareil partagé, déverrouillage) |
| `/app/[shop]` | Marchands connectés | Dashboard des ventes et commandes, selon le rôle |

## Organisation du code

```
src/
  app/                 routes (une page = un dossier)
  features/
    landing/           landing : intro.tsx (WebGL), sections.tsx, pricing.tsx
    storefront/        vitrine publique : couverture, catalogue, panier, commande
    auth/              formulaires et Server Actions d'authentification
    dashboard/         espace marchand
  components/ui/       boutons, champs, logo
  lib/server/          client de l'API Django, cookies, session (jamais envoyé au navigateur)
scripts/
  generer-decor.py     génère public/decor.jpg (le verre cannelé du décor)
```

Les CSS Modules ne fonctionnent pas avec la configuration actuelle (`next.config.ts` envoie tous les `*.css` au chargeur Tailwind). Les styles qui ne s'écrivent pas bien en classes Tailwind vont dans un fichier CSS global, avec des classes préfixées (`intro-…`, `vit-…`).

## La palette

Chaque couleur a un rôle, pour qu'aucune ne recouvre tout (jetons dans `src/app/globals.css`) :

| Jeton | Rôle |
|---|---|
| `nuit`, `nuit-2` | Fonds sombres (espace marchand, sections sombres) |
| `creme`, `creme-2` | Fonds clairs (landing, vitrine) |
| `orange` | L'action principale : boutons, lien actif. Toujours avec un texte `encre` |
| `indigo` | L'information : statuts, liens secondaires, séries de graphiques |
| `ocre` | La mise en avant et les alertes. Toujours avec un texte `encre` |
| `vert` | Uniquement ce qui monte ou réussit (hausse, livré, mot de passe solide) |
| `corail` | Les erreurs |
| `lagune` | Une couleur de plus pour distinguer des séries |

Le décor (`public/decor.jpg`) se régénère avec `python scripts/generer-decor.py public/decor.jpg` (numpy et Pillow). Copiez-le aussi dans `backend/static/akwaba_admin/decor.jpg` pour l'admin Django.
