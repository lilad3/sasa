# Chantier A2 · Essentiel amélioré : la photo d'abord (P16)

Base : `main` (`461d6fa`). Branche `claude/a2-essentiel` (Marc). Prompt : `akwaba-2.0/prompts/P16-essentiel-ameliore.md` (hors dépôt). Ce fichier est le contrat. **Étape 1 : un prototype à faire valider par l'utilisateur.** Rien n'est changé dans Essentiel ni dans les autres thèmes avant son feu vert.

| Partie | Qui | État |
|---|---|---|
| Prototype des écrans E1 à E10 (`/prototype/essentiel`) | Marc | **à valider** (captures §2) |
| Données utiles côté Django (§5) | Koffi | proposé, à valider |
| Réalisation dans Essentiel, puis suppression du prototype | Marc | après le feu vert |

---

## 1. Constat

- La photo est une fenêtre de 200 px de haut, avec l'étiquette du rayon posée dessus. Le prix fait 26 px. La pilule « Ajouter », puis « − 1 + », s'affiche sous chaque produit.
- Seule la première photo est montrée.
- Un produit sans photo affiche un dégradé avec une grosse initiale.
- Il n'y a pas de page produit côté Next, alors que Django a déjà `GET storefront/{slug}/products/{product_slug}` (`StorefrontProductDetailView`, qui renvoie 404 pour un produit inactif ou d'une autre boutique).

## 2. Le prototype

Il s'agit d'une route de test reliée à rien, avec une boutique de démonstration écrite en dur (`features/prototype-essentiel/data.ts`) : pas de Django, pas de vrai panier. Elle utilise les vraies pièces de la vitrine (`FondOrange`, `bouton-nuit`, `verre-clair`, Archivo étendu, le panier latéral et la barre mobile existants), sans les modifier.

| Adresse | Écran |
|---|---|
| `/prototype/essentiel` | couverture (E8, E9), onglets (E10), les deux affichages (E5), cartes (E1 à E4), fiches sans photo (E7) |
| `/prototype/essentiel/produit` | page produit (E6), sur « Ensemble wax Feuillage » |

**Lancer le prototype.** Les photos de démonstration ne sont pas versionnées : `public/prototype-essentiel/` est dans `.gitignore`, parce que ces images viennent du web et que le dépôt peut devenir public. Pour les remettre, copiez 11 images de `photos pour démo` sous ces noms : `feuillage-1..3`, `fleurs-1..2`, `lot-1..2`, `bogolan-1..2`, `kita-1`, `baoule-1` (`.jpg`). Le choix exact est dans le rapport de Marc. Ensuite, lancez `npm run dev` et ouvrez `/prototype/essentiel`.

**Captures** (hors dépôt, pour la même raison) : `akwaba-2.0/captures/p16/`.

| Fichier | Ce qu'on y voit |
|---|---|
| `375-01-couverture`, `414-01-couverture` | E9 en plein écran, nom de la boutique, ligne E8, produit à la une |
| `375-02-grille`, `414-02-grille` | E10 collé en haut, grille 2 colonnes, une carte au panier (contour orange, quantité 2), barres de statut |
| `375-03-grille-sans-photo`, `414-03-…` | E7 : « Beurre de karité brut » et « Café robusta » en fiche typographique, produit épuisé |
| `375-04-fil`, `414-04-fil` | E5 : un produit par écran |
| `375-05-page-produit`, `414-05-…` | E6 : photo 2 sur 3, quantité, partage, ligne de livraison |
| `1280-01-vitrine`, `1280-02-fil`, `1280-03-page-produit` | les mêmes écrans sur ordinateur, avec le panier latéral |

## 3. Les écrans

### E1 · La photo au format 4:5, sur presque toute la carte
- La carte n'a plus de vitre : le verre reste aux boutons et au panier. Elle se compose de la photo 4:5 (rayon 18 px, 24 px en grand), puis du nom (2 lignes au plus), puis d'une seule note de stock quand elle compte (« Plus que 2 pièces », « Épuisé »).
- Rien n'est posé sur la photo, sauf la bande du prix (E3) et le bouton d'ajout (E4). L'étiquette du rayon disparaît : les onglets (E10) la remplacent.

### E2 · Feuilleter comme un statut WhatsApp
- Fines barres en haut : la photo vue et la courante en crème, les suivantes à 36 %. Un léger voile sombre de 56 px garde les barres lisibles sur une photo claire.
- Deux zones à toucher : le tiers gauche pour la photo précédente, les deux tiers droits pour la suivante. Il n'y a pas de boucle : à la dernière photo, la zone droite ne fait plus rien. Pas de défilement automatique.
- Clavier : la galerie prend le focus (anneau crème), et les flèches gauche et droite feuillettent. Lecteur d'écran : deux boutons, « Photo précédente » et « Photo suivante », et une annonce « Photo 2 sur 3 ». Le texte alternatif est « Nom du produit, photo 2 sur 3 ».
- Changement de photo : un fondu de 180 ms, coupé par `prefers-reduced-motion` et `data-motion="none"`.

