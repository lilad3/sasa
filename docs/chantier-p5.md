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
| 1. Réductions et canaux de vente | `claude/p5-reductions-canaux` | **contrat à valider** |
| 2. Produit à la une et photos | `claude/p5-une-photos` | esquisse |
| 3. Éditeur « Ma boutique » | `claude/p5-ma-boutique` | esquisse (maquette d'abord) |
| 4. Export des clients et « Livrées à temps » | `claude/p5-export-delais` | esquisse |
| 5. Renouvellement des sessions | `claude/p5-sessions` | enquête |

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
  - le type, « En % » ou « En francs ». Le gérant n'a que « En % », avec un maximum égal à son plafond et la mention « Jusqu'à 15 %, plafond fixé par le propriétaire » (texte dans `lib/voice.ts`) ;
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
- La valeur n'est gardée que si elle est dans la liste fermée, dans `sessionStorage` (`akwaba:via:{slug}`, lecture protégée par try/catch).
- `Checkout` l'envoie en `channel`.

**Marchand**.
- Fiche commande (`order-detail.tsx`) : une ligne « Remise (AYA-7K2Q) » entre la livraison et le total, et « Venue de WhatsApp » près de la référence.
- Dashboard (`month-panel.tsx`) : l'onglet `paiements` devient `canaux`, « Canaux · D'où viennent les ventes ». Il a une tuile par canal (les 4 premiers, puis « Autres »), avec part du CA et barre. La part livraison / Mobile Money reste dans l'onglet Commandes, qui l'a déjà.
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

## Lots 2 à 5 : esquisses (détaillées avant chaque lot)

**Lot 2, produit à la une et photos.**
- `Product.is_featured` : un seul par boutique, basculé dans une transaction (contrainte unique conditionnelle).
- `ProductPhoto` : 1 à 3 par produit, stockées en base comme `ShopLogo`, avec la chaîne du logo (type lu d'après le contenu, réencodage Pillow, nom aléatoire, `nosniff`, CSP sandbox, relais par une route Next).
- La couverture prend le produit à la une, sinon le plus vendu sur 30 jours, sinon le plus cher en stock.

**Lot 3, éditeur « Ma boutique ».**
- D'abord la maquette de 3 thèmes, à valider avant tout code.
- Ensuite : un modèle `StorefrontVersion` (brouillon, versions publiées), une configuration JSON validée par un schéma fermé côté Django, et les limites par plan.
- Une clé `pages` dans la configuration, pour plus tard (fiche produit, panier, suivi), refusée tant qu'elle n'est pas codée.

**Lot 4, export des clients et délais.**
- `GET customers/export` : droit `customers.export` (accordable), reauth, `excel_csv`, audit `customers_exported`.
- `Order.confirmed_at`, `shipped_at` et `delivered_at`, remplis aux transitions. Délai promis par zone dans `delivery.py`. Carte « Livrées à temps ».

**Lot 5, renouvellement des sessions.**
- Lire `proxy.ts`, `lib/server/session.ts`, `app/session/renouveler/route.ts` et la fenêtre de grâce d'`accounts/sessions.py`.
- Reproduire deux renouvellements simultanés avec le même refresh token, puis corriger avec un test qui rejoue la course. Si la course n'est pas possible, expliquer pourquoi.
