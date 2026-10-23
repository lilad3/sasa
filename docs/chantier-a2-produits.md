# Chantier A2 : la fiche produit complète (P07)

Branche `claude/a2-produits`, depuis `main` (qui contient les lots P4 et P5 ; l'intégration des autres chantiers se fait à part). **Étape 1 : ce fichier est le contrat. Rien n'est codé.** Chaque point est validé par l'utilisateur, relu par Alice, puis codé.

Rappels communs (ceux de `chantier-p4.md` et `chantier-p5.md`) :
- migrations nouvelles seulement. D'autres chantiers ajoutent aussi des migrations `shops` en parallèle : ici **shops 0009 à 0011** et **audit 0010**, à renuméroter à l'intégration ;
- tout se décide côté serveur (`ShopScopedView`, `effective_permissions`, `.for_shop()`) ; non-membre : 404, droit manquant : 403 ;
- action sensible : `record()`, nouvelle action dans `audit/actions.py` + migration audit + liste blanche `DETAILS` d'`activity.py` ;
- textes saisis : `plain_text`, longueurs bornées, listes fermées, jamais de HTML ; erreurs problem+json à code stable ;
- argent et stock : mises à jour conditionnelles, dans une transaction.

| Lot | Contenu | État |
|---|---|---|
| A2 | Statut, prix barré, coût, précommande, duplication, étiquettes, historique du stock, modification en masse, import, champs par secteur | **contrat à valider**, rien n'est codé |

Dépendances avec les autres chantiers :
- **P04** apporte `Shop.sector` (8 secteurs). A2 ne dépend pas de lui pour le serveur (§A2.10) ;
- **P08** (variantes) ajoutera `StockMovement.variant` : la colonne est déjà prévue (§A2.7) ;
- **P09** (collections) s'appuiera sur `category` (« Type de produit ») et sur les étiquettes.

---

## A2.0 Ce que j'ai vérifié dans le code

| Question | Réponse | Où |
|---|---|---|
| L'annulation d'une commande remet-elle le stock ? | **Non.** `OrderDetailView.patch` change le statut, pose l'horaire, journalise : aucune écriture sur `Product.stock`. Chaque commande annulée fait perdre définitivement ses articles au stock. Alice avait raison. | `shops/views.py:76-109` |
| Qui écrit `Product.stock` aujourd'hui ? | 3 endroits : `checkout.place_order` (décrément conditionnel), `ProductSerializer` (champ `stock` libre à la création et au PATCH), `csv_import` (via le sérialiseur). Plus l'admin Django (`ProductAdmin`, tous les champs) et `demo.py` (`bulk_create`). | `checkout.py:~115`, `serializers.py:96`, `admin.py:19` |
| La photo d'un produit masqué est-elle protégée ? | **Pas par le statut.** `StorefrontPhotoView` sert toute photo de la boutique par son seul identifiant (UUID aléatoire). Un produit archivé garde donc ses photos publiques à vie pour qui connaît l'adresse. À corriger (§A2.1). | `photos.py:148` |
| Une limite de plan est-elle atomique ? | Non : `ensure_room` compte puis laisse créer, deux créations simultanées peuvent dépasser d'une unité. Déjà vrai pour `POST /products`. | `plans.py:53` |

---

## A2.1 Statut : Brouillon, Actif, Archivé (shops 0009 et 0011)

### Modèle

`Product.status` : `draft` (Brouillon) \| `active` (Actif) \| `archived` (Archivé). Liste fermée, `active` par défaut, indexé avec `shop`.

Migration en **trois temps**, pour qu'une version du code encore en ligne pendant le déploiement ne casse pas :
1. **0009** ajoute `status` et copie : `is_active=True` → `active`, `is_active=False` → `draft` (`RunPython` par `UPDATE … WHERE`, deux requêtes, SQLite et PostgreSQL ; réversible : `active` → True, `draft` et `archived` → False). `is_active` reste en place.
2. Le code A2 lit et écrit **`status` seulement**. `Product.is_active` devient une propriété en lecture seule (`status == "active"`), gardée dans les réponses d'API (§A2.1 « Compatibilité »).
3. **0011**, livrée après le déploiement du code A2, supprime la colonne `is_active`.

Aucune boutique existante ne change de comportement : tous les produits en vente restent en vente, les masqués deviennent des brouillons (ils ne sont plus « masqués » mais « non publiés », sans perte).

### Règles

| Statut | Vitrine, API publique, commande | Espace marchand |
|---|---|---|
| `active` | visible, commandable (si stock ou précommande) | liste par défaut |
| `draft` | **invisible et non commandable**, même avec l'`id` en appel direct | liste par défaut, étiqueté « Brouillon » |
| `archived` | **invisible et non commandable**, même en appel direct. Garde ses commandes, ses mouvements de stock, ses photos | filtre « Archivés » seulement ; désarchivable |

- Seul `active` passe les filtres publics. Un brouillon ou un archivé demandé par `slug`, par `id` dans une commande, ou par photo : **404** pour la fiche et la photo, `400 product_unavailable` dans une commande (comme aujourd'hui pour un produit masqué).
- Passer en `draft` ou `archived` **retire la une** (`is_featured=false`, même transaction, `product_featured` `change=removed`).
- Désarchiver (`archived` → `draft` ou `active`) exige de la place dans le plan (§ ci-dessous). Un archivé redevient d'abord brouillon par défaut côté interface : on ne remet pas en vente par un seul geste ce qu'on avait rangé.
- `DELETE /products/{id}` reste possible, quel que soit le statut. L'interface propose « Archiver » avant « Supprimer » quand le produit a des commandes.

### Un archivé compte-t-il dans la limite du plan ?

**Proposition : non.** `plans.count(shop, "products")` compte `draft` + `active`. Sinon archiver ne libère rien, et la marchande doit supprimer, donc perdre l'historique, pour continuer à vendre. Garde-fous :
- un plafond technique de **2 000 archivés** par boutique (409 `archive_limit`), pour que « archiver puis recréer » ne serve pas à contourner le plan à l'infini ;
- désarchiver, dupliquer, importer, créer et passer en masse à `draft` ou `active` passent tous par la même `ensure_room`, **faite dans la transaction avec le verrou de la boutique** (`select_for_update` sur `Shop` ; SQLite verrouille déjà tout en `IMMEDIATE`). Cela corrige aussi la course connue de `POST /products`.
- `plans.usage`, la baisse de plan (`plan_too_small`) et le compteur `/products/overview` utilisent la même définition.

### Compatibilité

- API marchande : `status` partout ; `is_active` reste dans les réponses (lecture seule) pendant une version, puis disparaît. `PATCH {is_active}` est refusé (`400 validation_error`) : on n'accepte plus qu'un `status`, pour ne rien convertir en silence (« Décisions », n° 8).
- API publique à clé (`/api/public/v1/products`) : gagne `status` ; `is_active` reste (= `status == active`) ; les brouillons et archivés y restent listés, comme les masqués aujourd'hui (la clé sert à synchroniser un catalogue).
- Photos : `StorefrontPhotoView` ne répond que pour un produit `active` (404 sinon). **Conséquence pour l'espace marchand** : la fiche d'un brouillon affiche ses photos par une nouvelle route membre `GET /shops/{slug}/products/{id}/photos/{photo_id}/image` (`products.view`, `ImageResponseMixin`, `Cache-Control: private, no-store`), relayée par `/app/{shop}/photo/{id}`. L'ancienne route de relais `/boutique/{slug}/photo/{id}` ne sert plus que les produits en vente.

### Tous les endroits qui lisent `is_active` aujourd'hui

Relevé par `grep -rn is_active` (hors `User.is_active`, qui est le compte, et hors migrations). Chacun est converti ; un test de garde est prévu (§A2.13).

| # | Fichier | Usage actuel | Après A2 |
|---|---|---|---|
| 1 | `shops/models.py:102` | le champ | `status` ; propriété `is_active` |
| 2 | `shops/storefront.py:156` | `popular()` : les plus vendus | `status="active"` ET commandable (stock > 0 ou précommande) |
| 3 | `shops/storefront.py:173` | couverture (`featured`) | idem |
| 4 | `shops/storefront.py:238` | `product_count` de la vitrine | `status="active"` |
| 5 | `shops/storefront.py:251` | liste publique des produits | `status="active"` |
| 6 | `shops/storefront.py:258` | fiche publique par `slug` | `status="active"` |
| 7 | `shops/checkout.py:132` | `priced_lines` : produit commandable | `status="active"`, **et** reverrouillé au décrément (§A2.4) |
| 8 | `shops/serializers.py:105` | champ de `ProductSerializer` | `status` (+ `is_active` en lecture seule) |
| 9 | `shops/public_api.py:59` | `public_product["is_active"]` | `status` + `is_active` dérivé |
| 10 | `shops/dashboard.py:59` | « Bientôt en rupture » | `status="active"` seulement (un brouillon ou un archivé n'alerte pas) |
| 11 | `shops/catalog.py:62` | `overview.active` | `active`, `draft`, `archived` ; `count` = hors archivés |
| 12 | `shops/photos.py:122` | `ProductFeaturedView.put` : 409 `product_inactive` | idem sur `status != active` |
| 13 | `shops/photos.py:148` | photo publique (**ne filtrait rien**) | 404 si le produit n'est pas `active` |
| 14 | `shops/csv_import.py:33,147` | colonne `actif` | colonne `statut` ; `actif` reste lu (§A2.9) |
| 15 | `shops/admin.py:21-22` | colonne et filtre | `status` |
| 16 | `shops/plans.py:66` | `count()` compte tout | hors archivés |
| 17 | `shops/demo.py:106` | crée sans préciser | `status` par défaut `active` ; ajoute les mouvements `initial` |
| 18 | `frontend/.../produits/[id]/page.tsx:52` | `FeaturedCard isActive` | `product.status === "active"` |
| 19 | `frontend/.../product-rows.tsx:104-105` | « En vente » / « Masqué » | statut en texte |
| 20 | `frontend/.../product-form.tsx:124` | interrupteur « En vente » | choix du statut |
| 21 | `frontend/.../actions.ts:47,79` | schéma zod, `formData` | `status` |
| 22 | `frontend/.../import-panel.tsx:22` | libellé de colonne | `status` |
| 23 | `frontend/.../types.ts:14` | type `Product` | `status` |
| 24 | tests existants (`test_catalog_and_exports.py:89,286`, `test_storefront.py:20`, `test_photos.py:184`) | créent avec `is_active=False` | `status="draft"` |

---

## A2.2 Prix barré : `compare_at_price` (shops 0009)

- `Product.compare_at_price` : entier, null par défaut, 2 à 100 000 000 F.
- **Règle serveur : strictement supérieur au prix** (`compare_at_price > price`), sinon `400 compare_at_invalid` (« Le prix barré doit être plus élevé que le prix. »). Vérifié à la création, au PATCH (y compris quand seul le **prix** change), à la duplication, à l'import et en masse.
- **Jamais dans un calcul** : ni sous-total, ni remise, ni total, ni marge, ni `expected_total`, ni CA. `priced_lines` ne le lit pas ; un test compare une commande avec et sans.
- Vitrine : `compare_at_price` et `discount_percent` (entier, arrondi **inférieur** : `(barré − prix) × 100 // barré`, donc jamais surévalué) n'apparaissent que si le prix barré est présent. Rendu : le prix barré en `texte-3` à côté du prix, puis « −20 % » en texte simple ; **aucun badge rouge**, aucune pastille « PROMO » (voir §A2.11).
- Le prix barré se vide par `null`. Une hausse de prix qui rejoint le prix barré est refusée (le marchand doit d'abord retirer le barré) : on ne supprime jamais une valeur en silence.
- Pas de limite de plan.

---

## A2.3 Coût d'achat : `cost` et marge (shops 0009)

### Modèle et droit

- `Product.cost` : entier, null par défaut, 0 à 100 000 000 F. **Pas de contrainte avec le prix** : un coût supérieur au prix est une vente à perte, c'est possible ; la fiche le dit en texte (« Vendu à perte »).
- Nouveau droit **`products.cost`** : **propriétaire seulement, non délégable.** Il n'entre pas dans `GRANTABLE` (donc `effective_permissions` ne l'accorde jamais à un gérant, même si une valeur étrangère se glissait dans `Membership.grants`, grâce à l'intersection avec `GRANTABLE` déjà en place). Raison : le coût révèle la marge, donc la négociation avec les fournisseurs et les prix des concurrents ; c'est ce qu'un gérant qui part à la concurrence emporterait. Si l'utilisateur veut le déléguer plus tard, il suffit de l'ajouter à `GRANTABLE` (une ligne) : voir « Décisions », n° 2.

### Ce que voit chaque rôle

| Rôle | Lecture | Écriture |
|---|---|---|
| Propriétaire | `cost`, `margin_amount` (F), `margin_percent` (entier) | oui |
| Gérant, vendeur | **les clés `cost`, `margin_amount`, `margin_percent` sont absentes** de la réponse (pas `null` : absentes) | `PATCH`/`POST` avec `cost` : 403 `permission_denied` (jamais ignoré en silence) |
| Vitrine, API publique, API à clé | **jamais**, quel que soit le rôle de celui qui a créé la clé | n'existe pas |

- Marge : `margin_amount = price − cost` (peut être négatif), `margin_percent = round(margin_amount × 100 / price)` (arrondi à l'entier le plus proche, demi vers le haut) ; `null` si `cost` est `null`. Calculée à la lecture, jamais stockée. Le prix barré n'y entre pas.
- **Un seul point de sortie** : `ProductSerializer.to_representation` retire `cost`, `margin_*` quand le contexte `can_cost` est faux. Le contexte vient de la vue (`"products.cost" in effective_permissions`), jamais du corps de la requête. Les autres sérialiseurs (`public_product`, `storefront.public_product`, `public_api.public_product`) n'ont **pas** le champ dans leur liste : ils ne peuvent pas le fuiter.
- Aucune autre sortie : rapport d'import (jamais d'écho de la valeur), journal (`DETAILS` ne contient pas `cost`), mouvements de stock, résultat de la modification en masse, `ProductOverview`, commandes (`OrderItem` ne copie pas le coût).
- La duplication par un gérant **copie** le coût côté serveur (le gérant ne le voit pas, mais le brouillon garde la marge de l'original) : décision n° 7.
- Pas de coût sur `OrderItem` : pas de marge historique par commande. Un changement de coût n'est donc pas rétroactif. (Une marge par commande serait un autre chantier : colonne `unit_cost` copiée à la commande.)
- `ProductAdmin` (Django admin, équipe Akwaba, 2FA) : `cost` **exclu** du formulaire et de la liste.

### Journal

Pas d'événement dédié : le coût ne se modifie que par le propriétaire. Un changement de coût n'est pas un secret vis-à-vis de lui-même, mais le nom du champ n'entre jamais dans un détail d'événement pour ne pas pousser une valeur de coût dans le journal.

---

## A2.4 Vendre en rupture : précommande (shops 0009 et 0010)

### Modèle

- `Product.allow_backorder` (booléen, faux par défaut) et `Product.backorder_days` (entier 1 à 60, null). **Obligatoire si `allow_backorder`** (`400 backorder_days_required`), remis à `null` si l'option est retirée.
- `OrderItem.from_stock` (entier ≥ 0) : la part de la ligne **prélevée sur le stock** (0010). `OrderItem.backorder_days` (entier, 0 par défaut) : le délai promis, **copié à la commande** comme le nom et le prix. Lignes existantes : `from_stock = quantity`, `backorder_days = 0` (toutes ont été prélevées).

### Règle de stock (la proposition)

Le stock ne descend **jamais sous zéro**. Pour une ligne de quantité *q* sur un produit au stock *s* :
- sans l'option : `s ≥ q` obligatoire, sinon **409 `out_of_stock`**, identique à aujourd'hui (même corps, mêmes `errors`) ;
- avec l'option : on prélève `min(s, q)` sur le stock, le reste `q − min(s, q)` est de la précommande. Le stock tombe à 0 au plus bas. `from_stock` garde la part prélevée, `backorder_days` le délai promis si `from_stock < quantity`.

Le prélèvement se fait **dans la transaction, à l'écriture, sous verrou de ligne** (§A2.7), pas sur la lecture de `priced_lines` : deux commandes simultanées sur le dernier article voient toutes deux `s = 1`, mais une seule prélève 1 ; l'autre, sans option, reçoit 409 `out_of_stock`, avec l'option, passe en précommande intégrale.

Le total de précommande n'est pas plafonné par produit (décision n° 5 propose un plafond optionnel). La quantité par ligne reste de 99 au plus.

### Commande, suivi, réponses

- Une commande qui contient une ligne en précommande est **une seule commande** ; la vitrine dit « Part quand tout est prêt : sous 7 jours » (le plus long des délais des lignes en précommande).
- `Order` expose, via ses lignes, `backorder_days` et `from_stock` (fiche commande marchande) ; le suivi public affiche « Précommande · sous 7 jours ». Le stock exact n'est jamais publié.
- Vitrine, produit public : `orderable` (stock > 0 ou précommande), `availability` ∈ `in_stock` \| `low_stock` \| `preorder` \| `out_of_stock`, `backorder_days` (null hors précommande), `max_quantity` (99 en précommande, sinon `min(stock, 99)`). `in_stock` garde son sens (stock > 0). `low_stock` n'est vrai que si stock > 0. Texte : « Précommande · disponible sous 7 jours ».
- `popular()` et la couverture : un produit en précommande à stock 0 reste éligible (`orderable`), mais passe après ceux qui sont en stock à égalité.

### Annulation : le stock revient (correctif)

Dans `OrderDetailView.patch`, **dans la transaction existante** du changement de statut, quand `new_status == cancelled` : pour chaque ligne dont `product` n'est pas null et `from_stock > 0`, `stock.apply(…, delta=+from_stock, reason="cancelled", order=order)`.
- Seule la part **prélevée** revient : une précommande n'a rien pris au stock.
- Les transitions ne permettent d'annuler que depuis `pending` ou `confirmed` ; `cancelled` est terminal : la remise a lieu **au plus une fois**. En plus, la contrainte unique `(order, product, reason)` des mouvements `sold` et `cancelled` (§A2.7) l'interdit même par deux requêtes simultanées.
- Le produit peut être brouillon ou archivé : le stock revient quand même. Produit supprimé (`product` null) : rien à remettre.
- La remise ignore le plafond de saisie de 1 000 000 (elle ne peut pas faire échouer une annulation).
- Les commandes **déjà annulées avant A2 ne sont pas rétablies** : on ne sait pas si leurs articles ont été remis sur l'étagère. La marchande corrige à la main par « Ajuster le stock » (raison `correction`). Une seule remise automatique, et l'historique le montre (décision n° 4).
- Les réductions : une utilisation de code n'est toujours pas rendue (inchangé, P5 §1.11).

---

## A2.5 Dupliquer (aucune migration propre)

**`POST /shops/{slug}/products/{id}/duplicate`**, droit `products.write`, corps vide.

| Champ de la copie | Valeur |
|---|---|
| `status` | `draft` (toujours, même si l'original est actif ou archivé) |
| `name` | « Copie de {nom} », tronqué à 120 caractères ; si le nom commence déjà par « Copie de », il est gardé tel quel |
| `sku` | `{sku}-COPIE`, puis `-COPIE-2`, `-COPIE-3`… tronqué pour tenir en 40 caractères ; unicité insensible à la casse, comme `validate_sku` |
| `slug` | `unique_slug` (existant) |
| `stock` | **0**, sans mouvement (pas de delta) |
| `is_featured` | faux |
| `is_demo` | faux |
| photos | copiées, 3 au plus : nouvelles lignes `ProductPhoto` (nouvel UUID, mêmes octets, même `version`, `created_by` = l'auteur de la copie) |
| étiquettes | copiées (10 au plus) |
| prix, prix barré, **coût**, catégorie, description, seuil, `image_url`, précommande, champs par secteur | copiés tels quels |

- `plans.ensure_room(adding=1)` dans la transaction, avec le verrou de la boutique : 403 `plan_limit_reached` au plafond.
- Dupliquer un archivé ou un brouillon est permis. Un produit d'une autre boutique : 404.
- Limite : 60 par heure et par membre (`product_duplicate:member`).
- Réponse 201 : la fiche du brouillon (sans `cost` pour un gérant). Journal **`product_duplicated`** (boutique, info), cible = la copie, détail `source` (nom de l'original).
- Atomique : si la copie des photos échoue, rien n'est créé.

---

## A2.6 Étiquettes (shops 0009)

- Modèle `ProductTag` : `id`, `shop` (pour `.for_shop()`), `product` (CASCADE), `label` (30 caractères au plus, tel que saisi, `plain_text`), `key` (comparaison : NFKD sans accents, `casefold`, espaces compressés). Contrainte unique `(product, key)` et index `(shop, key)`.
- **0 à 10 par produit**, 1 à 30 caractères. Doublons (même `key`) fusionnés en silence côté saisie. Au-delà de 10 : `400 tags_limit`. Le plafond est vérifié **sous verrou de la ligne produit** (`select_for_update`), donc deux ajouts simultanés ne passent pas 10.
- Lecture/écriture : `tags: ["Fait main", "Cadeau"]` dans la fiche. Un `PATCH` avec `tags` **remplace** la liste.
- **Libellé d'affichage** : une même étiquette (« Cadeau », « cadeau », « CADEAU ») a une seule forme d'affichage par boutique, la plus fréquente, départage par ordre alphabétique : les suggestions ne montrent pas trois fois la même.
- **Suggestions** : `GET /shops/{slug}/products/tags?q=` (`products.view`) renvoie les 20 plus utilisées par `key` (`{label, count}`), filtrées par préfixe de `key` si `q` est donné. `ProductOverview.tags` : les 30 premières.
- **Filtre** : `GET /products?tag=cadeau` filtre sur `key` (le serveur normalise la valeur reçue ; plusieurs `tag` séparés par une virgule : toutes doivent être présentes, 3 au plus).
- Les étiquettes ne sont **pas publiques** dans A2 (ni vitrine ni API à clé) : elles servent à ranger (« à relancer », « fournisseur X »). P09 décidera de ce qu'il en fait.
- **`category` est conservé** : le champ, l'API (`category=`), le filtre « rayon » et le CSV ne changent pas. Seuls les libellés de l'interface passent à **« Type de produit »**.

---

## A2.7 Historique du stock : `StockMovement` et `shops/stock.py` (shops 0010)

### Modèle

| Champ | Rôle |
|---|---|
| `id` | UUID |
| `shop`, `product` | `.for_shop()` ; `product` en CASCADE (supprimer un produit emporte son historique, voir décision n° 9) |
| `variant_id` | UUID **nul**, sans clé étrangère pour l'instant : P08 en fera une FK vers sa table |
| `delta` | entier non nul (contrainte `CHECK delta <> 0`) |
| `stock_after` | stock après le mouvement (entier ≥ 0) |
| `reason` | liste fermée : `initial`, `received`, `sold`, `cancelled`, `returned`, `damaged`, `correction`, `import` |
| `order`, `order_reference` | commande liée (SET_NULL) + copie de la référence, lisible même si la commande disparaît |
| `actor`, `actor_name` | l'auteur (SET_NULL) + copie du nom, comme `ShopGoal.set_by_name` ; vide pour le client de la vitrine (`sold`) |
| `note` | 200 caractères au plus, `plain_text`, facultatif |
| `created_at` | date |

Index `(shop, product, -created_at)`. Contrainte unique `(order, product, reason)` quand `reason IN (sold, cancelled)` : **une vente et une remise au plus par ligne de commande**.

Le journal est **en ajout seul** : `save()` refuse de modifier une ligne existante, aucune route ne modifie ni ne supprime, l'admin est en lecture seule.

### Migration des données existantes

Pour chaque produit au stock > 0, un mouvement `initial` (`delta = stock`, `stock_after = stock`, date de la migration, sans auteur), par `bulk_create` par lots de 500. Les produits à stock 0 n'en ont pas (delta nul interdit). **L'historique commence à la migration** : les ventes passées ne sont pas reconstituées. Invariant à partir de là : **pour tout produit, `stock == somme des delta`**.

### La fonction unique : `shops/stock.py`

```
apply(product_id, delta, reason, *, shop, actor=None, order=None, note="", require_active=False) -> StockMovement
set_to(product_id, count, reason, *, shop, actor=None, note="") -> StockMovement | None   # delta = count − stock, sous le même verrou
restore_for_order(order, actor) -> list[StockMovement]                                      # annulation
class StockError(ProblemError)   # codes : stock_below_zero, stock_too_high, product_unavailable
```

- Exige une transaction ouverte (`connection.in_atomic_block`, sinon `RuntimeError` : un appel hors transaction est un bug).
- Dans l'ordre : (1) verrou de la ligne produit (`select_for_update`, no-op sur SQLite qui verrouille déjà tout en `IMMEDIATE`), filtre `shop` ; (2) **mise à jour conditionnelle** : si `delta < 0`, `filter(pk, shop, stock__gte=-delta)` ; si `delta > 0`, `filter(…, stock__lte=1_000_000 − delta)` (sauf `cancelled`, qui ignore ce plafond) ; avec `require_active`, `filter(status="active")` ; `update(stock=F("stock") + delta)` ; zéro ligne touchée : `StockError` ; (3) lecture de `stock_after` sous le même verrou ; (4) création du mouvement.
- Plusieurs produits d'un coup (commande, masse) : appel dans l'**ordre croissant des `pk`**, pour éviter les verrous croisés sur PostgreSQL.
- Raisons autorisées par appelant :

| Appelant | Raison | Signe |
|---|---|---|
| création de produit (`POST /products`, stock de départ) | `initial` | + |
| `POST …/stock` (route marchande) | `received`, `returned` (+) ; `damaged` (−) ; `correction` (±) | contrôlé |
| `place_order` | `sold` | − |
| annulation | `cancelled` | + |
| import CSV | `import` | ± |
| masse (stock) | celles de la route marchande | idem |
| migration, démo | `initial` | + |

- **Plus aucun autre code n'écrit `stock`.** `ProductSerializer.stock` devient `read_only` en PATCH (le PATCH qui l'envoie reçoit `400 stock_use_adjust`, jamais d'ignorance silencieuse) ; accepté à la création (`initial`). `ProductAdmin.stock` passe en lecture seule. Un **test de garde** parcourt les sources et échoue si `.update(stock` ou `stock=` s'écrit hors de `shops/stock.py` et des migrations.

### Routes

| Route | Droit | Effet |
|---|---|---|
| `POST /shops/{slug}/products/{id}/stock` | `products.write` | corps : `{delta, reason, note?}` **ou** `{count, note?}` (« j'ai compté 12 », raison `correction`). **Quantité et raison obligatoires** (`400 reason_required`, `400 delta_required`). 201 `{movement, stock}`. 409 `stock_below_zero` avec `available`. Limite : 120 par heure et par membre (`stock_adjust:member`) |
| `GET /shops/{slug}/products/{id}/stock-movements` | `products.view` | les **50 derniers**, plus récents d'abord : `{id, delta, stock_after, reason, label, order: {id, reference}|null, actor: {name, is_you}|null, note, created_at}` ; `?before=<created_at>` pour la suite |

Le vendeur lit l'historique (il lit déjà stock et commandes) mais ne l'ajuste pas. Un produit d'une autre boutique : 404.

### Journal

`product_stock_adjusted` (boutique, info) pour chaque ajustement **manuel** (pas pour les ventes ni les annulations, qui ont leur propre trace dans la commande) : détails `delta`, `reason` ; la note n'y entre pas (texte libre).

---

## A2.8 Modification en masse

**`POST /shops/{slug}/products/bulk`**, droit `products.write`.

```json
{ "ids": ["…", "…"], "action": { "type": "price", "mode": "percent", "value": -10 } }
```

- `ids` : 1 à 100 UUID, sans doublon (`400 validation_error`).
- **Tout ou rien** : une transaction, produits verrouillés dans l'ordre des `pk`, une seule erreur annule tout.
- **Chaque identifiant est vérifié dans la boutique avant tout le reste.** Si un seul identifiant n'est pas un produit de **cette** boutique, qu'il n'existe pas ou qu'il appartienne à une autre : même réponse, `400 invalid_selection`, « La sélection n'est pas valide. », sans aucun identifiant, sans nombre, sans différence de corps ni de durée notable entre « inconnu » et « autre boutique ». Un test compare les deux réponses. Rien n'est modifié.
- Les erreurs de règle (produit de la boutique, mais action impossible) viennent après, et listent les produits de la boutique en cause : `409 bulk_failed`, `errors: [{product_id, sku, code, message}]` (20 au plus).

| `action.type` | Paramètres | Règles |
|---|---|---|
| `price` | `mode: "set"` + `value` (1 à 100 000 000) ; ou `mode: "percent"` + `value` (entier non nul, −90 à +100) | `percent` : `prix × (100 + value) / 100`, **arrondi au multiple de 5 F le plus proche**, minimum 5 F (décision n° 6) ; refuse tout produit dont le nouveau prix rejoint son prix barré (`compare_at_invalid`) |
| `stock` | `mode: "add"` + `value` (entier non nul), ou `mode: "set"` + `value` (≥ 0) ; `reason` **obligatoire** ; `note?` | un mouvement par produit (`stock.apply`/`set_to`) ; un seul résultat négatif fait tout échouer (`stock_below_zero`) |
| `status` | `status` ∈ `draft`, `active`, `archived` | `ensure_room` pour le nombre de produits qui quittent `archived` ; une une disparaît si le produit sort de `active` |
| `tag_add` | `label` | 10 au plus par produit (`tags_limit`) |
| `tag_remove` | `label` | comparaison par `key` ; un produit sans l'étiquette est ignoré (pas une erreur) |

- Réponse 200 : `{count, action}` seulement. **Jamais** de liste de fiches (le coût ne peut pas fuiter par là).
- Limite : 20 par heure et par membre (`products_bulk:member`), 100 par jour et par boutique (`products_bulk:shop`).
- Journal **`products_bulk_updated`** (boutique, info), un seul événement : détails `count`, `action`, `status` (si c'est l'action), `reason` (si c'est le stock). Les mouvements de stock, eux, sont écrits un par produit avec l'auteur.
- Le coût n'est pas modifiable en masse (droit `products.cost`, décision n° 3).

---

## A2.9 Import CSV (`csv_import.py`)

Le bouton « Importer » passe dans l'en-tête de la page Produits (§A2.11). Le serveur ne change pas de contrat : même route, même rapport, **tout ou rien**.

Nouvelles colonnes, mêmes règles de normalisation (sans accents, sans majuscules) :

| En-tête(s) | Champ | Valeurs |
|---|---|---|
| `statut`, `status` | `status` | `brouillon`, `actif`, `archive`/`archivé`, `draft`, `active`, `archived` ; inconnu → erreur de ligne `invalid_choice` |
| `prix_barre`, `ancien_prix`, `compare_at_price` | `compare_at_price` | nombre comme `prix` ; règle > prix |
| `cout`, `cout_achat`, `cost` | `cost` | **propriétaire seulement** |
| `etiquettes`, `tags` | étiquettes | séparées par `\|` ou `,` (le séparateur du fichier est déjà `;` ou `,` : une cellule avec virgule doit être entre guillemets, ce que fait Excel) ; remplace la liste du produit ; cellule vide : inchangé |

- **Anciens fichiers inchangés** : la colonne `actif` (`oui`/`non`) continue d'être lue (`oui` → `active`, `non` → `draft`) ; si `statut` **et** `actif` sont présentes, `statut` l'emporte. Une cellule vide ne change rien, comme aujourd'hui. Test : un fichier d'avant A2 produit exactement le même rapport.
- **Colonne coût par un non-propriétaire : 403 `permission_denied`** pour tout le fichier, avant toute lecture de ligne (« La colonne coût est réservée au propriétaire. »). Le rapport ne répète jamais un coût.
- Le stock d'un produit existant passe par `stock.set_to(reason="import")`, un produit créé par `stock.apply(reason="import")` : un mouvement par produit modifié, aucun si la valeur est inchangée.
- Le plafond de plan compte les créations **non archivées** et les désarchivages, dans la transaction avec verrou.
- Pas de colonnes pour les champs par secteur dans A2 (décision n° 10).

---

## A2.10 Fiche selon le secteur (shops 0009)

### Champs (tous facultatifs, listes fermées)

| Champ | Type | Valeurs | Secteur proposé |
|---|---|---|---|
| `condition` | texte | `new` (Neuf), `refurbished` (Reconditionné), `used` (Occasion) ; vide | tech |
| `warranty_months` | entier | 1 à 60, null | tech, maison |
| `sold_by` (unité de vente) | texte | `piece` (Pièce, par défaut), `kg`, `sachet`, `tas`, `litre` | epicerie |
| `one_of_a_kind` (pièce unique) | booléen | faux par défaut | artisanat |
| `made_to_order` (fabriqué sur commande) | booléen | faux par défaut ; **exige `allow_backorder` et `backorder_days`** (`400 made_to_order_needs_delay`) ; le délai de fabrication est donc `backorder_days` | artisanat |
| `bulky` (gros colis) | booléen | faux par défaut | maison |

- **Le serveur ne dépend pas du secteur** : il accepte ces champs pour toute boutique, valide les listes fermées, et conserve les valeurs si la boutique change de secteur. C'est l'interface qui choisit **quoi proposer** d'après `Shop.sector` (P04) ; un secteur « autre » ou inconnu ne propose rien en premier plan, avec un bloc replié « Plus de détails » qui montre tout. Cela évite de perdre des données au changement de secteur et de bloquer A2 sur P04.
- Quantités entières seulement : « au kilo » vend 1, 2, 3 kg. Pas de décimales (FCFA sans centimes, stock entier). Dit dans le texte d'aide.
- `one_of_a_kind` : le stock reste libre, mais l'interface propose de le fixer à 1, et la vitrine écrit « Pièce unique » et limite la quantité à 1 (`max_quantity = 1`).
- Vitrine : `details`, un objet qui ne contient que les champs renseignés ou non par défaut : `{condition?, warranty_months?, sold_by (si ≠ piece)?, one_of_a_kind?, made_to_order?, bulky?}`. Les libellés sont écrits par le front, jamais par le serveur.
- Aucune limite de plan.

---

## A2.11 Front, détaillé pour Marc

Le serveur décide de tout (cf. règles communes) ; le front masque seulement ce qui est interdit. Les pages restent dans `frontend/src/features/products/`. Le style suit `product-rows.tsx` et `featured.tsx` : verre `vitre`, traits `trait-doux`, `nuit`/`orange`/`indigo`/`ocre`/`corail`, **ni vert ni blanc pur**, pas de badge pastel ni de pastille « PROMO ».

### Types et textes

- `types.ts` : `Product` gagne `status`, `compare_at_price`, `cost?`, `margin_amount?`, `margin_percent?` (**optionnels** : absents pour un gérant), `allow_backorder`, `backorder_days`, `tags`, `condition`, `warranty_months`, `sold_by`, `one_of_a_kind`, `made_to_order`, `bulky`. Nouveaux : `StockMovement`, `BulkAction`. `ProductOverview` gagne `draft`, `archived`, `tags`. `ProductFilters` gagne `status`, `tag`. `lib/types.ts` : `PublicProduct` gagne `compare_at_price`, `discount_percent`, `orderable`, `availability`, `backorder_days`, `details` ; `Order` items et `TrackedOrder` gagnent `backorder_days`.
- `lib/messages.ts` : `compare_at_invalid`, `backorder_days_required`, `made_to_order_needs_delay`, `tags_limit`, `stock_below_zero`, `stock_use_adjust`, `reason_required`, `delta_required`, `invalid_selection`, `bulk_failed`, `archive_limit`, `product_unavailable`.
- `lib/voice.ts` : tous les textes nouveaux en écriture neutre, selon le rôle du lecteur (exemples dans chaque partie ci-dessous). Les montants s'écrivent « 12 500 F » (`formatFcfa`). Terminologie Shopify : « Brouillon », « Actif », « Archivé », « Prix avant réduction » (barré), « Coût par article », « Marge », « Étiquettes », « Type de produit », « Précommande », « Dupliquer », « Modifier en masse ».
- Les Server Actions suivent les règles du projet : `authedMutation`, zod, fichiers « use server » sans export autre que des fonctions async.

### 1. La fiche produit (`produits/[id]` et `produits/nouveau`)

Aujourd'hui `product-form.tsx` est un seul formulaire. Il se découpe en **sections empilées**, chacune avec son titre et son enregistrement, dans cet ordre (mobile d'abord, une seule colonne ; deux colonnes à partir de `lg`, la colonne de droite porte Statut, Photos, Type et étiquettes) :

| Section | Contenu | Qui la voit |
|---|---|---|
| **En-tête** | nom du produit, **Statut** en texte, boutons « Dupliquer » et menu (« Archiver », « Supprimer ») | tous ; boutons : `products.write` |
| **Statut** | trois choix radio « Brouillon · Actif · Archivé » avec une phrase chacun (« Pas visible sur la vitrine », « Visible et commandable », « Rangé, garde son historique ») | tous, modifiable avec `products.write` |
| **Prix** | `Prix` ; `Prix avant réduction` (facultatif, aide : « Affiché barré. Doit être plus élevé que le prix. N'entre dans aucun calcul. ») ; ligne d'aperçu vitrine : « 8 000 F ~~10 000 F~~ · −20 % » | tous ; écriture : `products.write` |
| **Coût et marge** | `Coût par article` ; ligne « Marge : 3 000 F · 38 % » (« Vendu à perte » si négative, en ocre) | **seulement `products.cost`** : la section n'est pas rendue du tout sans le droit, pas grisée |
| **Stock** | stock actuel, `seuil d'alerte`, case « Continuer à vendre en rupture de stock » → champ `Disponible sous … jours` (1 à 60) ; bouton **« Ajuster le stock »** (§3) ; les **50 derniers mouvements** (§3). Le champ « Stock » du formulaire de création reste (stock de départ) ; en modification, il devient un nombre non éditable | tous ; écriture : `products.write` |
| **Photos** | inchangé (3 emplacements, déjà fait) ; les images passent par la nouvelle route membre pour les brouillons | tous |
| **Type et étiquettes** | `Type de produit` (champ `category` avec suggestions des types existants) ; `Étiquettes` : saisie avec suggestions (`products/tags?q=`), Entrée ou virgule valide, chaque étiquette est une puce supprimable au clavier (« Retirer {étiquette} »), compteur « 3 sur 10 » | tous |
| **Détails selon votre activité** | champs du secteur (§A2.10) : tech → État et Garantie ; épicerie → Vendu à la pièce, au kilo… ; artisanat → Pièce unique, Fabriqué sur commande (+ délai qui réutilise celui de la précommande) ; maison → Garantie, Gros colis. Bloc replié « Plus de détails » avec tous les autres | tous |
| **À la une** | inchangé (`featured.tsx`), mais désactivé avec explication si le statut n'est pas Actif | `storefront.edit` |

Règles de l'écran :
- **Enregistrer** : une barre en bas de l'écran sur mobile (zone du pouce) avec « Enregistrer » et, pour un nouveau produit, **deux boutons** « Enregistrer en brouillon » et « Mettre en vente » (le défaut du serveur reste `active`, mais l'interface propose le brouillon en premier).
- Le serveur rejette ? Le message du code s'affiche **sous le champ concerné** et le focus y va (`aria-describedby`, `role="alert"`), jamais en haut de page seulement.
- **Dupliquer** : un clic ; l'action crée la copie puis ouvre sa fiche avec le message « Copie créée en brouillon. Vérifiez le nom et le stock. ». Au plafond du plan, `plan_limit_reached` s'affiche avec le renvoi vers l'offre.
- **Archiver** remplace « Supprimer » comme action principale quand le produit a des commandes ; « Supprimer » reste, en deux temps, sous « Plus d'actions ».
- Un **brouillon** et un **archivé** montrent en haut une bande d'information en texte simple (sans couleur d'alerte) : « Ce produit n'est pas visible sur la vitrine ».
- Photos d'un produit non actif : image via `/app/{shop}/photo/{id}`.

### 2. La liste des produits (`produits/page.tsx`, `product-rows.tsx`)

**En-tête** : « N produits · M actifs » ; à droite, les actions dans cet ordre, **« Importer »** (lien vers `/produits/import` ; sur le plan Gratuit, désactivé avec « À partir du plan Pro » comme aujourd'hui), puis « Nouveau produit ». « Importer » est visible pour `products.write` seulement.

**Filtres** (onglets, puis un seul bouton « Filtres » sur mobile) : Statut : « Tous · Brouillons · Archivés » (par défaut : actifs et brouillons ; adresse `?statut=brouillon|actif|archive|tous`), Stock : « Stock bas · En rupture » (existant), `Étiquette` (liste déroulante alimentée par `overview.tags`, adresse `?etiquette=`), `Type de produit` (existant, adresse `?rayon=`). Les filtres actifs se résument sous la barre (« Archivés · étiquette Cadeau ») avec « Tout effacer ».

**Colonnes** (md et plus) : Produit (vignette + nom + étiquettes en texte gris), Statut, Prix (avec le barré à côté), Stock, et pour `products.cost` seulement : **Marge** (un pourcentage, sans couleur sauf négatif en ocre). Sur mobile, une ligne par produit : vignette, nom, prix, stock, statut en texte.

**Sélection au pouce** :
- Un bouton **« Sélectionner »** dans l'en-tête de la liste (visible avec `products.write`) fait entrer en mode sélection. Hors de ce mode, tout reste comme aujourd'hui : un tap ouvre la fiche.
- En mode sélection, chaque ligne a une **cible de 48 × 48 px** à gauche (case à cocher vraie, `<input type="checkbox">` avec libellé « Sélectionner {produit} »), et **toute la ligne** coche/décoche (l'ouverture de la fiche est suspendue). Appui long sur une ligne = entrer en mode sélection avec cette ligne cochée.
- Un **bandeau fixé en bas de l'écran**, dans la zone du pouce, au-dessus de la barre de l'appareil : « 3 sélectionnés » à gauche, « Choisir une action » à droite (bouton large, 48 px), « Tout sélectionner (20) » et « Annuler » à droite de la barre d'outils. Il porte `role="region"` et `aria-live="polite"` pour annoncer le décompte.
- **Maximum 100** : à la 101e, le décompte devient « 100 sur 100 » et la case suivante est désactivée avec l'explication « 100 produits au plus à la fois ». « Tout sélectionner » coche la page affichée (20) ; la sélection **persiste entre les pages** (état conservé côté client, `sessionStorage` protégé par try/catch) jusqu'à 100.
- « Choisir une action » ouvre une **feuille du bas** (`dialog`, glissée, fermable par Échap et par glissement) avec cinq choix en grosses lignes : « Modifier les prix », « Modifier le stock », « Changer le statut », « Ajouter une étiquette », « Retirer une étiquette ». Chaque choix déroule son mini-formulaire dans la feuille :
  - **Prix** : « En valeur » (un prix commun) ou « En pourcentage » (−90 à +100), aperçu « 10 000 F → 9 000 F » sur le premier produit sélectionné, et la mention « arrondi à 5 F près » ;
  - **Stock** : « Ajouter ou retirer » / « Fixer à », la quantité, et la **raison obligatoire** (boutons radio : « Réception, Retour, Casse, Correction ») ;
  - **Statut** : trois choix ; l'archivage annonce « Les commandes passées sont conservées » ;
  - **Étiquette** : champ avec suggestions.
- **Confirmation avant envoi**, dans la même feuille : « Modifier 12 produits ? », la liste des 3 premiers noms, « Tout est modifié ou rien ne l'est ». Le bouton principal est le seul élément en `bouton-nuit` de la feuille.
- Réponse `invalid_selection` : message neutre « La sélection n'est plus valide. Actualisez la liste. » (jamais plus précis). `bulk_failed` : la feuille liste les produits en cause avec leur raison (« Café 250 g : le stock tomberait sous zéro ») et **rien n'a été modifié** est dit clairement.
- Après succès : retour à la liste, sélection vidée, message « 12 produits modifiés. ».

**Styles de statut** (texte, jamais badge pastel) : « Actif » en `texte-2` ; « Brouillon » en sable avec un trait pointillé à gauche de la ligne ; « Archivé » en `texte-3`, ligne atténuée. Le stock en rupture reste en ocre, la précommande s'écrit « Précommande · 7 jours » en indigo.

### 3. L'ajustement du stock

- Le bouton **« Ajuster le stock »** (fiche, section Stock, et ligne de la liste via le menu « ⋯ ») ouvre une **feuille du bas** sur mobile, une fenêtre à droite sur grand écran.
- Contenu, de haut en bas :
  1. le produit et le **stock actuel** en grand (« 12 en stock ») ;
  2. deux modes, en onglets : **« Ajouter ou retirer »** (par défaut) et **« J'ai compté »** ;
  3. « Ajouter ou retirer » : un pas à gros boutons − et + (48 px), le champ numérique entre les deux, et des raccourcis « +1 », « +5 », « +10 », « −1 », « −5 » ; « J'ai compté » : un seul champ « Quantité comptée » ;
  4. un **aperçu en direct** : « 12 → 17 » (ou « 12 → 4 » en ocre si la quantité retire) ; si le résultat serait négatif, le bouton est désactivé avec « Le stock ne peut pas descendre sous zéro » ;
  5. la **raison, obligatoire**, en boutons radio (jamais un menu déroulant caché) : « Réception » (+), « Retour client » (+), « Casse ou perte » (−), « Correction » (±). Les raisons incompatibles avec le signe choisi sont désactivées avec leur explication. **Aucune raison n'est présélectionnée** : « Enregistrer » reste désactivé tant qu'on n'a pas choisi ;
  6. une **note** facultative (200 caractères, compteur) ;
  7. « Enregistrer » (`bouton-nuit`).
- Erreurs : `reason_required` / `delta_required` sous le champ ; `stock_below_zero` avec « Il n'y en a que 12 ».
- **Historique** (section Stock de la fiche) : les 50 derniers mouvements, une ligne chacun : date relative et absolue, `+5` / `−2` (signe en toutes lettres pour lecteur d'écran : « plus 5 », « moins 2 »), stock après, la raison en mots (« Vendu », « Annulation », « Réception »… via `label`), « par Fatou » ou « par la vitrine », et « Commande AKW-… » en lien vers la commande, la note en gris. Pas de tableau pastel : une liste lisible avec un trait à gauche, indigo pour une entrée, ocre pour une sortie. Un bouton « Voir plus » pagine par `before`. Vide : « Pas encore de mouvement. Le suivi commence à votre première modification de stock. ».
- Sur grand écran, l'historique est dans la colonne de droite.

### 4. La vitrine

- `catalogue.tsx`, `basket.tsx`, `storefront-app.tsx`, `themes/parts.tsx` : remplacer chaque usage de `in_stock` qui décide « commandable » par `orderable` (liste : `storefront-app.tsx:66,73,75,100`, `catalogue.tsx:192,213`, `themes/parts.tsx:100,130`). `max_quantity` est lu tel quel. Oublier une occurrence donne « Épuisé » (échec sûr, jamais une survente).
- **Prix barré** : le prix actuel en gras, le prix barré en `texte-3` avec `line-through` et un texte accessible (`<del>` avec `aria-label="Ancien prix 10 000 F"`), puis « −20 % » en texte `ocre` simple. Aucune pastille, aucun rouge, aucune étiquette en coin d'image.
- **Précommande** : à la place de « Épuisé », « Précommande · disponible sous 7 jours » (indigo) et le sélecteur de quantité actif (1 à 99). Au panier, sur la ligne : « dont {n} en précommande » quand la quantité dépasse le stock public connu ; au récapitulatif de commande : « Votre commande part quand tout est prêt : sous 7 jours ». Le suivi (`track.tsx`) affiche « Précommande · sous 7 jours » sur la ligne concernée.
- **Détails** (`details`) : sous la description, une courte liste en texte : « État : reconditionné », « Garantie : 12 mois », « Vendu au kilo », « Pièce unique », « Fabriqué sur commande », « Gros colis : livraison à convenir ».
- Les brouillons et archivés n'existent plus pour la vitrine : une adresse de produit ancien répond 404 (page « Ce produit n'est plus en vente »).

---

## A2.12 Journal

| Action | Catégorie, gravité | Détails (liste blanche `DETAILS`) |
|---|---|---|
| `product_duplicated` (« Produit dupliqué ») | boutique, info | `source` |
| `products_bulk_updated` (« Produits modifiés en masse ») | boutique, info | `count`, `action`, `status`, `reason` |
| `product_stock_adjusted` (« Stock ajusté ») *(à valider, n° 9)* | boutique, info | `delta`, `reason` |
| `product_status_changed` (« Statut d'un produit modifié ») *(à valider, n° 9)* | boutique, info | `previous`, `new` |
| `product_featured` (existant) | inchangé | + `change=removed` quand un produit quitte `active` |

Nouvelle migration audit 0010 pour ces choix d'action. Jamais dans un détail : `cost`, les notes de stock, les étiquettes saisies, les noms de produits d'une sélection.

---

## A2.13 Tests prévus

Backend (Django `manage.py test`) :

- **Statut** : migration de données (un produit `is_active=True` devient `active`, `False` devient `draft`, rien d'autre ne change, aller et retour) ; **brouillon et archivé refusés en appel direct** : fiche publique par slug 404, photo publique 404, commande avec leur `product_id` 400 `product_unavailable`, absents de la liste publique, de `popular`, de la couverture, du compteur, du tableau de bord « Bientôt en rupture » ; la une disparaît au passage en brouillon ; désarchiver au plafond du plan : 403 ; l'archivé ne compte pas dans le plan ; plafond technique d'archivés. **Test de garde** : aucun fichier de production ne mentionne plus `is_active` en dehors de la propriété, de `User` et des migrations.
- **Prix barré** : refusé s'il est ≤ prix (création, PATCH du barré, PATCH du seul prix, masse, import, duplication) ; une commande avec et sans prix barré donne le même total ; la vitrine renvoie `discount_percent` arrondi à l'inférieur.
- **Coût** : **absent (clé absente) pour un gérant et un vendeur** dans la liste, la fiche, la réponse de création/modification, la duplication, le résultat de masse, l'import, le journal, la vitrine, l'API publique à clé ; présent pour le propriétaire avec la bonne marge ; `PATCH cost` par un gérant : 403 ; un gérant dont `grants` contient `products.cost` (valeur injectée) ne l'obtient pas ; un test **parcourt tout le JSON** de chaque réponse et échoue si la clé `cost` ou `margin` apparaît pour un non-propriétaire ; l'import avec colonne coût par un gérant : 403.
- **Précommande** : sans l'option, 409 `out_of_stock` identique à l'actuel ; avec l'option, la commande passe, le stock reste à 0 et ne devient jamais négatif, `from_stock` et `backorder_days` sont corrects ; `backorder_days` obligatoire ; mixte (une ligne en stock, une en précommande).
- **Annulation** : annuler une commande remet exactement `from_stock` avec un mouvement `cancelled` (avant A2, ce test **échoue**, ce qui prouve le défaut) ; annuler deux fois ne remet pas deux fois ; une précommande pure ne remet rien ; produit archivé ou supprimé ; le statut non annulable (409) ne touche pas au stock.
- **Historique du stock** : **chaque variation de stock a son mouvement** (création, ajustement, vente, annulation, import, masse) ; l'invariant `stock == somme des delta` vaut sur tout le jeu de tests, y compris la démo ; ajustement sans raison ou sans quantité : 400 ; sous zéro : 409 ; raison/signe incohérents : 400 ; `PATCH stock` : 400 `stock_use_adjust` ; 50 derniers seulement ; vendeur lit mais ne modifie pas ; autre boutique 404 ; **test de garde** : aucune écriture de `stock` hors `shops/stock.py`.
- **Concurrence** : **le dernier article commandé deux fois en même temps, une seule commande passe**. Le test de la suite rejoue la course (le perdant a lu `stock = 1` avant que le gagnant n'écrive : sa mise à jour conditionnelle touche 0 ligne et il reçoit 409), comme `test_refresh_race.py` ; la concurrence réelle (2 puis 20 requêtes parallèles sur le serveur de développement, base fichier) est prouvée par un script joint au rapport, car la base de test en mémoire de SQLite refuse les écritures parallèles.
- **Masse** : tout ou rien (une erreur sur le 50e, rien de modifié, aucun mouvement ni événement) ; **un identifiant d'une autre boutique fait tout échouer, avec la même réponse qu'un identifiant inexistant**, sans rien modifier ; 101 produits : 400 ; doublon : 400 ; chaque action (prix valeur et pourcentage avec arrondi, stock avec raison obligatoire, statut, étiquette ajoutée/retirée) ; limite de débit ; journal avec un seul événement ; vendeur 403.
- **Étiquettes** : 10 au plus, 30 caractères, HTML refusé, doublon sans casse ni accents fusionné (« Cadeau » = « cadeau » = « Câdeau »), suggestions triées, filtre `tag=`, deux ajouts simultanés ne dépassent pas 10.
- **Dupliquer** : brouillon, nom et référence/slug nouveaux et uniques, stock 0 sans mouvement, pas à la une, photos copiées (3 au plus), étiquettes copiées, plan atteint 403, `products.write` requis (vendeur 403), autre boutique 404, coût copié mais absent de la réponse d'un gérant, journal.
- **Import** : un fichier d'avant A2 (colonne `actif`, sans nouvelles colonnes) donne le même rapport qu'avant ; `statut`, `prix_barre`, `etiquettes` ; `cout` par un propriétaire OK, par un gérant 403 ; tout ou rien conservé ; le stock importé crée des mouvements `import`.
- **Secteur** : listes fermées (`condition`, `sold_by`), garantie 1 à 60, `made_to_order` sans délai refusé, `details` public ne contient que ce qui est renseigné.
- **Boutiques existantes inchangées après migration** : jeu de données d'avant A2 (produits actifs, masqués, avec stock, commandes) → après `migrate`, les mêmes produits sont visibles dans la vitrine et commandables, le total des stocks est identique, chaque produit au stock > 0 a un unique mouvement `initial`, les commandes existantes sont intactes (`from_stock = quantity`).
- Vérifications de forme : `makemigrations --check`, migration jouée sur SQLite **et** sur PostgreSQL (CI), puis rejouée à l'envers (0009 et 0010).

Frontend : `npm run lint` et `npm run build` ; parcours à la main avec captures (mobile 375 px et bureau) : fiche (propriétaire puis gérant : la section coût absente), liste avec sélection et feuille d'actions, ajustement de stock, vitrine (prix barré, précommande), import. Aucun vert, aucun blanc pur, contrastes WCAG 4,5:1.

---

## A2.14 Décisions à valider

| # | Question | Recommandation |
|---|---|---|
| 1 | **Un archivé compte-t-il dans la limite du plan ?** | **Non**, avec un plafond technique de 2 000 archivés. Les brouillons comptent. |
| 2 | **`products.cost` est-il délégable ?** | **Non** : propriétaire seul. Une ligne dans `GRANTABLE` suffirait si vous changez d'avis. |
| 3 | Le coût est-il modifiable en masse ? | **Non** (droit propriétaire, usage rare ; l'import CSV du propriétaire couvre le besoin). |
| 4 | Remettre le stock à l'annulation, et rétablir les commandes déjà annulées ? | **Remettre dès maintenant** (mouvement `cancelled`, même transaction). **Ne pas rétablir** les anciennes (on ne sait pas ce qui a été remis en rayon) : la marchande corrige à la main. |
| 5 | Plafonner les précommandes ? | **Pas de plafond par produit** dans A2 (la marchande voit le nombre de précommandes dans la fiche). Si vous craignez des précommandes sans fin, on ajoutera `backorder_limit` : une colonne, une règle. |
| 6 | Arrondi des prix en masse | **Au multiple de 5 F le plus proche** (la plus petite pièce courante). Alternative : au franc. |
| 7 | La duplication par un gérant copie-t-elle le coût qu'il ne voit pas ? | **Oui**, copié côté serveur, jamais montré. Sinon il faudrait refuser la duplication aux gérants. |
| 8 | Compatibilité de `is_active` côté API | **Garder `is_active` en lecture seule dans les réponses pendant une version** (API publique à clé incluse) ; **refuser `PATCH is_active`** (`400`) pour ne pas convertir en silence. Supprimer la colonne en 0011, un déploiement plus tard. |
| 9 | Événements de journal en plus de la demande : `product_stock_adjusted`, `product_status_changed`, et journaliser la **suppression** d'un produit (`product_deleted`), puisque supprimer emporte son historique de stock | **Oui aux trois** : le vol de stock se cache dans les ajustements, et une suppression sans trace efface la preuve. Sinon seuls `product_duplicated` et `products_bulk_updated` sont ajoutés. |
| 10 | Champs par secteur dans l'import CSV | **Non** dans A2 (colonnes facultatives, peu utiles en import) ; à rouvrir si les premiers marchands le demandent. |
| 11 | Les étiquettes sont-elles visibles des clients ? | **Non** dans A2 (outil de rangement interne). P09 décidera. |
| 12 | `StockMovement` : variantes | `variant_id` en UUID nul **sans FK** maintenant ; P08 posera la clé étrangère (une migration d'altération). |
| 13 | Photos des produits non publiés | Route de photo publique **filtrée sur le statut `active`** ; nouvelle route membre pour l'espace marchand (§A2.1). |
| 14 | Un produit en précommande à stock 0 peut-il être « à la une » et « le plus demandé » ? | **Oui** (éligible comme les produits en stock, après eux à égalité). |

---

## Revue sécurité (Alice)

*(à remplir)*