### E3 · Le prix discret, en bas de la photo
- Bande nuit à 84 %, 36 px de haut (44 px en grand). Le prix est en chiffres nets, crème, en 15 px (18 px en grand), avec un « F » en sable plus petit. Contraste du crème sur la bande : plus de 15:1.
- Le prix barré de P07 se placera dans la même bande, à gauche du prix.
- `Price` (dans `catalogue.tsx`) n'est **pas** modifié : la commande de tous les thèmes l'utilise. La bande a son propre composant.

### E4 · Ajouter d'un toucher sur la photo
- Bouton rond `bouton-nuit` de 44 px (52 px en grand) dans le coin bas-droit. Il chevauche la bande du prix.
- Au panier, la photo prend un contour de lumière orange (bordure de 3 px, lueur intérieure et extérieure), et le bouton affiche la quantité. Toucher de nouveau en ajoute un, jusqu'au stock. On retire ou on règle la quantité dans le panier, ou sur la page produit.
- Libellé : « Ajouter Pagne… au panier », puis « Pagne… : 2 dans le panier. En ajouter un ».
- Il n'y a plus de pilule « Ajouter » ni de « − 1 + » sous les cartes.

### E5 · Deux affichages au choix
- Les icônes « grille » et « un par écran » sont dessinées pour Akwaba, au bout de la ligne d'onglets.
- **Grille** : 2 colonnes sur téléphone, 3 sur ordinateur (à côté du panier).
- **Un produit par écran** : photo pleine largeur (540 px au plus), nom en Archivo étendu, 3 lignes de description. On défile comme un fil, sans aimantation.
- Le choix est retenu sur l'appareil (`localStorage`, clé `akwaba:vitrine:affichage`, lu dans un `try/catch`). Sans stockage, le choix vaut pour la visite. La lecture passe par `useSyncExternalStore`, ce qui évite un écart entre le rendu serveur et le navigateur.

### E6 · Chaque produit a sa page et son lien
- Adresse : `/boutique/{slug}/produits/{produit}`.
- Contenu :
  - toutes les photos en grand, avec le même feuilletage ;
  - rayon et nombre de photos, puis le nom en Archivo étendu ;
  - le prix en 28 px et le bouton « Partager » ;
  - la description ;
  - la quantité, puis « Ajouter au panier · 24 000 F » ;
  - les lignes de livraison et de paiement (E8).
- **Quantité** : 5 pastilles rondes (1 à 5, au plus le stock) au lieu de « − 1 + ». Au-delà, on règle dans le panier (décision 5).
- **Partager** : le partage natif du téléphone (`navigator.share`). Sinon, le lien est copié et la page affiche « Lien copié : collez-le dans WhatsApp. », sans toast.
- **Zoom à deux doigts** (étape 2) : un geste à deux doigts sur la photo (de 1 à 3 fois), avec déplacement, remis à zéro au changement de photo. Pendant le zoom, les zones de feuilletage sont suspendues. Le zoom du navigateur reste permis (`user-scalable` jamais bloqué).
- **Open Graph** (étape 2, `generateMetadata`) : `og:title` = nom, `og:description` = « 24 000 F · Maison Adjoua », `og:image` = la photo principale (adresse absolue, décision 4), `og:type` = `product`, plus `product:price:amount` et `product:price:currency` = `XOF`.
- Produit inactif, inconnu ou d'une autre boutique : Django répond 404, et Next affiche `notFound()`, la même page que pour une boutique inconnue.
- Sur ordinateur, deux colonnes : la photo à gauche (540 px, collée en haut au défilement), le texte à droite. Pas d'accordéons, pas de rangée de vignettes.

### E7 · Sans photo, une fiche typographique
- Fond nuit uni, avec des cannelures à 2,5 % qui rappellent le verre d'Akwaba. On y voit le rayon en mono sable, un filet de 3 px de la couleur de la boutique (avec sa lueur), et le nom du produit en grand (Archivo étendu 800, taille selon la largeur de la carte).
- Même bande de prix et même bouton d'ajout que les autres cartes.
- Le panier latéral et la couverture utiliseront la même fiche en petit, à la place de `ProductArt` (dégradé et initiale).
- Espace marchand : la page Produits affiche une ligne discrète en ocre, par exemple « 3 produits sans photo : les clients voient seulement leur nom », avec un lien vers la liste filtrée (décision 6).

