# Chantier P5 : après la remise du test

Base : `espace-marchand-p2-p3`, qui contient `e028a0d` (API P4) et `5cedd08` (front P4). Une branche par lot (`claude/p5-…`) ; l'intégration se fait en local par une autre session. Ce fichier est le contrat : **chaque lot est détaillé ici et validé par l'utilisateur avant d'être codé**.

Rappels communs (ceux de `chantier-p4.md`) :
- migrations nouvelles seulement (shops 0005…, audit 0006…), vérifiées par `makemigrations --check` ;
- tout se décide côté serveur (`ShopScopedView`, `effective_permissions`), les données passent par `.for_shop()` ;
- un non-membre reçoit 404, un droit manquant 403 ;
- chaque action sensible : `record()`, nouvelle action dans `audit/actions.py` et dans la liste blanche `DETAILS` d'`activity.py` ;
- textes saisis : `plain_text`. Erreurs : problem+json existant.

| Lot | Branche | État |
|---|---|---|
| 1. Réductions et canaux de vente | `claude/p5-reductions-canaux` | fait (décisions de §1.11 appliquées) |
| 2. Produit à la une et photos | `claude/p5-une-photos` (sur le lot 1) | fait |
| 3. Éditeur « Ma boutique » | `claude/p5-ma-boutique` (sur le lot 5) | **maquette à valider**, rien n'est codé |
| 4. Export des clients et « Livrées à temps » | `claude/p5-export-delais` (sur le lot 2) | fait |
| 5. Renouvellement des sessions | `claude/p5-sessions` (sur le lot 4) | fait : course confirmée, 3 correctifs |

---

## Lot 1 : réductions et canaux de vente

### 1.1 Modèle `Discount` (shops 0005)

| Champ | Type | Règle |
|---|---|---|
| `id` | UUID | sert dans les adresses (`/discounts/{id}`) ; le code n'apparaît jamais dans une URL |
| `shop` | FK `Shop` | `objects = ShopScopedQuerySet` |
| `customer` | FK `Customer` (CASCADE) | le code ne vaut que pour **son** téléphone |
| `code` | 9 caractères, `AYA-7K2Q` | voir 1.2. Contrainte d'unicité `(shop, code)` |
| `kind` | `percent` \| `amount` | liste fermée |
| `value` | entier | `percent` : 1 à 90. `amount` : 100 à 1 000 000 F (le montant appliqué ne dépasse jamais le sous-total) |
| `ends_on` | date | valable jusqu'à la fin de ce jour, heure d'Abidjan. Entre aujourd'hui et aujourd'hui + 365 jours |
| `max_uses` | 1 à 10 | 1 par défaut |
| `uses` | entier | décompté par mise à jour conditionnelle (1.5) |
| `created_by` | FK user, null | + `created_by_name` (copie, comme `ShopGoal.set_by_name`) |
| `created_at` | date-heure | |
| `revoked_at`, `revoked_by` | null | annulation : définitive |

Statut calculé, jamais stocké : `revoked` (annulée) › `used` (`uses ≥ max_uses`) › `expired` (`ends_on` passé) › `active`.

Calcul de la remise, sur le **sous-total des articles** (jamais sur la livraison) :
- `percent` : `sous-total × value ÷ 100`, arrondi au franc inférieur ;
- `amount` : `min(value, sous-total)`.

`Order` gagne (même migration) :
- `discount` (FK `Discount`, null, SET_NULL), `discount_code` (copie du code, vide sans réduction), `discount_amount` (entier, 0 par défaut) ;
- `channel` (voir 1.7).
- **total = sous-total − remise + livraison.** Le chiffre d'affaires du dashboard, des clients et de l'objectif somme déjà `total` : il devient le montant réellement payé, sans autre changement. Le CA par produit (`top_products`) reste au prix des lignes, avant remise.

### 1.2 Le code

- Préfixe : les 3 premières lettres du prénom du client, sans accents, en majuscules (« Ayaba Koné » donne `AYA`, « Élodie » donne `ELO`). Moins de 3 lettres ou pas de nom : complété par `X` (« Bi » donne `BIX`).
- Suite : 4 caractères tirés de `REFERENCE_ALPHABET` avec `secrets` (pas de 0, 1, I, L, O, U : pas de confusion au téléphone). 810 000 suites possibles par préfixe ; on retire en cas de doublon dans la boutique.
- À la saisie, le client peut écrire `aya 7k2q`, `AYA7K2Q` ou `aya-7k2q` : on garde lettres et chiffres, en majuscules, et on remet le tiret.
- **Pourquoi c'est assez sûr :** le code seul ne sert à rien. Il faut aussi le téléphone exact du client, et les essais sont limités par IP et par code (1.5).

### 1.3 Qui peut donner une réduction

Nouveau droit **`discounts.give`**. `GRANTABLE` devient `{team.manage_sellers, team.presence, storefront.edit, discounts.give}`.

| Qui | Peut | Limites vérifiées par le serveur |
|---|---|---|
| Propriétaire | toujours | toutes les valeurs de 1.1 |
| Gérant avec `discounts.give` | oui | `kind = percent` seulement (sinon 403 `discount_kind_forbidden`), `value ≤ discount_cap_percent` (sinon 403 `discount_cap_exceeded`, avec `limit`) |
| Gérant sans le droit, vendeur | jamais | 403 `permission_denied` |

