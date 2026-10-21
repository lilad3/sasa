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
| `/app/[shop]` | Marchands connectés | Dashboard des ventes : à traiter, chiffre d'affaires, suivi, paiements, lieux, heures, clients (propriétaire et gérant) |
| `/app/[shop]/commandes` | Tous les rôles | Liste filtrable par statut, recherche ; `/commandes/[id]` : fiche et traitement de la commande |
| `/app/[shop]/securite` | Tous les rôles | Double authentification, mot de passe, appareils connectés, journal de sécurité |
| `/app/[shop]/messages` | Tous les rôles | Le mot du patron : le propriétaire et les gérants écrivent à l'équipe, chacun confirme « C'est noté » |
| `/premiere-connexion` | Comptes créés par un patron | Remplacer le mot de passe provisoire avant d'entrer |

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
| `orange` | La lumière des pages claires (fond animé, voir plus bas), le logo, le graphique des ventes |
| `indigo` | La lueur des boutons, l'information : statuts, liens secondaires, séries de graphiques |
| `ocre` | La mise en avant et les alertes. Toujours avec un texte `encre` |
| `vert` | Uniquement ce qui monte ou réussit (hausse, livré, mot de passe solide) |
| `corail` | Les erreurs |
| `lagune` | Une couleur de plus pour distinguer des séries |
| `creme`, `sable` | Le texte sur fond sombre |

**Il n'y a plus de blanc.** Les pages claires (landing, vitrine) sont posées sur une lumière orange qui bouge en permanence, et les boutons sont en verre cannelé sombre.

| Classe | Où | Ce qu'elle fait |
|---|---|---|
| `<FondOrange />` | `components/ui/fond-orange.tsx` | Lumière orange fixée derrière la page (dégradé, lueurs, traînée brune, grain). Seules des transformations sont animées : fluide même sur un petit téléphone |
| `surface-orange` | Sections claires | Section transparente sur la lumière orange ; le texte secondaire fonce pour rester lisible |
| `verre-clair` | Cartes, champs, panier | Vitre pêche translucide, à la place des cartes blanches |
| `bouton-nuit` | Tous les boutons principaux | Verre cannelé sombre, lueur indigo qui glisse. `--decalage` désynchronise les boutons d'une même grille |
| `bouton-verre` | Boutons secondaires sur l'orange | Vitre pêche bordée d'encre |
| `zone-sombre` | Bloc sombre posé sur l'orange | Remet l'anneau de focus en clair |
| `curseur`, `radio-verre` | Curseur des tarifs, choix du paiement | Contrôles dessinés à la main (les versions natives sont blanches) |

Contraste vérifié (WCAG, 4,5:1 pour le texte) : le dégradé orange ne descend pas sous `#DA8748` et la traînée brune ne dépasse pas 33 % d'opacité, ce qui garde le texte encre au-dessus de 4,8:1. Le texte posé directement sur l'orange reste en `encre` ; le texte secondaire n'apparaît que dans les vitres.

Le décor (`public/decor.jpg`) se régénère avec `python scripts/generer-decor.py public/decor.jpg` (numpy et Pillow). Copiez-le aussi dans `backend/static/akwaba_admin/decor.jpg` pour l'admin Django.