### E8 · Un en-tête qui informe
- Sous le nom de la boutique, une ligne construite à partir des données (`info-line.ts`, réutilisé à l'étape 2). Exemple : « Livré en 24 h à Cocody, Plateau et 4 autres communes · livraison dès 1 000 F · Wave, Orange Money ou paiement à la livraison ».
  - Le délai et les communes viennent des zones les plus rapides (`delay_hours`).
  - Le prix vient de la zone la moins chère.
  - Les moyens de paiement viennent de la boutique.
- Si une donnée manque, son morceau disparaît. Rien n'est inventé : il n'y a pas de slogan, et pas de « avant 17 h » tant que cette heure n'existe pas en base (décision 2).
- La même ligne se retrouve sur la page produit, découpée en trois lignes.

### E9 · La couverture avec la vraie photo
- **Téléphone** : plein écran (`100svh`, 560 px au moins), sous la barre de la boutique.
  - La photo principale du produit à la une est nette, sans mélange de couleurs.
  - Un voile nuit en haut et en bas garde le texte lisible.
  - Le nom de la boutique s'affiche en très grand en haut, suivi de la ligne E8.
  - En bas : « À la une », le nom du produit, le prix, « Ajouter au panier » et le lien « Voir la pièce ».
- **Ordinateur** : la vitre arrondie de 620 px. La photo garde son format portrait à droite (48 %, fondue à gauche), et le nom de la boutique passe en partie dessus, comme une couverture de magazine.
- On garde l'arrivée des mots du titre (`vit-word`) et le fondu des lignes (`vit-fade`), coupés par `prefers-reduced-motion`.
- Le macaron tournant et le panneau des trois chiffres disparaissent : la ligne E8 dit la même chose, en vrai.
- Sans produit à la une (aucun en stock) : la couverture garde le décor en verre cannelé, comme aujourd'hui.

### E10 · Les rayons en onglets de texte
- Une ligne collée sous la barre de la boutique (`top: 72px`) : « Tout 8 · Ensembles 1 · Pagnes 5 · Épicerie 2 ». L'onglet actif est en encre, souligné de 3 px d'orange lumineux, et la ligne défile horizontalement si elle déborde.
- Le fond est une bande pêche translucide floutée, nécessaire pour rester lisible au-dessus des photos qui défilent.
- Les collections de P09 remplaceront les rayons s'il est fusionné avant l'étape 2.
- Le tri (« Prix ↑ / ↓ ») disparaît de la vitrine Essentiel. C'est un choix de simplicité, à confirmer (décision 8).

## 4. Ce qui ne change pas

- Le panier latéral, la barre mobile, la commande, le suivi, le mode congé, le canal `?via=`, l'aperçu de « Ma boutique » (`preview`) et les sections choisies par le marchand (livraison, plus demandés, histoire, suivi).
- Les autres thèmes (`features/storefront/themes/`) : aucun fichier n'est touché. Ils n'importent de `catalogue.tsx` que le type `Line`. `checkout.tsx` (commun) importe `Price`, qui ne change pas.

## 5. Données et routes (Koffi)

Une seule route nouvelle côté Next (la page produit). Côté Django, c'est la route existante, avec ces compléments proposés :

| # | Besoin | Proposition | Pourquoi |
|---|---|---|---|
| a | Des images à la bonne taille (3G) | La photo est stockée aussi en 600 px, en plus de 1 200 px. Elle est servie par `storefront/{slug}/photos/{id}?taille=600` (liste fermée : 600 ou 1200), et la vitrine utilise `srcset` | Une grille de 8 cartes charge aujourd'hui 8 images de 1 200 px |
| b | L'image de l'aperçu WhatsApp | La même route avec `?format=jpeg&taille=600` (JPEG, moins de 300 Ko), utilisée seulement dans `og:image` | WhatsApp n'affiche pas toujours un WebP ni une grande image (à vérifier par un vrai essai à l'étape 2) |
| c | E7 dans l'espace marchand | `without_photo` dans `GET shops/{slug}/products/overview` | La liste est paginée : le front ne peut pas compter seul |
| d | L'heure limite de E8 | Rien maintenant. Plus tard, une heure limite par zone (P05) | Pas de donnée, pas de phrase |

Pas de migration pour a et b si les tailles sont calculées à l'envoi d'une photo et stockées à côté de l'original (`ProductPhoto`). Sinon, une migration `shops`, à préciser par Koffi.