`Membership.discount_cap_percent` (shops 0005) : entier de 1 à 90, null par défaut.
- `PATCH members/{id}` (propriétaire, reauth, inchangé) accepte `discount_cap_percent`. Il n'est accepté que si la cible est gérant, et il est **obligatoire** dès que `grants` contient `discounts.give` et que le gérant n'a pas encore de plafond (400 `cap_required`).
- Retirer `discounts.give`, ou repasser la personne vendeur, remet le plafond à null.
- L'audit `member_grants_changed` gagne le détail `discount_cap_percent` (`previous`, `new`).
- `GET members` ajoute `discount_cap_percent` aux gérants quand le lecteur a `shop.manage`. `/me/shops` l'ajoute pour soi (null sauf gérant avec le droit) : le front y règle le curseur.

Annuler : le propriétaire annule n'importe quelle réduction ; un gérant avec `discounts.give` annule seulement **celles qu'il a créées** (sinon 403).

### 1.4 Routes marchandes

**`GET /shops/{slug}/customers/{id}`** (droit `customers.view`, inchangé) gagne `discounts` : les 20 dernières, les actives d'abord.

```json
{ "id": "…", "code": "AYA-7K2Q", "kind": "percent", "value": 15, "label": "−15 %",
  "ends_on": "2026-11-30", "max_uses": 1, "uses": 0, "status": "active",
  "created_at": "…", "created_by": {"name": "Fatou Diallo", "is_you": false},
  "can_revoke": true }
```

- Sans `discounts.give`, le lecteur voit `"code": "AYA-••••"` : il peut dire au client qu'il a une réduction, mais pas l'utiliser à sa place avec le numéro qu'il voit sur la fiche.
- `can_revoke` n'est vrai que pour un code **en cours** (ni utilisé, ni expiré, ni annulé), et seulement pour qui peut l'annuler (voir ci-dessus).
- Un client sans réduction : `discounts: []`.

**`POST /shops/{slug}/customers/{id}/discounts`** (droit `discounts.give`, **reauth**).
- Corps : `{kind, value, ends_on, max_uses?}`.
- 404 si le client n'est pas dans la boutique.
- Limites : 30 par heure et par membre, 200 par jour et par boutique (`core.ratelimit.enforce`).
- Audit `discount_created` (S, WARNING), cible `("discount", id, code)`, détails `kind`, `value`, `max_uses`, `ends_on`, `customer` (nom).
- Réponse 201 : l'élément ci-dessus, code en clair, plus `customer: {name, phone}` pour préparer le message WhatsApp.

**`DELETE /shops/{slug}/discounts/{id}`** (droit `discounts.give`, pas de reauth : annuler protège).
- 404 hors de la boutique ; 403 pour un gérant qui n'en est pas l'auteur.
- Déjà annulée : 200, rien ne change (idempotent).
- Audit `discount_revoked` (S, INFO), même cible, détail `uses`.
- Réponse 200 : l'élément, `status: "revoked"`.

### 1.5 Vitrine

**`POST /storefront/{slug}/discounts/check`** (public, derrière le BFF), pour vérifier avant d'envoyer la commande.
- Corps : `{code, phone, items: [{product_id, quantity}]}` (mêmes règles que la commande).
- 200 : `{code, label, subtotal, discount_amount}`, où `label` vaut « −15 % » ou « −2 000 F ».
- **Une seule réponse d'échec**, quel que soit le cas (code inconnu, expiré, épuisé, annulé, ou lié à un autre numéro) : 400 `discount_invalid`, « Ce code ne fonctionne pas avec ce numéro. ». Même statut et même corps (hors `request_id`) ; un test les compare.
- Limites : 20 essais par heure et par IP (`discount_check:ip`), 5 par heure et par code (`discount_check:code`, clé `boutique:code`). Le compteur par code est le même pour la vérification et pour la commande.

**`POST /storefront/{slug}/orders`** gagne `discount_code` (facultatif) et `channel` (facultatif).
- Le code normalisé et le canal entrent dans les données canoniques : même `Idempotency-Key` et code différent donnent 409 `idempotency_conflict`.
- Dans la transaction de `place_order` :
  1. contrôle du code (même échec unique `discount_invalid`) ;
  2. calcul de la remise ;
  3. comparaison avec `expected_total`. Une différence donne 409 `price_changed`, avec `subtotal`, `discount_amount`, `delivery_fee` et `total` ;
  4. décompte : `Discount.objects.filter(pk=…, uses__lt=F("max_uses"), revoked_at__isnull=True, ends_on__gte=aujourd'hui).update(uses=F("uses") + 1)`. Zéro ligne mise à jour donne `discount_invalid`, et toute la commande est annulée (stock compris).
- Un code refusé fait échouer la commande, au lieu de l'envoyer sans remise : le client voit le prix qu'il attend, ou rien.
- Une commande annulée ensuite **ne rend pas** l'utilisation (pas de boucle commande, annulation, nouveau code). Le marchand peut en offrir une autre.
- Audit `order_placed` : détails en plus `discount_amount` et `channel` (le code reste dans la commande, pas dans le journal).
- Réponse 201 : `{reference, total, status, discount_amount}`.

**`POST /storefront/{slug}/track`** gagne `subtotal`, `discount_amount` et `delivery_fee`, sans le code.

### 1.6 Commandes, export

- `OrderSerializer` gagne `discount_code`, `discount_amount` et `channel` : la fiche commande affiche une ligne « Remise (AYA-7K2Q) ».
- Export CSV : trois colonnes, « Remise (F) », « Code de réduction » et « Canal », toujours via `excel_csv`.

### 1.7 Canaux de vente

