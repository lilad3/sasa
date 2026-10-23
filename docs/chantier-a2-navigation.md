# Chantier A2 : navigation mobile (P03)

Branche : `claude/a2-navigation`, depuis `main`. **Étape 1 : contrat et maquettes seulement. Aucun code de production n'est écrit** ; l'étape 2 (le code) ne démarre qu'après validation de ce fichier, y compris des « Décisions à valider » (en fin de fichier).

Même esprit que `chantier-p5.md` : tout ce qui se décide (droits, résultats de recherche) se décide côté serveur ; le front masque, il ne protège pas.

Maquettes (pages HTML autonomes, à ouvrir dans un navigateur, largeur téléphone conseillée) :
- [`maquettes/navigation/barre-en-bas.html`](maquettes/navigation/barre-en-bas.html) : la barre en bas, propriétaire et vendeur ;
- [`maquettes/navigation/tiroir-menu.html`](maquettes/navigation/tiroir-menu.html) : le Menu en tiroir, propriétaire et vendeur ;
- [`maquettes/navigation/recherche-assistant.html`](maquettes/navigation/recherche-assistant.html) : la recherche et le panneau Assistant.

## 1. Constat (code actuel)

- `sidebar.tsx` est une seule barre : horizontale et défilante sur téléphone, colonne de 2 lames sur ordinateur. `nav-links.tsx` y construit les liens à la main, en deux groupes (« Ventes », « Boutique ») ; sur téléphone les deux groupes défilent dans la même ligne.
- Les droits viennent de `GET /me/shops` (`permissions`) ; le libellé de l'équipe vient de `lib/voice.ts` (`team`) mais `nav-links.tsx` le recalcule à part.
- Les pages qui existent sous `/app/[shop]` : accueil, `commandes` (+ fiche), `clients` (+ fiche), `produits` (+ fiche, `nouveau`, `import`), `ma-boutique`, `parametres`, `messages`, `personnel`, `securite`. **Il n'existe pas** de page Réductions, Croissance, Contenu, Analyses ni Applications (les réductions s'offrent depuis la fiche client).
- L'alerte « Activer la double authentification » et les meilleures ventes sont dans un bloc `hidden … lg:` : invisibles sur téléphone. Les meilleures ventes sont pourtant demandées au serveur (`getDashboard`) même sur téléphone.
- « Import » est une entrée de nav à part (`/produits/import`, droit `products.write`).

## 2. Une seule configuration

Un fichier, `features/dashboard/nav-config.ts`, sans JSX, qui décrit **toutes** les entrées. La barre en bas, le tiroir et la barre latérale d'ordinateur n'ont plus aucune liste à eux : ils lisent le résultat de `buildNav()`.