`next/image` n'est pas retenu. Sa configuration `localPatterns` exige une valeur exacte pour les paramètres (`search`), alors que nos photos portent un `?v=` qui change avec chaque image. Laisser `search` vide ouvrirait l'optimiseur à n'importe quelle adresse (doc Next 16). On garde donc `<img>` avec `srcset`, `sizes`, `width`, `height`, `loading="lazy"` hors écran et `decoding="async"`.

## 6. Sécurité (pour la revue d'Alice)

- **Page produit** : le slug de la boutique et celui du produit sont validés (`^[a-z0-9-]{1,80}$`) avant l'appel à l'API. Le 404 de Django devient `notFound()`. Rien ne distingue un produit « inactif », « inconnu » ou « d'une autre boutique ».
- **Open Graph** : seulement des données déjà publiques (nom, prix, photo principale, nom de la boutique). Aucune donnée de stock précise.
- **`localStorage`** : seulement le choix d'affichage. Aucun panier ni aucune donnée personnelle de plus qu'aujourd'hui.
- **Partage** : l'adresse de la page, sans paramètre (le `?via=` n'est pas recopié).
- **Limite de débit de la route détail** : à vérifier. Elle doit être la même que celle de la liste des produits.
- **Aucun HTML** : la description reste du texte rendu par React.

## 7. Fichiers touchés à l'étape 2

- `features/storefront/catalogue.tsx` (`Collection`, `ProductCard`, `ProductArt` → fiche E7), `cover.tsx`, `storefront-app.tsx` (onglets, affichage), `storefront.css`, `basket.tsx` (vignette E7).
- Nouveaux : `features/storefront/photos.tsx` (feuilletage et zoom), `features/storefront/info-line.ts`, `app/boutique/[slug]/produits/[produit]/page.tsx` (+ `not-found`).
- `lib/server/storefront.ts` (`getStorefrontProduct`), `lib/types.ts`, `app/app/[shop]/produits/page.tsx` (rappel E7).
- Suppression : `app/prototype/`, `features/prototype-essentiel/`, la ligne du `.gitignore`.
- **Conflits** (voir `00-index.md`) : `features/storefront/*` avec P05, P08, P09, P15, P18, P19 ; `features/products/*` avec P01, P07, P08.

## 8. Tests prévus à l'étape 2

- Lint et build.
- Essai navigateur à 375, 414 et 1280 px :
  - feuilleter (toucher, clavier) ;
  - ajouter depuis la photo, puis voir le contour et la quantité ;
  - régler la quantité dans le panier, commander : tout se passe comme avant ;
  - choix d'affichage retenu après rechargement, et en navigation privée (pas d'erreur) ;
  - mouvement réduit.
- Page produit : balises Open Graph vérifiées dans le HTML (`curl`). Un produit inactif ou d'une autre boutique donne la page introuvable. Le lien collé dans WhatsApp est essayé pour de vrai.
- `git diff main -- frontend/src/features/storefront/themes` est vide.
- Captures avant / après.

## 9. Décisions à valider

| # | Décision | Ma recommandation |
|---|---|---|
| 1 | Toucher la photo feuillette, toucher le nom ouvre la page produit. Pas de boucle à la dernière photo. | **Oui** : comme un statut, et le nom reste un vrai lien |
| 2 | E8 sans heure limite (« avant 17 h ») tant qu'elle n'existe pas en base | **Oui**, puis l'ajouter avec P05 |
| 3 | Photos en 600 et 1 200 px servies par Django, avec `srcset` (§5 a) | **Oui** : c'est la condition pour la 3G |
| 4 | Image d'aperçu en JPEG 600 px pour `og:image` (§5 b), adresse absolue grâce à une variable `SITE_URL` sur Vercel | **Oui**, à confirmer par un essai réel dans WhatsApp |
| 5 | Quantité sur la page produit : pastilles 1 à 5 plutôt que « − 1 + » | **Oui** : on règle au-delà dans le panier |
| 6 | Rappel « N produits sans photo » sur la page Produits, avec `without_photo` (§5 c) | **Oui** |
| 7 | Le lien d'un produit (`slug`) ne change pas quand le produit est renommé | **Oui**, sinon les liens partagés sur WhatsApp cassent. Koffi vérifie le comportement actuel |
| 8 | Le tri par prix disparaît de la vitrine Essentiel | **Oui** : les onglets et la photo suffisent. À garder si l'utilisateur y tient |
| 9 | Un produit épuisé reste dans la grille (photo désaturée, « Épuisé » sur la bande, sans bouton) | **Oui** : comme aujourd'hui |
| 10 | Le choix d'affichage vaut pour toutes les boutiques Akwaba sur l'appareil | **Oui** : c'est une habitude du client, pas un réglage de boutique |

## 10. Revue sécurité (Alice)

*À compléter par Alice.*