- `Order.channel` : liste fermée `whatsapp`, `facebook`, `instagram`, `tiktok`, `sms`, `direct`, `autre`.
- À la commande : valeur absente ou vide → `direct`, valeur inconnue → `autre`, en minuscules. Jamais de texte libre.
- Commandes existantes : `autre` (on ne sait pas d'où elles viennent).
- La démo (`generate_demo_data`) répartit ses commandes sur les canaux (WhatsApp en tête, comme dans la vraie vie).
- `GET /dashboard` gagne `channels: [{channel, orders, revenue}]`, sur la période et hors annulées, comme `payment_methods`.

### 1.8 Front

**Offrir une réduction** : fiche client (`clients/[id]/page.tsx`) et chaque carte de fidèle (`LoyalCard`), visible avec `discounts.give`.
- Un panneau `<details>` dans le style de `NameVipForm`, avec `useActionState`, `ReauthFields` à la demande, et zod dans `features/customers/actions.ts` (`giveDiscount`, `revokeDiscount`). On y choisit :
  - le type, « En % » ou « En francs ». Le gérant n'a que « En % », avec un maximum égal à son plafond et la mention « En % seulement, jusqu'à 15 % : c'est votre plafond » (texte dans `lib/voice.ts`, en écriture neutre) ;
  - la valeur ;
  - la date de fin (30 jours par défaut) ;
  - le nombre d'utilisations (1 par défaut, 10 au plus).
- Après la création, le panneau montre :
  - le code ;
  - un bouton **« Envoyer sur WhatsApp »** : `wa.me/{numéro}?text=…`, avec le numéro renvoyé par la création (la carte de fidèle n'a que le numéro masqué) ;
  - « Copier le message ».
- Message, en écriture neutre : « Bonjour {prénom}, {boutique} vous offre −15 % avec le code AYA-7K2Q, jusqu'au 30 novembre. Il marche avec ce numéro. Commandez ici : {lien}?via=whatsapp ».
- La fiche ajoute une section « Ses réductions » : chaque ligne porte le code, la valeur, le statut en texte (en cours, utilisée, expirée, annulée), la date de fin et les utilisations. « Annuler » se fait en deux temps, et n'apparaît que si `can_revoke`.
- Couleurs des statuts :

  | Statut | Couleur |
  |---|---|
  | en cours | indigo |
  | utilisée | sable |
  | expirée | texte-3 |
  | annulée | corail |

**Pouvoirs du gérant** (`features/settings/member-row.tsx` et `grants.ts`).
- `discounts.give` rejoint la liste, avec le libellé « Offrir des réductions » et l'aide « En % seulement, jusqu'au plafond que vous fixez ».
- Quand la case est cochée, un champ « Plafond (%) » apparaît (de 1 à 90, 10 par défaut).
- L'action envoie `{grants, discount_cap_percent}`.
- « Pouvoirs en plus » affiche « réductions jusqu'à 15 % ».

**Vitrine** (`features/storefront/checkout.tsx`, `actions.ts`).
- Un lien « J'ai un code de réduction » ouvre le champ. Il a un vrai libellé, et le bouton « Vérifier » est utilisable au clavier.
- Le numéro de téléphone doit être saisi avant : sinon, le message « Indiquez d'abord votre numéro ».
- La Server Action `checkDiscount` appelle `discounts/check`. Le résultat est annoncé dans une zone `aria-live`.
- Un code accepté ajoute la ligne « Remise · AYA-7K2Q » au récapitulatif et met à jour le total et `expected_total`.
- Changer le numéro ou le panier retire la remise affichée, avec « Vérifiez à nouveau le code ».
- Le code part avec la commande (`discount_code`), et il entre dans la signature qui décide de la clé d'idempotence.
- La confirmation et le suivi (`track.tsx`) affichent sous-total, remise, livraison et total.

**Canal**.
- `StorefrontApp` lit `?via=` dans le navigateur, à l'arrivée : la page serveur ne change pas.
- La valeur est gardée dans `sessionStorage` (`akwaba:via:{slug}`, lecture protégée par try/catch). Liste fermée : une valeur inconnue devient `autre`, jamais le texte de l'adresse ; sans `?via=`, c'est `direct`.
- `Checkout` l'envoie en `channel`.

**Marchand**.
- Fiche commande (`order-detail.tsx`) : une ligne « Remise (AYA-7K2Q) » entre la livraison et le total, et « Venue de WhatsApp » près de la référence.
- Dashboard (`month-panel.tsx`) : l'onglet `paiements` devient `canaux`, « Canaux · D'où viennent les ventes ». Il a une tuile par canal, avec part du CA et barre : 4 tuiles au plus, donc les 3 premiers canaux puis « Autres » quand il y en a plus de 4. La part livraison / Mobile Money reste dans l'onglet Commandes, qui l'a déjà.
- Carte « Votre boutique est en ligne » (`share-card.tsx`) :
  - le lien WhatsApp ajoute `?via=whatsapp` ;
  - une ligne « Liens prêts » propose Facebook, Instagram, TikTok et SMS, chacun avec « Copier ».
  - Les noms des réseaux s'écrivent en texte : pas de logos de marque.

**Textes et types**.
- `lib/messages.ts` : `discount_invalid`, `discount_cap_exceeded`, `discount_kind_forbidden`, `cap_required`.
- `lib/types.ts` :
  - nouveau type `Discount` ;
  - `CustomerDetail.discounts` ;
  - `Order` gagne `discount_code`, `discount_amount` et `channel` ;
  - `PlacedOrder` et `TrackedOrder` gagnent la remise ;
  - `DashboardSummary.channels` ;
  - `Member` et `ShopMembership` gagnent `discount_cap_percent`.

### 1.9 Journal

| Action | Catégorie, gravité | Détails (liste blanche) |
|---|---|---|
| `discount_created` | Sécurité, à surveiller | `kind`, `value`, `max_uses`, `ends_on`, `customer` |
| `discount_revoked` | Sécurité, info | `uses` |
| `order_placed` (existant) | inchangé | + `discount_amount`, `channel` |
| `member_grants_changed` (existant) | inchangé | + `discount_cap_percent` |

Les réductions vont dans la catégorie Sécurité : de l'argent sort de la boutique, elles apparaissent donc dans la vue « Sensible » du journal et dans la carte de sécurité.

### 1.10 Tests prévus

- Droits :
  - propriétaire 201 ;
  - gérant sans droit 403, avec droit 201 en %, 403 au-dessus du plafond, 403 en montant ;
  - vendeur 403 ;
  - autre boutique 404 ;
  - un droit ou un plafond retiré vaut dès la requête suivante.
- Annulation : le propriétaire annule tout, un gérant seulement ses réductions, et annuler deux fois ne change rien.
- Vérification en vitrine : code inconnu, expiré, épuisé, annulé et autre numéro donnent la **même** réponse ; 429 au-delà des limites ; le compteur par code est partagé avec la commande.
- Commande :
  - le total recalculé ;
  - `price_changed` avec la remise ;
  - une réduction à 1 utilisation ne sert qu'une fois (deux commandes de suite : la seconde échoue, sans commande ni stock décompté) ;
  - même clé d'idempotence et autre code : 409.
- Canal : absent → `direct`, inconnu → `autre`, liste fermée.
- Suivi, export et dashboard montrent la remise et les canaux.

### 1.11 Décisions à valider

1. **Reauth pour offrir une réduction.** Je la propose : avec une session volée, on pourrait sinon distribuer des codes à −90 %. La confirmation dure 10 minutes : une série de codes ne la demande qu'une fois.
2. **Une commande annulée ne rend pas l'utilisation.**
3. **Les réductions sont ouvertes à tous les plans.** À dire si le plan Gratuit doit être limité.
4. **Code masqué** (`AYA-••••`) pour qui n'a pas `discounts.give`.

---

## Lot 2 : produit à la une et photos produit

Branche `claude/p5-une-photos`, **empilée sur `claude/p5-reductions-canaux`** : ses migrations (shops 0006, audit 0007) suivent celles du lot 1. Intégrer le lot 1, puis le lot 2.

### 2.1 Modèle (shops 0006)

- `Product.is_featured` (booléen, faux par défaut) : **un seul par boutique**, garanti par une contrainte unique conditionnelle `(shop) WHERE is_featured`. Le changement se fait dans une transaction : on retire l'ancien, puis on pose le nouveau.
- `ProductPhoto` :

  | Champ | Rôle |
  |---|---|
  | `id` | UUID aléatoire : c'est lui qui sert dans l'adresse de l'image |
  | `shop`, `product` | la boutique (pour `.for_shop()`) et le produit (suppression en cascade) |
  | `position` | 0, 1 ou 2 ; la photo 0 est la photo principale. Contrainte unique `(product, position)` |
  | `image` | l'image réencodée par le serveur (binaire en base, comme le logo) |
  | `version` | 12 caractères de l'empreinte SHA-256, pour l'adresse `?v=` |
  | `created_by`, `created_at` | qui l'a ajoutée, et quand |

- **3 photos au plus par produit**, pour tous les plans. La contrainte `(product, position)` empêche deux envois simultanés de dépasser la limite : le second reçoit 409.

### 2.2 La chaîne de l'image (celle du logo)

1. Le navigateur réduit la photo à **1 200 px** de côté au plus et l'envoie en JPEG : une Server Action accepte 1 Mo au plus. Si le fichier dépasse encore 900 Ko, il baisse la qualité.
2. Django la relit **d'après son contenu** (Pillow), jamais d'après son nom ni son type annoncé : PNG, JPEG et WebP seulement, 2 Mo et 25 millions de pixels au plus (bombe de décompression refusée avant décodage).
3. Il la **redessine entièrement** en WebP (qualité 80, 1 200 px au plus, orientation EXIF appliquée puis métadonnées retirées) : ni EXIF, ni GPS, ni contenu caché.
4. Elle est servie par Django avec `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`, puis **relayée par une route Next** (`/boutique/{slug}/photo/{id}?v=…`) qui vérifie le type et met un cache immuable quand l'adresse porte `?v=`.

### 2.3 Routes marchandes

| Route | Droit | Effet |
|---|---|---|
| `POST /shops/{slug}/products/{id}/photos` (multipart `photo`) | `products.write` | 201 `{id, version, position}` ; 409 `photo_limit` s'il y a déjà 3 photos ; 413 `file_too_large`, 415 `unsupported_file` |
| `DELETE /shops/{slug}/products/{id}/photos/{photo_id}` | `products.write` | 204 ; les photos suivantes remontent d'un rang |
| `PUT /shops/{slug}/products/{id}/photos/{photo_id}/main` | `products.write` | la photo devient la principale (position 0), les autres gardent leur ordre |
| `PUT /shops/{slug}/products/{id}/featured` | `storefront.edit` | met le produit à la une (remplace l'ancien) ; 409 `product_inactive` si le produit n'est pas en vente |
| `DELETE /shops/{slug}/products/{id}/featured` | `storefront.edit` | retire la une (idempotent) |

- Les envois de photos sont limités à **60 par heure et par membre** (`product_photo:member`).
- Une photo d'une autre boutique, ou d'un autre produit, répond 404. Un non-membre reçoit 404, un vendeur (sans `products.write`) 403.
- La fiche produit (`GET`/`PATCH products/{id}` et la liste) gagne `is_featured` et `photos: [{id, version}]` (dans l'ordre).
- Choisir la une relève de la vitrine (`storefront.edit`, propriétaire ou gérant à qui on l'a confié), pas du catalogue.

### 2.4 Vitrine

- `GET /storefront/{slug}` gagne `featured: {product_id, source}` ou `null`. Le produit de couverture est :
  1. le produit **à la une**, s'il est en vente et en stock (`source: "chosen"`) ;
  2. sinon le **plus vendu sur 30 jours** parmi ceux en vente et en stock, commandes annulées exclues (`"best_seller"`) ;
  3. sinon le **plus cher en stock** (`"price"`) ;
  4. sinon `null`.
- Chaque produit public gagne `photos: [{id, version}]`. La photo envoyée passe avant `image_url` (l'adresse externe, gardée).
- `GET /storefront/{slug}/photos/{photo_id}` : l'image WebP. L'identifiant est un UUID aléatoire : il n'est publié que pour les produits en vente, et seule l'équipe le connaît pour un produit masqué. Une photo d'une autre boutique répond 404.

### 2.5 Journal

| Action | Catégorie | Niveau | Détails |
|---|---|---|---|
| `product_featured` (« Produit mis à la une ») | boutique | info | `change` (`set` ou `removed`) ; la cible est le produit |

Les photos ne sont pas journalisées, comme les autres modifications d'une fiche produit.

### 2.6 Front

- **Fiche produit** (`produits/[id]`) : une section « Photos » avec 3 emplacements. Ajouter (réduction dans le navigateur, comme `logo-form.tsx`), « Mettre en premier », « Retirer » en deux temps. Chaque image a un texte alternatif (« Photo 1 de {produit} »).
- La fiche montre aussi « À la une sur la vitrine » (pour `storefront.edit`) : un interrupteur avec l'explication de la règle de repli (plus vendu, puis plus cher).
- **Liste des produits** : la vignette prend la première photo ; la ligne du produit à la une porte la mention « à la une », en texte.
- **Vitrine** : la couverture prend `featured` ; son sur-titre suit `source` (« À la une », « La plus demandée », « La pièce du mois »). Les cartes et la couverture affichent la première photo. Le nom du produit est écrit juste à côté : l'image garde un texte alternatif vide, pour ne pas faire lire le nom deux fois. Dans l'espace marchand, chaque photo a son texte (« Photo 1 de {produit} »).
- Les nouvelles Server Actions suivent les règles : `authedMutation`, zod, fichier « use server » sans export autre que des fonctions async.

### 2.7 Écarts et découverte

- **Bug du P4 corrigé : le logo ne s'affichait jamais par le relais Next.** Le BFF demande `Accept: image/png`, et DRF, qui ne connaît que le JSON, répondait 406 avant d'appeler la vue ; Next renvoyait alors 404. Les tests ne le voyaient pas, car ils n'envoyaient pas cet en-tête. `ImageResponseMixin` (`shops/images.py`) corrige le logo et les photos ; les tests envoient maintenant `Accept: image/png` et `image/webp`.
- La lecture sécurisée de l'envoi est sortie de `logo.py` vers `shops/images.py` (`open_upload`), partagée par le logo et les photos. Le comportement du logo ne change pas.
- La carte « Ce qui se vend le mieux » du dashboard et l'API publique à clé gardent `image_url` : elles ne montrent pas encore les photos envoyées.

### 2.8 Tests prévus

- Une seule une par boutique, même en en posant deux de suite ; le retrait est idempotent ; 409 pour un produit masqué ; un vendeur reçoit 403 ; une autre boutique 404.
- Photos : fichier qui n'est pas une image (415), SVG ou GIF (415), image trop grande en pixels (415), trop lourde (413) ; la 4ᵉ photo répond 409 ; l'image servie est un WebP sans EXIF ; `main` réordonne ; la suppression compacte les rangs ; une photo d'un autre produit ou d'une autre boutique répond 404 ; limite de débit.
- Couverture : produit choisi, puis repli sur le plus vendu (annulées exclues), puis sur le plus cher, puis `null`.

---

## Lot 4 : export des clients et « Livrées à temps »

Branche `claude/p5-export-delais`, **empilée sur `claude/p5-une-photos`** (migrations shops 0007, audit 0008). Le lot 3 viendra après validation de sa maquette : ses migrations seront numérotées à ce moment-là.

### 4.1 Export des clients

**`GET /shops/{slug}/customers/export?segment=all|loyal|new|win_back|at_risk`**
- Droit **`customers.export`** : le propriétaire l'a ; il peut le **confier à un gérant** (ajouté à `GRANTABLE`). Un vendeur ne l'a jamais.
- **Confirmation renforcée** (`require_reauth`) : le fichier contient tous les téléphones en clair. Limite : 10 exports par heure et par membre (`customers_export:member`).
- Fichier `excel_csv` (séparateur « ; », BOM, formules neutralisées), nommé `akwaba-{slug}-clients-{date}.csv`. Colonnes :

  | Colonne | Contenu |
  |---|---|
  | Nom | nom de fidèle donné par la boutique, sinon le dernier nom saisi |
  | Téléphone | en clair, `+225…` |
  | Ville, Commune | du dernier lieu de livraison |
  | Commandes, Livrées, Annulées | nombres |
  | Total dépensé (F), Panier moyen (F) | hors commandes annulées |
  | Première commande, Dernière commande | `JJ/MM/AAAA` |
  | Fidèle | « oui » ou « non » (seuil de la boutique, ou nommé par elle) |
  | Repères | « nouveau », « à relancer », « à risque », séparés par des virgules |

- Ordre : les plus gros clients d'abord. Le segment suit les filtres de la page Clients.
- Journal : **`customers_exported`** (« Clients exportés », sécurité, avertissement), détails `rows` et `segment`.
- Erreurs : segment inconnu → 400 ; non-membre → 404 ; droit manquant → 403 ; sans confirmation → 403 `reauth_required`.

### 4.2 Horaires de la commande (shops 0007)

- `Order.confirmed_at`, `shipped_at`, `delivered_at` (vides par défaut), remplis **au passage** dans le statut correspondant, une seule fois.
- Les commandes passées avant ce lot n'ont pas d'horaires : elles ne comptent pas dans la mesure ci-dessous. On ne les invente pas.
- La fiche commande (`GET orders/{id}`) les renvoie, avec `promised_hours` (le délai promis pour sa zone) et `delivery_hours` (le temps réel de la commande à la livraison, en heures, ou `null`).

### 4.3 Délai promis par zone (`delivery.py`)

| Zone | Délai promis |
|---|---|
| Grand Abidjan (toutes les communes d'Abidjan) | 24 h |
| Bingerville, Grand-Bassam | 48 h |
| Ailleurs (et lieu inconnu) | 72 h |

- Le délai court **de la commande à la livraison** : c'est ce que vit le client, confirmation comprise.
- La vitrine reçoit `delay_hours` avec chaque zone ; le choix de la commune l'affiche (« livrée sous 24 h »).

### 4.4 « Livrées à temps » (dashboard)

- `GET dashboard` gagne `on_time: {measured, on_time, average_hours}` : parmi les commandes de la période **livrées et horodatées**, combien l'ont été dans le délai promis, et le temps moyen.
- L'onglet « Commandes » remplace la tuile « Livrées » par **« Livrées à temps »** : la part à temps en grand, puis « 37 livraisons mesurées · 4 en retard » ; sans mesure, « Pas encore de livraison mesurée sur la période ».
- La fiche commande affiche l'heure de chaque étape sous la frise, et une fois livrée : « Livrée en 18 h · à temps (promis : 24 h) » ou « Livrée en 30 h · 6 h de retard ».
- Les données de démo reçoivent des horaires réalistes (environ 85 % à temps), tirés par un générateur aléatoire à part : le reste de la démo ne change pas.

### 4.5 Front

- Page Clients : bouton « Exporter » (si `customers.export`), sur le modèle de l'export des ventes : segment, confirmation renforcée à la demande, téléchargement dans le navigateur, mention « noté dans le journal de sécurité ».
- Mon personnel : le pouvoir « Exporter les clients » (« Fichier avec noms et téléphones, après confirmation de son identité »).

### 4.6 Le téléphone dans le CSV (décidé : « +225 »)

- Écrit tel quel, « +2250707… » serait lu par Excel comme une formule ; précédé d'une apostrophe (la neutralisation habituelle), Excel montre l'apostrophe.
- `core.spreadsheet.phone_cell` écrit donc la formule texte `="+2250707000001"` : Excel affiche le numéro exact, sans rien calculer. Elle n'est construite que pour un « + » suivi de chiffres seulement ; toute autre valeur retombe dans la neutralisation habituelle (test `SpreadsheetTests`).
- Appliqué aux deux exports : ventes et clients.

### 4.7 Tests prévus

- Export : propriétaire 200 avec reauth, 403 `reauth_required` sans ; gérant 403 puis 200 une fois le droit confié ; vendeur 403 ; autre boutique 404 ; segment inconnu 400 ; colonnes et ordre ; formule neutralisée dans un nom ; journal ; limite de débit.
- Horaires : remplis à chaque passage, jamais réécrits ; une annulation n'en remplit aucun.
- Délai : 24 / 48 / 72 h selon la zone ; « à temps » à la limite exacte ; commandes sans horaire ignorées ; annulées ignorées.

---

## Lot 5 : renouvellement des sessions (enquête)

Branche `claude/p5-sessions`, **empilée sur `claude/p5-export-delais`** (migration core 0001).

### 5.1 La question, et la réponse : oui

**Deux renouvellements simultanés avec le même refresh token arrivent tout le temps.** Quand l'access token (5 min) arrive à 30 s de sa fin, chaque requête du navigateur passe par `proxy.ts`, qui renouvelle avec le refresh du cookie : la navigation, les préchargements de liens, une Server Action, un deuxième onglet. Tant que le navigateur n'a pas reçu les nouveaux cookies, toutes ces requêtes portent le **même** refresh.

Côté Django, la course elle-même est bien tenue : `rotate_refresh` fait tourner le refresh par une mise à jour conditionnelle (`WHERE refresh_jti = <ancien>`). Une seule requête gagne ; les autres passent par la fenêtre de grâce de 10 s. **Mais trois défauts restaient**, tous reproduits :

| # | Défaut | Conséquence |
|---|---|---|
| 1 | Dans la fenêtre de grâce, la requête perdante ne recevait qu'un access token. Si la réponse **gagnante** se perd (requête annulée par le navigateur quand on change de page, réseau mobile coupé), le navigateur garde l'ancien refresh. | 5 minutes plus tard, l'ancien refresh revient hors de la fenêtre : Django y voit un **vol**, coupe la session et envoie l'e-mail « refresh réutilisé, vol probable ». Personne n'a rien volé. |
| 2 | Le compteur des limites de débit (`core/ratelimit.incr`, sur le cache en base de Django) **lit puis réécrit** la valeur : il n'est pas atomique. | 40 renouvellements simultanés passaient tous, pour une limite de 30. Surtout, **toutes** les limites de l'API se contournaient en envoyant des requêtes en parallèle : verrou du login après 5 échecs, essais de code 2FA, suivi de commande (4 chiffres à deviner), vérification des codes de réduction. |
| 3 | `proxy.ts` et `/session/renouveler` traitaient toute erreur autre que « réseau » comme une fin de session : un 429 ou un 5xx **effaçait les cookies**. | Une fois le défaut 2 corrigé, la limite de 30 par minute se met vraiment à jouer : 10 requêtes sur 40 renvoyaient au login. |

### 5.2 Correctif 1 : la fenêtre de grâce rend le refresh courant

Dans la fenêtre de grâce, Django renvoie maintenant **le refresh courant, réémis avec le même identifiant** (`jti`) que celui de la requête gagnante, en plus de l'access token. Quelle que soit la réponse qui arrive au navigateur, il repart avec un refresh valable.

- La détection de vol ne change pas : l'ancien refresh présenté **après** les 10 s coupe toujours la session (test `test_old_refresh_after_the_grace_period_is_still_theft`).
- Ce que ça coûte : quelqu'un qui aurait volé l'ancien refresh et s'en servirait dans les 10 s qui suivent la rotation légitime obtiendrait le refresh courant. Il le partagerait alors avec la vraie personne, et la rotation suivante révélerait la double utilisation. Avant, il obtenait déjà un access token de 5 minutes dans ce cas.
- Limite qui reste : une réponse perdue **sans** autre requête dans les 10 s (une seule requête en vol, annulée) laisse encore l'ancien refresh au navigateur. Allonger la fenêtre réduirait ce cas, au prix d'une détection de vol plus lente : je l'ai laissée à 10 s, à décider.

### 5.3 Correctif 2 : un compteur atomique

`core.RateCounter` (migration core 0001) remplace le cache pour les compteurs. `incr` fait **une seule requête** `INSERT … ON CONFLICT (bucket) DO UPDATE SET count = count + 1 … RETURNING count` : SQLite 3.35+ et PostgreSQL l'exécutent de façon atomique. Un compteur expiré repart à 1 ; une fois sur 200, les compteurs expirés sont effacés. Le verrou du login (`lockout.py`) remet ses échecs à zéro par `reset()`. Les appelants (`hit`, `enforce`, `incr`) ne changent pas.

### 5.4 Correctif 3 : une panne passagère ne déconnecte plus

`lib/server/refresh.ts` (`sessionIsOver`) : seuls 400, 401 et 403 mettent fin à la session. Sur une panne passagère (réseau, 429, 5xx) :
- `proxy.ts` laisse passer sans rien effacer ;
- `/session/renouveler` répond une page 503 simple (« Votre session est intacte… », boutons « Réessayer » et « Se reconnecter », `Retry-After`), sans redirection : la page renverrait sinon vers la route, en boucle.

### 5.5 Preuves

| Scénario (à travers Next et Django) | Avant | Après |
|---|---|---|
| 2 renouvellements simultanés, réponse gagnante perdue, nouvel essai 12 s plus tard | renvoi au login « session fermée » + alerte de vol | page servie |
| 40 renouvellements simultanés, même session | 40 acceptés par Django (limite 30 ignorée) | 30 acceptés, 10 refusés en 429 |
| Même rafale, compteur réparé, ancien proxy / proxy corrigé | 10 renvois au login, 10 refresh effacés | 0 renvoi, 0 effacement |
| `/session/renouveler` quand la limite est atteinte | déconnexion | 503, cookies intacts |

Tests Django : `accounts/tests/test_refresh_race.py` rejoue la course (le perdant lit la session avant que le gagnant écrive ; la réponse gagnante perdue ; le vol au-delà de la grâce ; une session fermée) ; `core/test_ratelimit.py` vérifie le compteur. La concurrence réelle du compteur ne se teste pas dans la suite : la base de test en mémoire de SQLite refuse les écritures parallèles. Elle est prouvée par la rafale ci-dessus, sur le serveur de développement (base fichier).

---

## Lot 3 : éditeur « Ma boutique » et thèmes par métier

Branche `claude/p5-ma-boutique`, **empilée sur `claude/p5-sessions`** (migrations shops 0008, audit 0009).

**Historique.** La maquette (https://claude.ai/artifact/LxB5w9VNKdu6jxobkaYxU1) a d'abord montré 3 thèmes, puis 10 thèmes aux noms de villes. Le retour du 22 octobre l'a écartée : des noms qui ne disent rien, et des thèmes pensés comme des idées visuelles au lieu de répondre à un métier. **Décision : un thème par métier, livré par vagues**, en commençant par ceux qu'Akwaba sait déjà servir. Les animations de la maquette sont reprises là où elles servent le métier.

### 3.1 Vague 1 : cinq thèmes

| Thème | Plan | Pour qui | Ce qui le distingue |
|---|---|---|---|
| **Essentiel** | Gratuit | toute boutique (c'est la vitrine actuelle, et le thème par défaut) | couverture façon magazine, produit en avant, collection en cartes |
| **Épicerie** | Gratuit | alimentation, produits du quotidien | bandeau du délai qui défile, recherche, rayons avec leur nombre, « les plus demandés », liste compacte avec la quantité sur place |
| **Beauté** | Pro | cosmétiques, karité, soins | fond sable, soleil et vagues, produits qui flottent, la description mise en avant |
| **Artisanat** | Pro | fait main, pièces uniques | toile écrue, dessins au trait qui se tracent, l'histoire de la boutique, « plus qu'une pièce » |
| **Pièce phare** | Pro | peu de produits, ou un lancement | grande image pleine page qui dérive, mots qui sortent du flou, grandes fiches |

**Vague 2, à venir avec leurs fonctions** (aucun n'est codé) :

| Thème | Il lui faut d'abord |
|---|---|
| Restaurant (ardoise et craie de la maquette « Maquis ») | options d'un plat, horaires, temps de préparation, livraison rapide |
| Mode | tailles et couleurs (variantes) |
| Sur commande | date de retrait, message du client |
| Produits du terroir | origine, producteur, poids |
| High-tech | caractéristiques, garantie |

### 3.2 La configuration (JSON fermé, validé par Django)

```json
{ "version": 1, "theme": "epicerie", "motion": "full", "cover": "featured",
  "sections": ["livraison", "demandes", "collection", "suivi"],
  "texts": { "tagline": "Le meilleur d'ici, livré en 24 h.", "story": "" } }
```

- `theme` : `essentiel`, `epicerie`, `beaute`, `artisanat` ou `piece-phare`.
- `motion` : `full`, `soft` ou `none`. Avec `soft`, les entrées restent mais rien ne bouge en boucle ; avec `none`, tout est immobile. `prefers-reduced-motion` passe toujours avant.
- `cover` : `featured` (le produit à la une, sinon le plus vendu) ou `name` (le nom seul).
- `sections` : un ordre choisi parmi `livraison`, `demandes`, `collection`, `histoire` et `suivi`, sans doublon. `collection` est obligatoire.
- `texts.tagline` : 80 caractères au plus. `texts.story` : 400 au plus. Les deux passent par `plain_text`.
- **Une clé inconnue est refusée** (400), au premier niveau comme dans `texts`.
- **La couleur reste dans Paramètres** (`Shop.accent`, déjà limitée par plan) : il n'y a qu'une seule source, l'éditeur la montre et y renvoie.

### 3.3 Brouillon, publication, versions

`StorefrontVersion` : boutique, numéro, configuration, état (`draft`, `published`, `archived`), qui, quand. Un seul brouillon et une seule version en ligne par boutique (contraintes uniques conditionnelles).

| Route (droit `storefront.edit`) | Effet |
|---|---|
| `GET shops/{slug}/storefront` | brouillon, version en ligne, thèmes avec `allowed`, limites du plan |
| `PUT …/storefront/draft` `{config}` | enregistre le brouillon (validé, plan vérifié) |
| `DELETE …/storefront/draft` | abandonne le brouillon (idempotent) |
| `POST …/storefront/publish` | le brouillon passe en ligne, l'ancienne version est archivée ; 409 `no_draft` sans brouillon |
| `GET …/storefront/versions` | versions en ligne et archivées |
| `POST …/storefront/versions/{n}/restore` | recopie la version `n` dans le brouillon |

- Limite : 120 enregistrements par heure et par membre.
- Pas de confirmation renforcée pour publier : une publication se défait en un clic, et elle est journalisée.
- Journal : `storefront_published` (numéro, thème) et `storefront_restored` (numéro).
- Vitrine publique : `GET storefront/{slug}` gagne `design` (la version en ligne, ou la configuration par défaut : Essentiel) et `popular` (les 3 produits les plus vendus sur 30 jours, en vente et en stock).

### 3.4 Limites par plan

| | Gratuit | Pro | Business |
|---|---|---|---|
| Thèmes | Essentiel, Épicerie | les 5 de la vague 1 | les 5, puis la vague 2 |
| Sections | celles du thème, dans son ordre | à choisir et ordonner | à choisir et ordonner |
| Notre histoire | non | oui | oui |
| Mouvement, couverture, accroche | oui | oui | oui |
| Versions gardées | 1 | 5 | 20 |

- Un thème non compris dans le plan s'essaie **en aperçu**, mais ne s'enregistre pas : 403 `plan_limit_reached`.
- Un plan qui baisse garde la vitrine en ligne telle quelle.

### 3.5 Front

- **Espace marchand** : une rubrique « Ma boutique » (`/app/{slug}/ma-boutique`, droit `storefront.edit`). On y trouve :
  - le choix du thème, du mouvement et de la couverture ;
  - les sections, avec leur ordre ;
  - l'accroche et l'histoire ;
  - les boutons « Enregistrer le brouillon », « Publier » et « Abandonner » ;
  - les versions, avec « Reprendre celle-ci » ;
  - **un aperçu en direct**, en téléphone ou en grand écran.
- **Aperçu** : `/apercu/{slug}?c=…`, réservé à qui a `storefront.edit` sur la boutique. Il reçoit la configuration dans l'adresse, la revalide avec zod et n'enregistre rien. Les commandes y sont désactivées. C'est la seule page qui peut s'afficher dans un cadre, et seulement depuis Akwaba (`X-Frame-Options: SAMEORIGIN`, `frame-ancestors 'self'`). Elle est en `noindex`.
- **Vitrine** : chaque thème a sa couverture, sa façon de montrer la collection et ses animations. Le panier, la commande et la confirmation sont communs.
- **Animations** : seulement `transform`, `opacity`, `clip-path` et le tracé des traits. Les entrées se jouent quand l'élément arrive à l'écran ; les boucles sont coupées en `soft`. Un nom découpé en lettres garde son `aria-label`.

### 3.6 Tests prévus

- Validation stricte : clé inconnue, thème inconnu, section en double, `collection` absente, textes trop longs, HTML.
- Plans : thème Pro, sections personnalisées et histoire refusés en Gratuit, puis acceptés en Pro.
- Cycle complet : brouillon, publication, archivage, versions gardées selon le plan, reprise d'une version (le plan est vérifié), 409 sans brouillon.
- Droits : vendeur 403, gérant 403 puis 200 avec `storefront.edit`, autre boutique 404.
- Vitrine publique : `design` par défaut puis publié, `popular`.