| Champ | Rôle |
|---|---|
| `key` | identifiant stable (`orders`, `products`…), sert aux tests et à la pastille |
| `label` | texte pour le lecteur : `(voice) => string` (« Mon personnel », « L’équipe » ou « Messages » viennent de `voice(...).team`, une seule source) |
| `icon` | clé d'`ICONS`, tracé dans le trait de `nav-links.tsx` (§6) |
| `href` | `(slug) => string` |
| `exact` | l'entrée n'est allumée que sur son adresse exacte (l'accueil) |
| `permission` | droit exigé (`dashboard.view`, `customers.view`…) ; absent = tous les rôles |
| `roles` | facultatif, restreint à des rôles (ex. Messages des vendeurs) |
| `badge` | `toProcess` (orange), `unread` (ocre) ou aucune |
| `group` | `ventes` ou `boutique` : sert seulement à la barre latérale d'ordinateur |
| `ready` | `true` si la page existe. `false` : l'entrée n'est jamais affichée |
| `bar` | position dans la barre en bas, pour chaque famille de rôle (§3) ; absent = tiroir seulement |

```ts
buildNav({ slug, role, permissions, voice, counts }) → {
  bar:     Entry[],   // barre en bas
  drawer:  Entry[],   // tiroir : entrées + Paramètres + Sécurité
  sidebar: { ventes: Entry[]; boutique: Entry[] },
  settings: Entry | null,
}
```

Une entrée est affichée si et seulement si `ready` ET le droit est présent ET le rôle convient. Un test (étape 2) vérifie que chaque entrée `ready: true` pointe vers un dossier qui contient un `page.tsx` : on ne peut pas afficher une page qui n'existe pas, et le jour où Marc crée `analyses/page.tsx`, il passe `ready` à `true` et l'entrée apparaît pour tous les rôles autorisés, sans autre changement.

### Table des entrées

| Clé | Libellé | Adresse (`/app/{slug}…`) | Droit | Pastille | `ready` | Barre (propr./gérant · vendeur) |
|---|---|---|---|---|---|---|
| `home` | Accueil | `` | `dashboard.view` | | oui | 1 · — |
| `orders` | Commandes | `/commandes` | `orders.view` | orange : à traiter | oui | 2 · 1 |
| `products` | Produits | `/produits` | `products.view` | | oui | 3 · 2 |
| `team` | Mon personnel / L’équipe / Messages | `/personnel` (propriétaire, gérant), `/messages` (vendeur) | `team.view` | ocre : non lus | oui | — · 3 (Messages) |
| `customers` | Clients | `/clients` | `customers.view` | | oui | tiroir |
| `discounts` | Réductions | `/reductions` | `discounts.give` | | **non** | tiroir |
| `growth` | Croissance | `/croissance` | `dashboard.view` | | **non** | tiroir |
| `content` | Contenu | `/contenu` | `storefront.edit` | | **non** | tiroir |
| `analytics` | Analyses | `/analyses` | `dashboard.view` | | **non** | tiroir |
| `storefront` | Ma boutique (+ lien « Voir ma vitrine ») | `/ma-boutique` ; vitrine : `/boutique/{slug}` | `storefront.edit` | | oui | tiroir |
| `apps` | Applications | `/applications` | `shop.manage` | | **non** | tiroir |
| `security` | Sécurité | `/securite` | tous | ocre : double authentification absente | oui | tiroir (en dernier) |
| `settings` | Paramètres (« La vitrine » si seul `storefront.edit`, comme aujourd'hui) | `/parametres` | `shop.manage` ou `storefront.edit` | | oui | tiroir, bouton à part |

Les adresses et droits des cinq pages absentes sont **proposés** : à confirmer avec l'auteur de chaque page (décision 1). `products/import` ne figure plus dans la table : c'est un bouton (§5).

Ordre dans le tiroir : Accueil, Commandes, Produits, Clients, Réductions, Croissance, Contenu, Analyses, Ma boutique, Applications, personnel/équipe/Messages, Sécurité. Aujourd'hui, un propriétaire voit donc : Accueil, Commandes, Produits, Clients, Ma boutique, Mon personnel, Sécurité, puis Paramètres.

## 3. Barre en bas (téléphone)

Visible sous 1024 px (`lg`). Au-dessus : la barre latérale. La barre est **fixe**, posée sur `env(safe-area-inset-bottom)`, et le contenu reçoit un `padding-bottom` égal à sa hauteur : rien n'est jamais caché dessous.

| Rôle | De gauche à droite |
|---|---|
| Propriétaire, gérant | bouton rond **Rechercher** · pilule **Accueil · Commandes · Produits · Menu** · bouton rond **Assistant** |
| Vendeur | pilule **Commandes · Produits · Messages · Menu**, sans bouton rond de recherche ni d'assistant (le vendeur n'a pas de recherche de clients, et l'espace reste lisible ; voir décision 4) |

- Une entrée dont le droit manque disparaît et les autres se partagent la pilule (un gérant sans `products.view` n'est pas prévu, mais le cas est géré).
- **Pastilles.** Commandes : nombre à traiter (en attente + confirmées + expédiées, comme aujourd'hui), orange, « 99+ » au-delà. Messages (vendeur) : non lus, ocre. Pour les autres rôles, les messages sont dans le tiroir : le bouton **Menu** porte alors un point ocre (sans chiffre) s'il y a des non lus ou si l'alerte de sécurité (§4) est active.
- **Entrée active : la braise orange existante** (point de 5 px, lueur orange) devant l'icône, avec le fond `white/10` de `nav-links.tsx`. Elle glisse d'une entrée à l'autre comme aujourd'hui, sauf si `prefers-reduced-motion`. **Menu** est allumé quand la page courante est une entrée du tiroir qui n'est pas dans la barre (Clients, Sécurité…).
- Cibles tactiles : 48 px de haut au moins pour les entrées, 48 px de diamètre pour les boutons ronds. Texte des libellés : 11 px au minimum, sous l'icône.
- Matière : nuit pleine (`nuit` à environ 94 %), trait `trait`, **pas de verre cannelé ni de lames sur téléphone**. Les boutons ronds sont des « bouton-nuit » (verre sombre, lueur indigo). Aucun dégradé violet-bleu.
- Accessibilité : `<nav aria-label="Navigation principale">`, `aria-current="page"` sur l'entrée active, pastilles lues par le lecteur d'écran (« 3 à traiter », « 2 non lus »), focus visible orange clair (jamais bleu).

## 4. Alerte de sécurité

Aujourd'hui, « Activer la double authentification » n'existe que dans le bloc de la barre latérale d'ordinateur. Sur téléphone :
- quand `me.mfa_enabled` est faux, une **bande ocre** (texte `encre`, icône cadenas) s'affiche en haut de la page, sous l'en-tête, pour tous les rôles : « Protégez votre compte : activez la double authentification. » avec le lien vers `/securite`. Elle n'est pas masquable : elle disparaît quand la double authentification est active ;
- le même signal pose un point ocre sur **Menu** et une pastille ocre sur l'entrée **Sécurité** du tiroir ;
- le message est identique pour tous les rôles et neutre sur le genre (« Protégez votre compte »).

## 5. Import, meilleures ventes, en-tête mobile

- **Import** n'est plus une entrée de navigation. C'est un bouton **« Importer »** dans l'en-tête de `/produits`, à côté de « Nouveau produit », visible avec `products.write` (le contrôle de plan reste celui de la page d'import). La page `/produits/import` garde son adresse ; sur elle, **Produits** reste allumé (préfixe).
- **Meilleures ventes** : retirées de tout ce qui est mobile. Elles restent dans la barre latérale d'ordinateur (inchangé). Étape 2 : le composant n'est plus monté sous `lg`, pour que le serveur ne demande plus le résumé 30 jours pour rien sur téléphone (décision 7).
- **En-tête mobile.** La barre horizontale actuelle disparaît sous `lg`. À la place, un en-tête simple, non collant : logo et nom de la boutique. Les liens vers Paramètres, boutiques et déconnexion vivent dans le tiroir.

## 6. Tiroir « Menu » (par le bas)

Ouvert par **Menu**. Une feuille qui monte du bas, 85 % de la hauteur au plus, qui défile à l'intérieur ; fond nuit, bord supérieur arrondi, poignée de glissement. Fermeture : bouton Fermer, toucher à côté, geste vers le bas, touche Échap, ou changement de page.

De haut en bas :
1. **Alerte de sécurité** (ocre), si la double authentification est absente ;
2. **les entrées** de `drawer`, dans l'ordre de §2, une par ligne (icône, libellé, pastille à droite). **Ma boutique** porte dessous un lien secondaire **« Voir ma vitrine »** (nouvel onglet) ;
3. le bouton **Paramètres**, à part (le plus large, `bouton-nuit`), visible avec `shop.manage` ou `storefront.edit` ;
4. tout en bas, deux actions discrètes : **Changer de boutique** (liste des boutiques du compte, visible seulement si le compte en a plus d'une ; sinon l'action est absente) et **Se déconnecter** (la Server Action `logout` existante).

Accessibilité : `role="dialog"` `aria-modal`, titre « Menu », le focus entre dans le tiroir et revient sur le bouton **Menu** à la fermeture, le reste de la page est `inert`, le défilement de la page est bloqué pendant l'ouverture. Animation d'ouverture courte, supprimée avec `prefers-reduced-motion`.

### Icônes (nouvelles, dans le trait de `nav-links.tsx`)

Grille 24×24, trait 1,7 px, extrémités et jonctions arrondies, `fill="none"`, pas de remplissage, pas d'emoji. Existantes réutilisées : `orders`, `products`, `customers`, `staff`, `notes`, `storefront`, `settings`, `security`. À ajouter à `ICONS` :

| Clé | Tracé |
|---|---|
| `home` | `M4 11 12 4l8 7M6 9.5V20h12V9.5M10 20v-5h4v5` |
| `search` | `M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM15.5 15.5 20 20` |
| `assistant` | `M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8zM18.5 16.5v3.5M16.75 18.25h3.5` |
| `menu` | `M4 7h16M4 12h16M4 17h10` |
| `discounts` | `M3.5 12.5V4.5h8l9 9-8 8zM8 8.5h.01` |
| `growth` | `M4 19h16M5 15l4.5-4.5 3.5 3L19 7M15 7h4v4` |
| `content` | `M5 4h10l4 4v12H5zM14.5 4v4.5H19M8.5 12.5h7M8.5 16h5` |
| `analytics` | `M5 20v-8M10 20V6M15 20v-9M20 20V9` |
| `apps` | `M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM17 14v6M14 17h6` |
| `switch` | `M5 8h13M14.5 4.5 18 8l-3.5 3.5M19 16H6M9.5 12.5 6 16l3.5 3.5` |
| `close` | `M6 6l12 12M18 6 6 18` |
| `logout` | tracé déjà dans `sidebar.tsx`, déplacé dans `ICONS` |

## 7. Recherche (en bas de l'écran) et Assistant

### 7.1 Recherche

Le bouton rond **Rechercher** ouvre une feuille par le bas (même matière que le tiroir) avec un champ en haut (`type="search"`, `enterkeyhint="search"`, focus automatique), puis les résultats groupés : **Commandes**, **Produits**, **Clients**, 5 au plus par groupe. Un résultat est un lien vers la fiche. Sans frappe : une phrase d'aide (« Cherchez une commande, un produit ou un client »). Moins de 2 caractères : rien n'est demandé. Pas de résultat : « Rien ne correspond à “…” ». Erreur ou limite atteinte (429) : message calme avec le délai.

Côté front : appel depuis le navigateur vers le BFF Next (**jamais** vers Django), une route interne `app/api/search` qui relaie avec la session. Attente de 250 ms après la dernière frappe, requête précédente annulée (`AbortController`), résultats gardés tant qu'une nouvelle recherche est en cours.

### 7.2 Route demandée à Koffi

`GET /api/v1/shops/{slug}/search?q=` (dans la section 4.3 du contrat d'API, vue `ShopScopedView`, donc `.for_shop()` partout).

| Règle | Détail |
|---|---|
| Accès | membre de la boutique, sinon **404** (comme le reste) |
| Droits **par groupe**, jamais globaux | `orders` si `orders.view` ; `products` si `products.view` ; `customers` si `customers.view`. Un groupe interdit est **absent** de la réponse (pas vide) ; un membre sans aucun des trois droits reçoit **403** `permission_denied` |
| `q` | `plain_text`, espaces de bord retirés, **2 à 60 caractères** après nettoyage, sinon **400** (`validation_error`, problem+json existant). Les caractères joker de la base (`%`, `_`) sont échappés. Aucune expression régulière fournie par l'appelant |
| Résultats | **5 par groupe** au plus, tri fixe, pas de pagination |
| Limite de débit | `core.ratelimit.enforce` : **30 / min par membre** (`search:user`) et **300 / h par boutique** (`search:shop`), 429 `too_many_requests` avec `retry_after` |
| Journal | lecture seule : pas de `record()`. Le texte cherché n'est **ni journalisé ni mis en cache** (il peut contenir un nom ou un numéro) |
| Visibilité | un résultat ne montre jamais plus que la liste correspondante : le téléphone d'un client suit les règles de `GET customers` (masqué comme aujourd'hui) ; un vendeur ne voit pas les clients |

Ce qui est cherché (sans accent ni casse ; `contains` sauf mention) :
- **commandes** : début de la référence, nom du client, 4 derniers chiffres du téléphone (4 chiffres exacts, jamais un numéro partiel plus court) ;
- **produits** : nom, SKU s'il existe ;
- **clients** : nom, 4 derniers chiffres du téléphone.

Réponse 200 :

```json
{
  "orders": [
    { "id": "…", "reference": "AKW-7K2Q9", "customer_name": "Ayaba Koné",
      "status": "pending", "total": 18500, "created_at": "…" }
  ],
  "products": [
    { "id": "…", "name": "Pagne wax bleu", "price": 6500, "stock": 12, "image_url": "…" }
  ],
  "customers": [
    { "id": "…", "name": "Ayaba Koné", "phone_masked": "07 •• •• 42 18", "orders_count": 4 }
  ]
}
```

Les champs reprennent ceux des listes existantes (mêmes noms, mêmes statuts). Tests demandés : non-membre 404 ; vendeur sans groupe `customers` ; gérant sans `products.view` retiré par un cas de test d'API ; `q` de 1 et 61 caractères refusés ; `%` et `_` traités comme du texte ; limite au 31ᵉ appel ; isolation entre boutiques (un client d'une autre boutique n'apparaît jamais).

### 7.3 Assistant

Le bouton rond **Assistant** ouvre un panneau (même feuille) avec un titre « Assistant », la mention **« Bientôt disponible »** et deux lignes d'explication (« Posez vos questions sur vos ventes, en français. Pas encore ouvert. »). Le champ de saisie est présent mais **désactivé**. **Aucun appel d'IA, aucun appel réseau** : le panneau est du texte. Le bouton est un vrai bouton (pas un lien), `aria-haspopup="dialog"`.

## 8. Application installable

Le front ne sert aujourd'hui ni manifeste ni service worker. L'installation sur l'écran d'accueil est utile (la barre en bas lui va bien) mais un service worker qui garde en cache des pages ou des réponses de l'API **stockerait des données marchandes** (chiffre d'affaires, clients, numéros) sur l'appareil, parfois partagé (voir le mode appareil partagé, §2.11). Voir décision 6.

## 9. Visuel et textes

- Palette du README : `nuit`, lumière `orange`, `indigo`, `ocre`, `corail`, texte `texte`/`creme`. **Pas de vert, pas de blanc pur** (le plus clair est `texte` `#f6f0e7`). Pastille Commandes en `orange/20` sur `orange-clair`, pastille Messages et alertes en `ocre` + texte `encre`.
- Police du projet (Archivo). Interdits : dégradé violet-bleu, Inter, Poppins, Geist, anneau de focus bleu, carrousel qui défile seul.
- Textes en français courant, au registre du rôle de la personne qui lit (via `voice()`), neutres sur le genre : « Mon personnel » pour le propriétaire, « L’équipe » pour un gérant, « Messages » pour un vendeur.
- Pas d'emoji. Icônes SVG seulement.

## 10. Découpage de l'étape 2 (après validation)

1. `nav-config.ts` + `buildNav()` + tests (matrice des rôles ; `ready` ↔ `page.tsx` existant ; ordre) ;
2. barre latérale d'ordinateur qui lit `buildNav()` (rendu identique à aujourd'hui, moins « Import ») ;
3. barre en bas et tiroir, bande de sécurité, en-tête mobile ;
4. bouton « Importer » dans Produits ;
5. Assistant (panneau statique) ;
6. recherche : d'abord la route Django (Koffi), puis le front ;
7. (selon décision 6) manifeste.

Vérifications par étape : `npm run lint`, `npm run build`, essai à la main sur 360 px, 390 px, 768 px et 1280 px, avec un compte de chaque rôle (propriétaire, gérant, vendeur) et un clavier seul.

## Décisions à valider

1. **Pages qui n'existent pas (Réductions, Croissance, Contenu, Analyses, Applications).** *Recommandation :* `ready: false`, donc masquées partout tant que la page n'existe pas ; l'entrée apparaît d'elle-même quand la page est créée. Droits et adresses du §2 à confirmer. En attendant, les réductions restent offertes depuis la fiche client.
2. **Barre du vendeur sans Accueil.** Le vendeur n'a pas `dashboard.view` : sa page d'accueil est déjà la liste des commandes. *Recommandation :* sa barre est Commandes · Produits · Messages · Menu, et le logo de l'en-tête mène à Commandes.
3. **Menu allumé sur les pages du tiroir** (Clients, Sécurité, Ma boutique…) avec la braise. *Recommandation :* oui, pour toujours savoir où l'on est.
4. **Vendeur sans Rechercher ni Assistant.** Le vendeur n'a pas de droit sur les clients et peu de produits à chercher ; la recherche serait presque vide pour lui. *Recommandation :* pas de boutons ronds pour le vendeur au départ ; on pourra ouvrir la recherche aux seules commandes et aux produits ensuite (la route le permet déjà par groupe).
5. **Bande de sécurité non masquable.** *Recommandation :* non masquable (c'est un risque de compte), mais d'une seule ligne pour ne pas gêner la lecture.
6. **Application installable.** *Recommandation :* un **manifeste** (nom, icônes, `display: standalone`, couleur nuit) **sans service worker du tout** au départ : on gagne l'icône sur l'écran d'accueil, on ne met aucune donnée marchande en cache. Si l'on veut plus tard une page « Pas de connexion », un service worker qui sert **uniquement** une page fixe, sans jamais mettre en cache de réponse de `/app` ni de l'API. À tester sur Android et iPhone : sur certains navigateurs l'invite d'installation automatique demande un service worker ; le repli est « Ajouter à l'écran d'accueil » dans le menu du navigateur.
7. **Meilleures ventes.** *Recommandation :* les garder sur ordinateur, ne plus les monter sous `lg` (économie d'un appel serveur par page sur téléphone).
8. **Barre latérale d'ordinateur.** Avec les nouvelles entrées, deux groupes restent possibles. *Recommandation :* conserver le sélecteur « Ventes / Boutique ». Ventes : Accueil, Commandes, Clients, Réductions, Croissance, Analyses, personnel/équipe/Messages. Boutique : Produits, Ma boutique, Contenu, Applications. Paramètres et Sécurité en bas, comme aujourd'hui. Le champ `group` de la configuration porte ce choix.
9. **Limites de la recherche** (30 / min par membre, 300 / h par boutique, 5 résultats par groupe, 2 à 60 caractères). *Recommandation :* les valeurs de §7.2, à ajuster avec Koffi selon le coût des requêtes.
10. **Téléphone dans la recherche.** *Recommandation :* seulement les 4 derniers chiffres exacts, pour que la recherche ne serve pas à retrouver un client à partir d'un numéro partiel.
