# Chantier A2 : paiements et livraison par boutique (P05)

Base : `main`. Branche : `claude/a2-paiements-livraison`. Étape 1 : ce fichier est le contrat (validé par Kavin). Étape 2 : l'API est codée et testée, avec les changements imposés par la revue d'Alice (sections 10 et 11, qui **gagnent** sur le reste du texte en cas de désaccord). Étape 3 : le front.

Rappels communs (ceux de `chantier-p4.md` et `chantier-p5.md`) :
- migrations nouvelles seulement (shops 0009+, audit 0010+), vérifiées par `makemigrations --check`, code valable sur SQLite **et** PostgreSQL ;
- tout se décide côté serveur (`ShopScopedView`, `effective_permissions`), les données passent par `.for_shop()` ;
- non-membre : 404 ; droit manquant : 403 ;
- action sensible : `record()`, nouvelle action dans `audit/actions.py` et dans la liste blanche `DETAILS` d'`activity.py`, migration audit ;
- textes saisis : `plain_text` et longueurs max ; jamais de HTML ; listes fermées (`TextChoices`) ;
- erreurs : problem+json existant, code stable ; `contrat-api.md` (§3.2, §4.3, §4.4) est mis à jour **à l'étape 2**, avec le code.

| Étape | Contenu | État |
|---|---|---|
| 1 | Ce contrat + maquettes (`docs/maquettes/paiements-livraison/`) | à valider |
| 2 | API : modèles, migrations, routes, checkout, journal, tests | **faite** (branche `claude/a2-paiements-livraison`) |
| 3 | Front : pages Paramètres, checkout, confirmation, suivi | **faite** (branche `claude/a2-paiements-livraison`) |

Hors périmètre : API Mobile Money réelle (aucun paiement ne passe par Akwaba, le client paie le commerçant directement), livraison gratuite sous condition (P13), livreurs (P10).

---

## 0. Ce qui existe aujourd'hui (constat)

- `PaymentMethod` (5 valeurs) ; `StorefrontDetailView` les renvoie toutes, `CheckoutSerializer` accepte les 5 pour toute boutique. Aucun numéro nulle part : le front écrit « La boutique vous envoie la demande de paiement … au numéro indiqué ».
- `shops/delivery.py` : `ZONES` (15 zones) et `promised_hours(city)` en dur, partagés par toutes les boutiques. Lus par `find_zone` (checkout et `CustomerSerializer`), la vitrine, le dashboard (`_on_time`), la fiche commande (`promised_hours`), `demo.py`.
- Une commande garde `customer_city`, `customer_commune`, `delivery_fee` en copie : le prix et le lieu d'une commande passée ne dépendent d'aucune table. Cela reste vrai.
- `Shop` : pas de réglage de paiement ni de retrait. `create_shop_for_owner` (`shops/services.py`) crée la boutique.

---

## 1. Modèles et migrations

### 1.1 `ShopPaymentMethod` (shops 0009)

Une ligne par boutique et par moyen de paiement (5 lignes par boutique). Pas de JSON : chaque Mobile Money a ses propres champs, et la base peut contrôler ce qu'elle sait contrôler.

| Champ | Type | Règle |
|---|---|---|
| `id` | UUID | |
| `shop` | FK `Shop` (CASCADE) | `objects = ShopScopedQuerySet` ; `related_name="payment_methods"` |
| `method` | `PaymentMethod` | liste fermée. Contrainte d'unicité `(shop, method)` |
| `enabled` | booléen | le client peut le choisir au checkout |
| `payout_number` | 16 caractères, vide par défaut | numéro qui **reçoit** l'argent, forme `+225XXXXXXXXXX` (sortie de `normalize_phone`). Toujours vide pour `cash_on_delivery` |
| `payout_name` | 40 caractères, vide par défaut | nom affiché au client pour qu'il vérifie le titulaire avant de payer (« Aya Boutique »). `plain_text`, vide si pas de numéro |
| `updated_at`, `updated_by` | date-heure, FK user (SET_NULL, null) | |

Contraintes de base : `CheckConstraint` « `method = cash_on_delivery` implique `payout_number = ''` et `payout_name = ''` » (écrite avec `Q`, valable SQLite et PostgreSQL).

`MOBILE_MONEY = {orange_money, mtn_momo, moov_money, wave}` : constante de `models.py`, utilisée par le serveur et exposée au front par le champ `kind` (`cash` | `mobile_money`).

Règles que la base ne sait pas dire, tenues par le serveur **dans une transaction qui verrouille la boutique** (`lock_shop(shop)` = `Shop.objects.select_for_update()` : sans effet sur SQLite, qui sérialise déjà les écritures, nécessaire sur PostgreSQL pour éviter qu'une écriture croisée vide la liste) :
- au moins un moyen `enabled` ;
- un Mobile Money qui devient (ou reste) actif **avec un numéro ou un nom modifié** exige un numéro valide et un nom (voir 3.2). Un moyen actif sans numéro, déjà dans cet état avant la requête, reste toléré : c'est l'état des boutiques existantes.

**Boutique sans ligne** (créée avant le code, ligne manquante par accident) : lue comme « les 5 moyens acceptés, sans numéro », sans écriture. Un test le fixe.

**Nouvelles boutiques** (`create_shop_for_owner`) : 5 lignes créées, **seul `cash_on_delivery` actif** (décision 1 de la section 8). Raison : on ne propose pas à un client un Mobile Money dont le commerçant n'a pas donné le numéro.

### 1.2 `DeliveryZone` (shops 0009)

| Champ | Type | Règle |
|---|---|---|
| `id` | UUID | sert dans les adresses (`/delivery/zones/{id}`) |
| `shop` | FK `Shop` (CASCADE) | `objects = ShopScopedQuerySet` ; `related_name="delivery_zones"` |
| `city` | 60 caractères | `plain_text`, non vide, espaces recoupés. **Non modifiable après création** (décision 5) |
| `commune` | 60 caractères, vide permis | idem |
| `key` | 130 caractères | clé de doublon calculée par le serveur : `city\|commune` en minuscules, **sans accents**, tirets et espaces écrasés (« Port-Bouët » et « port bouet » donnent la même clé). Unicité `(shop, key)` |
| `fee` | entier positif | FCFA sans centimes, **0 à 100 000** |
| `delay_hours` | entier positif | délai promis, de la commande à la remise au client, **1 à 240 h** |
| `is_active` | booléen, vrai par défaut | une zone inactive est invisible et refusée |
| `position` | entier | ordre d'affichage, dense à partir de 0 dans la boutique |
| `created_at`, `updated_at` | date-heure | |

Propriétés reprises de l'ancien `Zone` : `id_label` (`"Abidjan|Cocody"` ou `"Bingerville"`, **identique** à l'ancien `Zone.id` pour que le front et les paniers en cours ne changent pas), `label` (« Cocody, Abidjan »).

`find_zone(shop, city, commune="")` : cherche par `key` dans les zones **actives** de la boutique. Elle accepte donc aussi « bouake » pour « Bouaké » (l'ancienne version ne passait que la casse) : plus tolérant, jamais plus permissif (elle ne renvoie que des zones actives de la boutique).

« Zone utilisée » : il existe une commande de la boutique avec `customer_city` et `customer_commune` égaux (comparaison exacte : le serveur a écrit ces textes lui-même à partir de la zone). Aucune clé étrangère sur `Order`, donc rien à reprendre sur les anciennes commandes.

Plafond de zones **par plan** (`plans.py`, `PlanSpec.delivery_zones`) : Gratuit 20, Pro 60, Business 150, inactives comprises (décision 4). Les 15 zones de départ tiennent dans tous les plans. `downgrade_blockers` gagne « N zones de livraison pour 20 ».

### 1.3 `Shop` : le retrait sur place (shops 0009)

| Champ | Type | Règle |
|---|---|---|
| `pickup_enabled` | booléen, faux | |
| `pickup_address` | 200 caractères | `plain_text`. Obligatoire si le retrait est actif |
| `pickup_hours` | 160 caractères | texte court (« Lun-Sam, 9 h-18 h »), `plain_text`, facultatif |
| `pickup_prep_hours` | entier, défaut 2 | délai de préparation, 1 à 168 h |

### 1.4 `Order` (shops 0009)

| Champ | Type | Règle |
|---|---|---|
| `fulfillment` | `delivery` \| `pickup` | `Fulfillment(TextChoices)` : « Livraison », « Retrait sur place ». Défaut `delivery` : toutes les anciennes commandes |
| `promised_hours` | entier, null | **copie** du délai promis au moment de la commande (null en retrait). Fixe le sens de « Livrées à temps » : changer un délai demain ne réécrit pas l'histoire (décision 3) |

En retrait : `customer_city = ""`, `customer_commune = ""`, `customer_landmark = ""`, `delivery_fee = 0`, `promised_hours = null`. La commande ne contient pas le numéro de paiement (lu en direct, voir 4.3).

### 1.5 Reprise des données (shops 0010 : migration de données seule)

Deux migrations, pas une : sur PostgreSQL, mélanger `ALTER TABLE` et mises à jour de lignes dans la même transaction peut échouer (« pending trigger events »).

`0010_reprise_paiements_livraison.py`, `RunPython(forward, noop)` :
1. **Livraison.** Pour chaque boutique qui n'a aucune `DeliveryZone`, copie **exacte** des 15 zones de `ZONES` avec : `city`, `commune`, `fee` identiques, `delay_hours` = ancien `promised_hours(city)` (24 / 48 / 72), `is_active = True`, `position` = rang dans `ZONES`, `key` calculée. Les 15 zones et la fonction de délai sont **recopiées dans le fichier de migration** (constantes figées), pas importées de `delivery.py` : la migration doit donner le même résultat dans deux ans, même si `delivery.py` a changé.
2. **Paiement.** Pour chaque boutique sans ligne : 5 lignes `enabled = True`, numéro et nom vides. Les boutiques existantes continuent d'accepter les 5 moyens.
3. **Commandes.** `promised_hours` = délai figé de la ville de la commande (24 / 48 / 72, 72 pour une ville inconnue, comme aujourd'hui), mis à jour **par ville distincte** (`UPDATE … WHERE customer_city = …`, au plus une dizaine de requêtes, pas une par commande). `fulfillment` prend son défaut `delivery`.
4. **Retrait** : `pickup_enabled = False` partout.

Propriétés : idempotente (une boutique qui a déjà ses zones ou ses lignes est sautée), `bulk_create(batch_size=500)`, par `iterator()` sur les boutiques, sans verrou long. Marche à l'envers (le retour supprime avec les tables).

**Preuve « identique à l'existant »** (test `MigrationExecutor`, état 0008 → 0010) : avant la migration, on enregistre pour 2 boutiques la réponse de `GET /storefront/{slug}` (zones, paiements) et le résultat de `_on_time` ; après la migration les `delivery_zones` sont **égales champ par champ et dans le même ordre**, `payment_methods` est égal, `_on_time` est égal, et le même panier donne le même total.

Les audits : `audit` 0010 ajoute les nouvelles actions au `choices` de `AuditEvent.action` (comme 0009).

### 1.6 `delivery.py` après le chantier

`ZONES` devient `DEFAULT_ZONES` : la liste de départ d'une **nouvelle** boutique (`create_shop_for_owner` la copie, comme aujourd'hui toutes les boutiques voient les mêmes zones). `promised_hours()` ne sert plus qu'à fixer ce défaut. `find_zone` change de signature (voir 1.2). Plus aucune lecture de `ZONES` dans le checkout, la vitrine, le dashboard ni la fiche commande.

---

## 2. Droits

| Qui | Paiements (lire, écrire) | Livraison et retrait (lire, écrire) |
|---|---|---|
| Propriétaire | oui, avec confirmation renforcée pour les numéros | oui |
| Gérant (avec ou sans pouvoirs en plus) | 403 | 403 |
| Vendeur | 403 | 403 |
| Non-membre | 404 | 404 |

Tout part de **`shop.manage`**, déjà absent de `GRANTABLE` : un test vérifie que `PATCH members/{id}` ne peut pas l'accorder. Aucun nouveau droit. Les droits sont relus à chaque requête (`ShopScopedView`).

---

## 3. Routes marchandes

Toutes sous `/api/v1/shops/{slug}/`, derrière `ShopScopedView`, `permission_by_method = shop.manage`.

### 3.1 `GET payment-settings`

```json
{
  "summary": "Livraison + Wave + Orange Money",
  "missing_numbers": 2,
  "methods": [
    { "method": "cash_on_delivery", "label": "Paiement à la livraison", "short": "Livraison", "kind": "cash",
      "enabled": true, "payout_number": "", "payout_name": "", "example": null },
    { "method": "wave", "label": "Wave", "short": "Wave", "kind": "mobile_money",
      "enabled": true, "payout_number": "+2250707123456", "payout_name": "Aya Boutique",
      "example": "Envoyez 12 500 F par Wave au +225 07 07 12 34 56 (Aya Boutique). Indiquez la référence K7F-92Q." }
  ]
}
```
- Les 5 moyens, dans l'ordre de `PaymentMethod.choices`. **`summary` suit cet ordre** (l'exemple « Livraison + Wave + Orange Money » du cahier des charges n'est qu'un exemple de forme, décision 9).
- `missing_numbers` : nombre de Mobile Money actifs sans numéro. Le front l'utilise pour la ligne ocre.
- `example` : le texte que verra le client, produit par **la même fonction serveur** que la confirmation (4.3) avec un montant et une référence d'exemple. Le front ne le compose jamais lui-même.
- Le numéro complet sort ici parce que le propriétaire doit le relire pour le corriger. Il ne sort ailleurs que dans la confirmation et le suivi (4.3).

### 3.2 `PUT payment-settings`

Remplace les 5 réglages d'un coup (pas de réponse partielle ambiguë, une seule transaction).

Corps : `{ "methods": [ {method, enabled, payout_number, payout_name}, … ] }` : exactement les 5 moyens, chacun une fois, sinon 400 `validation_error`.

Validation (ordre fixe) :
1. Forme (`ChoiceField` fermé, longueurs, `plain_text` sur le nom).
2. `payout_number` : `normalize_phone` (donc `+225` + 10 chiffres valides, sinon `invalid_phone`). Un numéro sur `cash_on_delivery` : 400 `payout_number_not_allowed`. Vide autorisé.
3. Au moins un moyen actif, sinon 400 `payment_methods_required` (« Gardez au moins un moyen de paiement. »).
4. Pour chaque Mobile Money **actif dont le numéro ou le nom change, ou qui vient d'être activé** : numéro obligatoire (`payout_number_required`) et nom obligatoire (`payout_name_required`). Un nom sans numéro : `payout_number_required`.
5. Si **un numéro ou un nom** diffère de l'état enregistré (ajout, changement ou retrait) : `require_reauth(request)` → 403 `reauth_required`. Activer ou désactiver un moyen sans toucher aux numéros ne demande pas la confirmation.
6. Comptes de démo : 403 `demo_restricted` (avant tout, comme les clés API).
7. Limite : `payout_change:shop` 10 changements de numéro par heure et par boutique (`core.ratelimit.enforce`, 429 `too_many_requests`) ; comptée à l'étape 5 seulement.

La confirmation passe **après** la validation (même ordre que `api_keys.py`) : une erreur de saisie ne coûte pas une confirmation, et rien n'est révélé à qui n'a pas confirmé.

Application, dans une transaction, boutique verrouillée : on compare avec l'état lu **sous verrou**, on écrit seulement les lignes qui changent, on enregistre `updated_by`. Aucun changement : 200, aucune ligne, aucun événement (idempotent).

Après la transaction (le journal est écrit avant l'e-mail, comme pour les clés API) :
- un événement `payout_number_changed` **par moyen dont le numéro ou le nom a changé** ;
- un événement `payment_methods_changed` si l'ensemble des moyens actifs change ;
- **un e-mail d'alerte** à chaque propriétaire de la boutique (pas seulement à l'auteur : un voleur de session ne s'écrit pas à lui-même) via `accounts.emails.send_security_alert`, une fois par requête, pas par moyen.

Réponse 200 : le même objet que le GET.

### 3.3 `GET delivery`

```json
{
  "summary": "12 zones · dès 1 500 F · Retrait sur place",
  "limits": { "zones": 60, "fee_max": 100000, "delay_min": 1, "delay_max": 240, "pickup_prep_max": 168 },
  "zones": [
    { "id": "…", "city": "Abidjan", "commune": "Cocody", "label": "Cocody, Abidjan", "fee": 1500,
      "delay_hours": 24, "is_active": true, "position": 0, "used": true }
  ],
  "pickup": { "enabled": true, "address": "Rue des Jardins, Cocody", "hours": "Lun-Sam, 9 h-18 h", "prep_hours": 2 }
}
```
- `summary` : « N zones » compte les zones **actives** (« 1 zone » au singulier) · « dès X F » = le plus bas des frais actifs, absent s'il n'y a aucune zone active · « Retrait sur place » seulement s'il est actif. Sans zone ni retrait : « Aucune livraison ».
- `used` : la zone a déjà servi (voir 1.2) ; le front n'affiche « Supprimer » que si `used` est faux. Le serveur vérifie de nouveau à la suppression.

### 3.4 `POST delivery/zones`

Corps : `{city, commune?, fee, delay_hours, is_active?}`. Réponse 201 : la zone.
- `city` 1 à 60, `commune` 0 à 60, `plain_text` ; `fee` entier 0 à 100 000 (`fee_out_of_range`) ; `delay_hours` entier 1 à 240 (`delay_out_of_range`).
- Doublon (même `key`) : 409 `zone_duplicate`.
- Plafond du plan : 403 `plan_limit_reached` avec `limit` (message « Votre plan Gratuit permet 20 zones de livraison. »). Compté sous verrou de boutique.
- `position` : à la fin.
- Journal `delivery_settings_changed`, `change = zone_added`.

### 3.5 `PATCH delivery/zones` (en une fois)

Corps : `{ "zones": [ {id, fee?, delay_hours?, is_active?}, … ] }`, 1 à 200 éléments, un `id` une seule fois. Seuls ces trois champs sont modifiables ; `city`, `commune`, `position` envoyés → 400 `validation_error` (champ non modifiable).
- Une seule transaction, boutique verrouillée : tout passe ou rien ne change.
- Un `id` hors de la boutique → 404 `not_found`, sans rien appliquer (même réponse pour un id inconnu).
- Après les changements, il faut une option de remise : au moins une zone active **ou** le retrait. Sinon 409 `no_fulfillment_option` (« Gardez au moins une zone active ou le retrait sur place. »).
- Journal : un événement `delivery_settings_changed` par zone modifiée (`zone_updated`, `zone_enabled` ou `zone_disabled`).
- Réponse 200 : l'objet du GET.

### 3.6 `DELETE delivery/zones/{id}`

- 404 hors de la boutique.
- Zone déjà utilisée par une commande : 409 `zone_in_use` (« Cette zone a déjà servi. Désactivez-la plutôt : les anciennes commandes la gardent. »).
- Dernière option de remise (dernière zone active sans retrait) : 409 `no_fulfillment_option`.
- 204. Les positions sont recompactées. Journal `zone_deleted`.

### 3.7 `PUT delivery/zones/order`

Corps : `{ "ids": [ … ] }` : exactement les identifiants des zones de la boutique, une fois chacun, sinon 400 `order_mismatch`. Réponse 200 : le GET. Le changement d'ordre n'est pas journalisé (il ne change aucun prix).

### 3.8 `PUT delivery/pickup`

Corps : `{enabled, address, hours, prep_hours}`. `address` obligatoire si `enabled` (`pickup_address_required`) ; `plain_text` ; `prep_hours` 1 à 168 ; désactiver le retrait alors qu'aucune zone n'est active : 409 `no_fulfillment_option`. Réponse 200 : le GET. Journal `delivery_settings_changed`, `change = pickup_changed` (détail `pickup_enabled`). Pas de confirmation renforcée (décision 7) : changer l'adresse de retrait ne fait pas sortir d'argent.

### 3.9 Limites de débit et sauvegardes

- Écritures de livraison : 60 par heure et par membre (`delivery_write:user`), pour freiner un script, large pour un humain.
- Les lectures ne sont pas limitées (propriétaire connecté).
- Aucun appel de ces routes ne renvoie de données d'une autre boutique : tout passe par `.for_shop(self.shop)`, jamais par un `shop` venu du corps.

---

## 4. Vitrine et commande

### 4.1 `GET /storefront/{slug}` (public)

- `payment_methods` : **seulement les moyens actifs**, forme inchangée `[{id, label}]`, même ordre qu'aujourd'hui. Les numéros n'y figurent **pas** (décision 2) : ils ne sont donnés qu'après une commande, avec sa référence.
- `delivery_zones` : **seulement les zones actives**, par `position`, forme inchangée `{id, city, commune, label, fee, delay_hours}` (le `delay_hours` vient maintenant de la zone). Vide si la boutique ne livre pas.
- `pickup` (nouveau) : `null` si le retrait est éteint, sinon `{address, hours, prep_hours}`.
- Rien d'autre ne change. L'ancien contrat reste lisible par le front actuel (les clés existantes ont la même forme).

### 4.2 `POST /storefront/{slug}/orders`

Le corps gagne **`fulfillment`** (facultatif, `delivery` par défaut ; liste fermée) :

| Cas | Comportement |
|---|---|
| `delivery` | `customer.city` obligatoire. `find_zone(shop, city, commune)` sur les zones **actives** ; sinon 400 `delivery_unavailable` sur `customer.city` (**inchangé**). Frais et délai pris dans la zone par le serveur. |
| `pickup` | Retrait éteint : 400 `pickup_unavailable`. Sinon `city`, `commune`, `landmark` sont ignorés et remplacés par des vides **avant** l'empreinte d'idempotence ; frais 0 ; `promised_hours` null. |
| autre valeur | 400 `validation_error` (`invalid_choice`). |

`CheckoutSerializer` reçoit la boutique dans son `context` (le contrôle de la zone, aujourd'hui dans `CustomerSerializer.validate`, passe par la boutique). La validation de zone se fait dans `CheckoutSerializer.validate` puisqu'elle dépend de `fulfillment`.

**Moyen de paiement.** Dans `place_order`, avant de calculer quoi que ce soit : si `payment_method` n'est pas actif dans la boutique → **400 `payment_method_unavailable`** (« Ce moyen de paiement n'est plus proposé par la boutique. »), avec `errors.payment_method` pour que le front place le message sur le champ. Contrôle lu **dans la transaction**, côté serveur, jamais à partir de ce que la vitrine affichait. Une boutique « Wave + livraison seulement » refuse `orange_money` même appelé directement.

Inchangé et conservé : calcul des prix et du total par le serveur, `expected_total` et 409 `price_changed` (avec `delivery_fee`), décompte conditionnel du code de réduction et du stock dans la même transaction, clé d'idempotence (`fulfillment` entre dans l'empreinte : 24 h après le déploiement, un rejeu d'une commande envoyée avant la mise en ligne donnerait 409 `idempotency_conflict`, acceptable). Une commande passée garde ses frais : `delivery_fee` et `promised_hours` sont des copies.

Réponse 201, nouveaux champs : `fulfillment`, `payment_method`, **`payment_instructions`** (4.3). Le rejeu idempotent renvoie la réponse enregistrée, **mais** `payment_instructions` est recalculé à chaque envoi à partir des réglages du moment : la réponse enregistrée ne contient jamais de numéro.

### 4.3 Instructions de paiement (texte venu du serveur)

Fonction unique `payment_instructions(shop, order_like)` (module `shops/payments.py`), appelée par la création de commande, le suivi et l'exemple de 3.1. Elle renvoie `null` pour `cash_on_delivery`, sinon :

```json
{
  "method": "wave", "label": "Wave",
  "number": "+2250707123456", "number_display": "+225 07 07 12 34 56",
  "holder": "Aya Boutique", "amount": 12500, "reference": "K7F-92Q",
  "text": "Envoyez 12 500 F par Wave au +225 07 07 12 34 56 (Aya Boutique). Indiquez la référence K7F-92Q."
}
```
- `amount` = `order.total` (déjà recalculé par le serveur, remise comprise). Jamais lu du corps.
- **Boutique existante sans numéro** : `number` et `holder` sont `null`, et le texte est « La boutique vous enverra la demande de paiement Wave au numéro indiqué lors de la commande. » (le comportement d'aujourd'hui, mais écrit par le serveur).
- Le numéro est lu **en direct** dans les réglages, pas copié dans la commande (décision 2b) : si le propriétaire corrige un numéro volé, les commandes encore à payer affichent le bon.
- Le suivi (`POST /track`) ajoute `fulfillment`, `payment_instructions` (seulement tant que la commande est `pending` ou `confirmed` ; ensuite `null`), et `pickup` (`{address, hours, prep_hours}` lu en direct) quand `fulfillment = pickup`. `delivery` reste `{city, commune}` (vides en retrait).
- Sécurité : les limites du suivi (référence + 4 chiffres, 5 essais par heure et par référence, 20 par IP) protègent déjà l'accès. Le numéro d'une boutique est de toute façon fait pour être donné à ses clients.

### 4.4 Autres lectures

- `OrderSerializer` gagne `fulfillment` : la fiche commande, la liste et l'**API publique par clé** (`/api/public/v1/orders`) montrent le mode. `OrderDetailSerializer.promised_hours` lit `order.promised_hours` (null en retrait).
- Export CSV des ventes : une colonne « Mode » (« Livraison » ou « Retrait sur place ») après « Statut ». `excel_csv` inchangé.
- Dashboard : `_on_time` lit `order.promised_hours` et **ignore les retraits** ; `_by_place` ignore les retraits (sinon un « lieu » vide). Aucun nouveau widget.
- `shops/demo.py` : la démo crée ses 5 réglages et ses zones comme une boutique neuve (copie de `DEFAULT_ZONES`), lit les zones **de la boutique** pour répartir ses commandes (les poids restent attachés à l'ordre des zones de départ ; une zone ajoutée a le poids 1), n'utilise que les moyens actifs, et crée environ 10 % de commandes en retrait si le retrait est actif. La démo n'écrit aucun numéro de réception.

---

## 5. Journal et alerte

| Action | Catégorie, gravité | Libellé | Détails (liste blanche `DETAILS`) |
|---|---|---|---|
| `payout_number_changed` | Sécurité, **à surveiller** | Numéro de réception modifié | `method`, `previous_last2`, `new_last2`, `name_changed` |
| `payment_methods_changed` | Sécurité, info | Moyens de paiement modifiés | `enabled`, `disabled` (listes de codes de moyens) |
| `delivery_settings_changed` | Sécurité, info | Livraison modifiée | `change`, `zone`, `previous_fee`, `fee`, `previous_hours`, `hours`, `pickup_enabled` |

- `previous_last2` et `new_last2` : **les deux derniers chiffres seulement**, texte de 2 caractères, `null` si le numéro n'existait pas ou a été retiré. Le numéro entier n'entre ni dans `metadata`, ni dans les journaux applicatifs, ni dans un message d'erreur, ni dans une URL. Un test parcourt les `AuditEvent` créés et vérifie qu'aucun contient le numéro.
- Cible : `("payment_method", id de la ligne, libellé du moyen)` ; pour la livraison `("delivery_zone", id, label)`.
- `change` ∈ `zone_added`, `zone_updated`, `zone_enabled`, `zone_disabled`, `zone_deleted`, `pickup_changed`.
- Ils vont dans la catégorie **Sécurité** : vue « Sensible » du journal et carte de sécurité, parce que de l'argent entre ou sort différemment. Les mots « à surveiller » du journal viennent de la gravité `WARNING`.
- Migration `audit/0010_evenements_paiements_livraison.py` (choix de `AuditEvent.action`).
- Les événements ne sont écrits qu'**après** la réussite de la transaction (comme `record()` aujourd'hui), pour qu'un échec ne laisse pas d'événement faux.

**E-mail d'alerte** (`send_security_alert`). Aujourd'hui `ALERTS[action]` ne porte qu'un texte fixe. Il gagne `**context` (compatibilité des appels existants) : l'entrée `payout_number_changed` est un gabarit qui reçoit le nom de la boutique et la liste « Wave : ••••56 → ••••34 ». Sujet : « Un numéro de paiement a changé sur {boutique} ». Corps : ce qui a changé (moyen et deux derniers chiffres, jamais le numéro entier), quand, appareil, IP, puis la phrase habituelle « Ce n'était pas vous ? Changez votre mot de passe… » et le lien vers la page Paiements. Un échec d'envoi est journalisé (`logger.exception`) mais **ne défait pas** le changement : le journal Sécurité reste la trace.

---

## 6. Codes d'erreur (ajouts à `contrat-api.md` §3.2)

| Code | Statut | Quand |
|---|---|---|
| `payment_method_unavailable` | 400 | le moyen choisi n'est pas actif dans cette boutique |
| `pickup_unavailable` | 400 | retrait demandé, retrait éteint |
| `delivery_unavailable` | 400 | **inchangé** : zone inconnue ou désactivée (champ `customer.city`) |
| `price_changed` | 409 | **inchangé** |
| `payment_methods_required` | 400 | aucun moyen actif |
| `payout_number_required` / `payout_name_required` | 400 | Mobile Money actif sans numéro / sans nom |
| `payout_number_not_allowed` | 400 | numéro sur le paiement à la livraison |
| `invalid_phone` | 400 | `normalize_phone` refuse (code existant) |
| `reauth_required` | 403 | numéro ou nom changé sans confirmation récente (existant) |
| `demo_restricted` | 403 | compte de démo (existant) |
| `too_many_requests` | 429 | limites de 3.2 et 3.9 (existant) |
| `zone_duplicate` | 409 | même ville et commune qu'une zone existante |
| `zone_in_use` | 409 | suppression d'une zone qui a déjà servi |
| `no_fulfillment_option` | 409 | plus aucune zone active ni retrait |
| `fee_out_of_range` / `delay_out_of_range` | 400 | frais hors 0-100 000 F, délai hors 1-240 h |
| `pickup_address_required` | 400 | retrait actif sans adresse |
| `order_mismatch` | 400 | liste d'ordre incomplète ou avec un intrus |
| `plan_limit_reached` | 403 | plafond de zones du plan (existant, avec `limit`) |
| `invalid_characters` | 400 | `<` ou `>` dans un texte (existant) |

---

## 7. Front (pour Marc)

Le front reste en BFF : les appels partent des Server Actions et des pages serveur (`lib/server/…`), jamais du navigateur vers Django. Palette nuit, lumière orange, indigo, ocre (texte encre), corail ; **pas de vert, pas de blanc pur**. Pas de pastille décorative, pas de dégradé violet-bleu, pas de notification verte, pas de rangée de cartes identiques. Les confirmations sont une ligne de texte `role="status"` dans le formulaire.

Maquettes : `docs/maquettes/paiements-livraison/index.html` (HTML autonome, 4 écrans, ouvrable sans serveur). Les écrans qui suivent les décrivent ; en cas d'écart, **le texte de cette section gagne**.

### 7.1 Fichiers

- Pages : `src/app/app/[shop]/parametres/paiements/page.tsx`, `src/app/app/[shop]/parametres/livraison/page.tsx` (+ `loading.tsx`, `error.tsx` comme les autres pages).
- `src/features/settings/` : `payments-form.tsx`, `payments-actions.ts` (zod), `delivery-zones.tsx`, `zone-row.tsx`, `add-zone-form.tsx`, `pickup-form.tsx`, `delivery-actions.ts` (zod), `setup-links.tsx` (les deux lignes de la page Paramètres), `data.ts` (`getPaymentSettings`, `getDelivery`).
- `src/features/storefront/` : `checkout.tsx` (mode de remise, moyens, récapitulatif), `fulfillment-choice.tsx`, `payment-instructions.tsx` (confirmation **et** suivi), `track.tsx`, `themes/parts.tsx` (`deliveryGroups`, `paymentLine`).
- `src/features/orders/order-detail.tsx` (mode de la commande).
- `src/lib/` : `types.ts`, `messages.ts`, `voice.ts`.
- Réutiliser : `ReauthFields`, `FormAlert`, `Field`, `Button`, `formatFcfa`, `formatNumber`.

### 7.2 Page Paramètres : deux lignes d'entrée

Sous l'onglet « Boutique », avant les formulaires, deux lignes pleine largeur (des liens, pas des cartes) :

```
Paiements    Livraison + Wave + Orange Money                          >
Livraison    12 zones · dès 1 500 F · Retrait sur place               >
```
- Le texte de droite est `summary` du serveur, tel quel.
- Si `missing_numbers > 0`, la ligne Paiements passe en **fond ocre, texte encre**, et sa seconde ligne dit « Ajoutez vos numéros Mobile Money ». Le sens ne repose pas sur la couleur : le texte le dit.
- Si le plan n'a plus de place ou s'il n'y a ni zone ni retrait : la ligne Livraison dit « Aucune livraison » avec le même fond ocre et « Ajoutez une zone ou le retrait sur place ».
- Un gérant ou un vendeur n'arrive jamais ici (la page est déjà « Réservé au propriétaire »). Une adresse tapée à la main sur `/parametres/paiements` ou `/livraison` affiche le même écran « Réservé au propriétaire » (le 403 de Django n'est jamais montré brut).

### 7.3 `/app/{shop}/parametres/paiements`

**En-tête** : nom de la boutique, titre « Paiements », une phrase : « Choisissez comment vos clients peuvent payer. Pour un Mobile Money, donnez le numéro qui reçoit l'argent : il s'affiche au client après sa commande. »

**Liste de 5 lignes**, dans l'ordre du serveur. Chaque ligne a un interrupteur (vraie case à cocher, `role="switch"`, étiquette cliquable) :
- *Paiement à la livraison* : « Le client paie à la réception. » Rien d'autre.
- *Wave, Orange Money, MTN MoMo, Moov Money* : interrupteur. Actif, la ligne s'ouvre sur deux champs :
  - « Numéro qui reçoit les paiements » : `type="tel"`, `inputmode="tel"`, `autocomplete="off"`, préfixe fixe « +225 » à gauche, saisie libre « 07 07 12 34 56 » (espaces permis, le serveur normalise), aide « Le numéro Wave ou Mobile Money de votre commerce » ;
  - « Nom affiché au client » : 40 caractères, aide « Le client le compare avec le nom qui s'affiche chez son opérateur avant de payer. Exemple : Aya Boutique ».
  - Dessous, « Ce que verra votre client » : le `example` du serveur, en texte lisible (pas en capture).
- Un moyen actif sans numéro (boutique existante) : champ vide, aide ocre (texte encre) « Sans numéro, le client verra seulement que la boutique le contactera. »
- Désactiver le dernier moyen actif : l'interrupteur se bloque et dit « Gardez au moins un moyen de paiement » (le serveur dit non aussi).

**Bouton** « Enregistrer les paiements ». Un seul formulaire pour les 5 lignes (`PUT` complet).

**Changer un numéro** : dès qu'un numéro ou un nom diffère de l'enregistré, un bloc apparaît au-dessus du bouton :
> « Vous changez le numéro qui reçoit l'argent de vos clients. Pour votre sécurité, confirmez que c'est bien vous. Nous le notons dans le journal et nous vous écrivons par e-mail. »

avec `ReauthFields` (mot de passe ou code 2FA). Si le serveur répond 403 `reauth_required` (confirmation expirée), le même bloc s'ouvre et le message est « Confirmez votre identité pour continuer. », sans perdre la saisie. Après le succès : ligne de statut « Enregistré à 14 h 32. », et le bloc de confirmation se referme. Texte de l'écran en neutre sur le genre, au « vous » du propriétaire (`voice.ts`).

**États** : chargement (squelette de 5 lignes) ; erreur de chargement (message + « Réessayer ») ; erreur de champ (message sous le champ, `aria-invalid`, `aria-describedby`, focus sur le premier champ en erreur) ; `demo_restricted` (« Cette action est désactivée sur le compte de démonstration. ») ; 429 (« Trop de changements d'affilée. Réessayez dans {n} min. »).

### 7.4 `/app/{shop}/parametres/livraison`

**En-tête** : « Livraison », phrase « Les zones où vous livrez, ce que cela coûte et en combien de temps. Le client ne voit que les zones actives. » Le résumé du serveur sous le titre.

**Zones** : une liste groupée par ville (titre de groupe = la ville ; la zone sans commune est une ligne du groupe qui porte le nom de la ville). Chaque ligne : le nom (commune ou ville), champ « Frais (F) », champ « Délai (h) », interrupteur « Active » ; boutons « Monter » et « Descendre » (nommés : « Monter Cocody » pour le lecteur d'écran, pas de glisser-déposer seul) ; « Supprimer » seulement si `used` est faux, en deux temps (« Supprimer Cocody ? » avec « Oui, supprimer » / « Annuler »). Une zone qui a servi montre « A déjà servi : désactivez-la plutôt ».
- Les champs numériques : `inputmode="numeric"`, bornes affichées en aide (« 0 à 100 000 F », « 1 à 240 h »). Erreur de valeur affichée sur la ligne.
- Une zone inactive est grisée en texte (`texte-3`) et dit « Inactive » : le sens ne dépend pas que de la couleur.
- Un seul bouton « Enregistrer les zones » pour toutes les lignes modifiées (`PATCH delivery/zones`) ; il n'est actif que s'il y a un changement ; le texte « 3 zones modifiées » le précède. Reste en place si le serveur refuse (rien n'est appliqué, le message dit pourquoi).
- Le changement d'ordre se fait par `PUT zones/order` au clic sur « Monter/Descendre », sans passer par « Enregistrer ».

**Ajouter une zone** : un panneau `<details>` « Ajouter une zone » : Ville, Commune (facultative), Frais (F), Délai (h). Doublon : « Cette zone existe déjà. » Plafond : « Votre plan Gratuit permet 20 zones. » avec un lien vers le plan. Un compteur « 12 sur 20 » (le `limits.zones` du serveur).

**Retrait sur place** : section à part, un interrupteur « Proposer le retrait sur place » ; actif : « Adresse de retrait » (obligatoire), « Horaires » (facultatif, ex. « Lun-Sam, 9 h-18 h »), « Délai de préparation (h) » (défaut 2), bouton « Enregistrer le retrait ». Aide : « Pas de frais de livraison pour un retrait. »

**Garde-fou** : si l'on désactive la dernière zone active sans retrait, le bouton dit « Gardez au moins une zone active ou le retrait sur place » (le serveur dit aussi non).

### 7.5 Vitrine : commande

- **Mode** : si la boutique propose les deux, un groupe de deux boutons radio en tête du formulaire, « Comment voulez-vous recevoir votre commande ? » : « Livraison » / « Retrait sur place ». S'il n'y en a qu'un, le choix est masqué et la phrase le dit. `delivery_zones` vide et `pickup` null : la vitrine affiche « La boutique ne prend pas de commande pour le moment » (le serveur refuserait de toute façon).
- **Livraison** : `ZonePicker` inchangé (il reçoit les zones actives), champ repère. **Retrait** : la zone et le repère disparaissent ; un encadré (texte, pas carte) : « Retrait à {adresse} », « Horaires : {horaires} » si renseignés, « Prête sous {n} h ». Ligne du récapitulatif « Retrait sur place · 0 F ». `expected_total` recalculé avec la remise et 0 F.
- **Moyens** : seulement ceux de `payment_methods`. S'il n'y en a qu'un, il est coché d'office. Texte d'aide pour un Mobile Money : « Après votre commande, vous verrez le numéro auquel payer et la référence à indiquer. » Pour la livraison : « Vous paierez à la réception de la commande. » ; en retrait : « Vous paierez au retrait. »
- **Erreurs** : `payment_method_unavailable` → sous le choix de paiement, « Ce moyen de paiement n'est plus proposé par la boutique. Choisissez-en un autre. », et la vitrine se rafraîchit (`router.refresh()`) pour retirer le moyen ; `pickup_unavailable` → « Le retrait sur place n'est plus proposé. » ; `delivery_unavailable` → inchangé (« Nous ne livrons pas encore cette zone. »).
- **Confirmation** (`Receipt`) et **suivi** (`track.tsx`) : `payment-instructions.tsx`, un bloc où **le texte est celui du serveur** (`payment_instructions.text`), jamais recomposé. Autour : titre « Il reste à payer 12 500 F » ; le numéro et la référence en grand (`font-mono`) ; boutons « Copier le numéro » et « Copier la référence » (annonce `aria-live` « Numéro copié ») ; le nom du titulaire. Pas de numéro (boutique sans numéro) : le texte du serveur seul, sans boutons. Paiement à la livraison : « Vous paierez 12 500 F à la livraison. » / « au retrait. ». Retrait : l'adresse et les horaires remplacent la ligne « Livraison : zone ».
- `themes/parts.tsx` : `deliveryGroups(shop)` lit les zones **actives** (déjà le cas, puisque le serveur n'envoie plus que celles-là) et ne plante pas si la liste est vide ; une ligne « Retrait sur place : prêt sous {n} h » s'ajoute si `shop.pickup`. `paymentLine(shop)` est inchangée (elle lit `payment_methods`, donc les moyens actifs).
- « Livrées à temps » (tableau de bord) : aucune modification du front ; le serveur lit le délai de la boutique.

### 7.6 Espace marchand : commandes

`order-detail.tsx` : près de la référence, « Livraison » ou « Retrait sur place » ; en retrait on masque ville, commune et repère, la ligne de frais disparaît, et le délai promis aussi. Le CSV et l'export suivent le serveur (colonne « Mode »).

### 7.7 Types, textes, accessibilité

- `lib/types.ts` : `PaymentSetting`, `PaymentSettings`, `DeliveryZone`, `DeliverySettings`, `Pickup`, `Fulfillment`, `PaymentInstructions`, `PlacedOrder.payment_instructions`, `TrackedOrder.{fulfillment,payment_instructions,pickup}`, `Order.fulfillment`, `Storefront.pickup`.
- `lib/messages.ts` : tous les codes de la section 6 avec leur texte.
- `lib/voice.ts` : `payoutChangeWarning`, `payoutsMissing` (« Ajoutez vos numéros Mobile Money »), `deliveryNone`. Écriture neutre sur le genre.
- Accessibilité : chaque champ a un vrai libellé ; les erreurs sont reliées par `aria-describedby` ; le focus va au premier champ en erreur après un refus ; tout se fait au clavier ; contraste du texte encre sur ocre vérifié ; le mouvement respecte `prefers-reduced-motion` ; aucune information portée par la couleur seule.
- Sécurité côté front : aucun numéro ni nom n'est écrit dans une adresse, un `localStorage` ou un journal du navigateur ; le texte serveur est affiché comme texte (jamais `dangerouslySetInnerHTML`).

---

## 8. Tests prévus

**Paiements (API)**
- Boutique Wave + livraison seulement : `orange_money` → 400 `payment_method_unavailable`, **sans commande ni stock décompté**, et même refus en appel direct (sans passer par la vitrine) ; `wave` passe.
- `GET /storefront` ne montre que les moyens actifs et ne contient jamais de numéro.
- Droits : propriétaire 200 ; gérant (avec toutes les `grants` possibles) 403 ; vendeur 403 ; autre boutique 404 ; `PATCH members` ne peut pas accorder `shop.manage`.
- Numéro modifié **sans** reauth : 403 `reauth_required`, rien n'est écrit, aucun événement, aucun e-mail. **Avec** reauth : écrit, événement `payout_number_changed` (gravité WARNING), un e-mail à chaque propriétaire.
- Le numéro entier n'apparaît ni dans `AuditEvent.metadata`, ni dans le corps de l'e-mail, ni dans un message d'erreur ; l'événement ne contient que les 2 derniers chiffres.
- Numéros invalides (`0607…`, 9 chiffres, lettres, `<script>`) → `invalid_phone` ou `invalid_characters` ; un numéro sur le paiement à la livraison → `payout_number_not_allowed` ; nom trop long ou avec `<` refusé.
- Activer ou désactiver un moyen sans toucher aux numéros : pas de reauth ; aucun moyen actif : `payment_methods_required`.
- Un moyen actif sans numéro préexistant reste enregistrable tant qu'on n'y touche pas ; le toucher exige numéro et nom.
- Compte de démo : 403 `demo_restricted`. Limite : le 11e changement de numéro de l'heure → 429.
- Un `PUT` sans changement ne crée ni événement ni e-mail.
- Après la commande Mobile Money : `payment_instructions` donne le bon numéro, le **total serveur** (remise comprise) et la bonne référence ; le suivi les redonne tant que la commande est en attente ou confirmée, pas après ; un numéro corrigé se voit sur une commande déjà passée ; boutique sans numéro : texte de repli ; paiement à la livraison : `null`.
- Le rejeu idempotent ne renvoie pas un numéro périmé.
- Course PostgreSQL (marquée, ignorée sur SQLite) : deux `PUT` simultanés qui désactiveraient chacun un des deux derniers moyens ne vident pas la liste.

**Livraison (API)**
- **Isolation** : Cocody à 2 000 F dans la boutique A ne change rien dans la boutique B (vitrine, checkout, total) ; une zone ajoutée dans A est introuvable dans B ; un `id` de zone de B donné à A → 404.
- **Zone désactivée** : refusée au checkout par un appel direct (400 `delivery_unavailable`), invisible dans la vitrine, mais la commande déjà passée garde ses frais et son lieu.
- Une modification de frais n'altère pas les commandes passées (`delivery_fee`, `total`) ; le prix affiché périmé donne 409 `price_changed` avec les nouveaux frais.
- **Retrait** : sans frais, `total = sous-total − remise`, `fulfillment = pickup`, lieu vide, `promised_hours` null ; retrait éteint → `pickup_unavailable` ; ville envoyée avec un retrait ignorée (même empreinte d'idempotence) ; `delivery` par défaut quand `fulfillment` est absent.
- Création : doublon (casse, accents, tiret) → `zone_duplicate` ; texte avec `<` refusé ; frais -1, 100 001, texte, flottant → `fee_out_of_range` ; délai 0 et 241 → `delay_out_of_range` ; plafond du plan → `plan_limit_reached` ; `city` non modifiable.
- Suppression : zone jamais utilisée → 204 ; zone utilisée → `zone_in_use` ; dernière option → `no_fulfillment_option`.
- `PATCH` en lot : atomique (un `id` étranger → rien n'est appliqué, 404) ; un événement par zone modifiée ; sans changement, aucun événement.
- Dashboard : « Livrées à temps » lit `promised_hours` de la commande (délai de la boutique) ; un retrait n'y compte pas ; changer le délai d'une zone ne réécrit pas les anciennes commandes.
- Droits : propriétaire 200, gérant 403, vendeur 403, autre boutique 404.
- API publique par clé et export CSV : le mode apparaît.
- Journal : `delivery_settings_changed` avec la liste blanche seulement.

**Migration**
- **Identique à l'existant** (`MigrationExecutor`, 0008 → 0010) : chaque boutique reçoit les 15 zones, mêmes `city`, `commune`, `fee`, `delay_hours`, même ordre, toutes actives ; 5 moyens actifs sans numéro ; chaque commande a `fulfillment = delivery` et `promised_hours` égal à l'ancien `promised_hours(city)` ; `GET /storefront` et `_on_time` avant/après sont égaux ; la migration rejouée ne duplique rien ; `makemigrations --check` propre ; `migrate` sur SQLite et sur PostgreSQL (jeu d'intégration de la CI).
- Plafond du plan Gratuit (20) ≥ 15 zones de départ.
- `create_shop_for_owner` : 5 lignes (seul le paiement à la livraison actif), 15 zones.
- `demo.py` : la démo respecte les zones et les moyens actifs de la boutique.

**Front (étape 3)**
- Composants : formulaire de paiements (bloc de confirmation, erreurs, dernier moyen), lignes de zones (bornes, suppression en deux temps, ordre), choix du mode, bloc d'instructions (texte du serveur affiché tel quel, copie).
- Vérification dans le navigateur (Playwright, déjà installé) : une boutique avec un seul moyen ; le retrait ; le texte de confirmation ; contraste de l'ocre ; clavier seul ; 360 px de large.

---

## 9. Décisions à valider (avec ma recommandation)

1. **Nouvelles boutiques : seul le paiement à la livraison est actif.** Les existantes gardent les 5 (reprise exacte). *Recommandé* : un Mobile Money ne s'active qu'avec son numéro.
2. **Visibilité du numéro.** (a) Pas dans la vitrine publique, seulement après la commande avec sa référence (et au suivi). *Recommandé* : moins de moissonnage de numéros et lien fort avec la référence. (b) Le numéro est lu **en direct** au suivi, pas copié dans la commande. *Recommandé* : si le propriétaire corrige un numéro volé, les commandes en attente affichent le bon. Contrepartie : une commande passée pendant un détournement n'a pas de « preuve » du numéro vu par le client ; le journal garde la date du changement.
3. **`Order.promised_hours` copié à la commande** (au lieu de lire le délai actuel de la zone). *Recommandé* : « Livrées à temps » ne bouge pas quand on change un délai ; la migration remplit le champ avec l'ancienne règle.
4. **Plafond de zones par plan : 20 / 60 / 150** (Gratuit / Pro / Business), inactives comprises, avec blocage de la rétrogradation. *Recommandé.* Alternative : un plafond unique de 60, sans lien avec le plan.
5. **Ville et commune d'une zone non modifiables** (on désactive et on recrée). *Recommandé* : sinon l'historique « zone utilisée » et les anciennes commandes perdent leur sens.
6. **Bornes** : frais 0 à 100 000 F ; délai 1 à 240 h ; préparation du retrait 1 à 168 h ; nom du titulaire 40 caractères. *Recommandé.*
7. **Confirmation renforcée seulement pour un numéro ou un nom** (pas pour activer un moyen, pas pour les zones, pas pour l'adresse de retrait). *Recommandé.* Je n'ajoute pas de **délai d'attente de 24 h** avant qu'un nouveau numéro serve : la confirmation, l'alerte par e-mail à chaque propriétaire et le journal suffisent pour une première version ; à reconsidérer quand de vrais paiements passeront par Akwaba.
8. **Au moins une option de remise** (zone active ou retrait), en plus de « au moins un moyen de paiement » demandé. *Recommandé* : sinon une boutique ouverte ne peut plus vendre et personne ne comprend pourquoi. Pour fermer, il y a le mode congé.
9. **Ordre du résumé des paiements** : l'ordre de `PaymentMethod.choices` (Livraison, Orange Money, MTN MoMo, Moov Money, Wave), identique à la vitrine d'aujourd'hui. L'exemple « Livraison + Wave + Orange Money » du cahier des charges serait alors « Livraison + Orange Money + Wave ». *Recommandé :* ne pas toucher l'ordre existant. Si vous préférez Wave en premier, il faut changer aussi l'ordre de la vitrine.
10. **Pas de contrôle du préfixe opérateur** sur le numéro (Orange 07, MTN 05, Moov 01) : la portabilité des numéros rend ce contrôle faux pour de vrais clients, et Wave accepte tout numéro. On valide seulement un numéro ivoirien valide. *Recommandé.*
11. **Retraits exclus** de « Livrées à temps » et de « CA par lieu ». *Recommandé* : un retrait n'a pas de lieu de livraison ni de promesse de livraison.
12. **Zones d'une nouvelle boutique** : copie de `DEFAULT_ZONES` (comme aujourd'hui), pour pouvoir vendre tout de suite. *Recommandé.*
13. **Alerte e-mail à chaque propriétaire**, y compris l'auteur du changement. *Recommandé.*

---

## 10. Revue sécurité (Alice)

Avis **bloquant**. Recopié tel que transmis par Kavin ; l'application suit.

**À appliquer**
- **B1** : un test P05 prouve qu'avec une session sans confirmation récente, changer un numéro de réception répond 403 et n'écrit rien. La correction A2-F1 sur la 2FA est faite par ailleurs (branche `claude/a2-securite-2fa`) : P05 ne part pas en production avant elle (voir « À faire en production »).
- **B2 (décision 7 retournée)** : un numéro qui REMPLACE un numéro existant (pas la première saisie) reste « en attente » 24 h. Pendant ce temps, les clients voient l'ancien numéro (ou le texte de repli s'il n'y en avait pas). Le propriétaire peut annuler l'attente d'un clic, sans confirmation renforcée (annuler protège). L'attente s'affiche en bandeau dans l'espace marchand et sur la carte « Sécurité de la boutique ». Journal : début de l'attente, activation, annulation (catégorie Sécurité). L'activation au bout de 24 h se calcule à la lecture (pas de tâche planifiée).

**Non bloquants retenus**
- contrôle `demo_restricted` en premier ;
- `security-overview` signale « numéro de réception changé dans les 7 derniers jours » ;
- `payout_name` refuse les noms qui imitent un opérateur ou un service (liste fermée : Wave, Orange, MTN, Moov, Money, Service client…) ;
- limite de 3 changements de numéro par jour et par boutique.

**Tests qu'Alice rejouera** : numéro sans reauth (403, rien d'écrit) ; attente de 24 h et annulation ; moyen inactif refusé en appel direct ; isolation des zones entre boutiques ; aucun numéro complet dans le journal, les e-mails ou les erreurs. Ils sont dans `shops/tests/test_payments.py` (`PayoutConfirmationTests`, `PendingNumberTests`, `CheckoutPaymentTests`, `FirstNumberTests`) et `shops/tests/test_delivery.py` (`IsolationTests`).

---

## 11. Écarts par rapport au contrat de l'étape 1

Ce qui a changé en réalisant l'étape 2. Tout le reste est appliqué tel quel (recommandations de l'auteur pour les 13 décisions, sauf la 7).

1. **Décision 7 retournée (B2) : attente de 24 h.** Précisions de réalisation :
   - Champs `pending_number`, `pending_name`, `pending_at` sur `ShopPaymentMethod` ; `activates_at = pending_at + 24 h` ; `effective_payout()` est le seul calcul de « ce que voit le client » (vitrine après commande, suivi, exemple du GET).
   - **`had_number`** (nouveau champ) : vrai dès qu'un numéro a été donné une fois. Tout numéro suivant attend 24 h, **même après un retrait** : sans cela, « retirer le numéro puis en redonner un » contournerait l'attente. Pendant l'attente d'un numéro redonné après retrait, le client voit le texte de repli.
   - Seule la **première saisie jamais faite** sert tout de suite. Un **retrait** de numéro sert tout de suite (il ne détourne rien) ; il n'est possible que sur un moyen **éteint** (un Mobile Money actif exige numéro et nom). Un **changement de nom seul** (même numéro) sert tout de suite, avec confirmation (un nom ne déplace pas l'argent ; les noms imitant un opérateur sont refusés).
   - Renvoyer le formulaire avec le numéro en service ne touche pas l'attente ; renvoyer le numéro en attente ne la relance pas ; un troisième numéro remplace l'attente et **relance** les 24 h.
   - `settle_pending()` (mise à jour conditionnelle, appelée aux lectures marchandes, au suivi et à la commande) écrit l'activation et la journalise **une seule fois** ; la lecture reste juste sans elle.
   - Route ajoutée : `DELETE /shops/{slug}/payment-settings/{method}/pending` (propriétaire, sans confirmation renforcée, 404 s'il n'y a rien à annuler). Le GET gagne `pending` par moyen (numéro et nom en attente, début, activation) et `pending_count`.
2. **Journal** : 3 actions de plus que le contrat : `payout_number_pending` (à surveiller), `payout_number_activated`, `payout_number_cancelled` (info). `payout_number_changed` ne sert plus qu'à la première saisie, au retrait et au changement de nom. Détails en liste blanche : deux derniers chiffres seulement.
3. **Limite de débit** : `payout_change:shop` = **3 par jour et par boutique** (au lieu de 10 par heure), comptée seulement quand un numéro ou un nom change, après la confirmation. Les écritures de livraison restent à 60 par heure et par membre.
4. **Ordre des contrôles** (PUT paiements) : démo → forme → au moins un moyen actif (`payment_methods_required`, 400, code de problème) → numéro et nom obligatoires → confirmation → limite.
5. **E-mail d'alerte** : pour une attente, le gabarit est `payout_number_pending` (« Un numéro de paiement va changer sur {boutique} », avec la phrase « annulez le changement d'un clic ») ; sinon `payout_number_changed`. Un lien vers la page Paiements est ajouté.
6. **`security-overview`** gagne `payout_changed_7d` (`{count, last_at}` ou `null`) et `payout_pending` (liste `{method, label, since, activates_at, new_last2}`). Jamais un numéro entier.
7. **Nom du titulaire** : code `payout_name_reserved` (400) pour un nom contenant l'un des mots Wave, Orange, MTN, Moov, Money, MoMo, Akwaba, Support, Assistance, Opérateur, Officiel, ou les expressions « service client », « mobile money » (sans accents ni casse, mots entiers).
8. **Résumé de livraison** : `limits` gagne `count` (nombre de zones, pour le compteur « 12 sur 20 »).
9. **Plan** : `PlanSpec.delivery_zones` (20 / 60 / 150), exposé dans `GET plans` ; `usage.delivery_zones` ajouté ; blocage de la rétrogradation.
10. **Fabriques de test et démo** : `make_shop()` donne les 15 zones et les 5 moyens actifs (état d'une boutique d'avant le chantier) ; `seed_demo` active les 5 moyens des boutiques de démo (sans numéro) pour que la démo vende comme avant.
11. **Course PostgreSQL** : un test vérifie que le verrou `SELECT … FOR UPDATE` est émis (ignoré sur SQLite) ; le vrai test à deux fils n'a pas pu tourner ici (pas de PostgreSQL dans l'environnement).

### Écarts du front (étape 3)

12. **Bandeau d'attente** : posé dans le layout de l'espace marchand (propriétaire seulement), avec le bouton « Voir et annuler » vers la page Paiements ; l'annulation se fait sur la page Paiements, dans la ligne du moyen, sans confirmation renforcée. La carte « Sécurité de la boutique » gagne un point « numéro de réception » (attente, changement dans les 7 jours, ou en ordre).
13. **Limite de débit** : le message 429 donne un délai en heures ou en minutes (la limite est de 3 changements par jour).
14. **Vitrine sans option de remise** (aucune zone active, pas de retrait) : bandeau « Commandes fermées », comme le mode congé. La couverture n'affiche plus « dès X F » sans zone et ses textes ne sont plus figés (« du Plateau à Korhogo » retiré).
15. **Choix visuels non prévus au contrat, à valider** : composant interrupteur (orange allumé, bord sable éteint) ; préfixe « +225 » fixe à gauche du champ numéro ; en-têtes de ville en ocre majuscules dans la liste des zones ; encadré de retrait en texte avec filet encre à gauche ; texte de la fiche commande pour un paiement Mobile Money reformulé (« le client règle … avec la référence … »). Rien d'autre.
16. Non fait : « Livrée » reste le nom de la dernière étape d'une commande en retrait (pas de vocabulaire « Retirée » sans décision).

Vérifié dans un navigateur (Playwright, 1280 px) avec le serveur local : première saisie, remplacement avec attente de 24 h (les clients voient l'ancien numéro à la commande), nom imitant un opérateur refusé, limite de 3 par jour, commande en livraison et en retrait avec instructions. Non vérifié : 360 px, contraste mesuré de l'ocre, parcours au clavier seul.

## 12. À faire en production

1. **Ne pas déployer P05 avant la correction A2-F1** (2FA, branche `claude/a2-securite-2fa`). La confirmation renforcée protège les numéros ; tant que A2-F1 n'est pas en ligne, cette protection a une faille. Ordre : A2-F1, puis P05.
2. Migrations, dans l'ordre : `shops 0009_paiements_livraison` (schéma), `shops 0010_reprise_paiements_livraison` (données : 15 zones et 5 moyens actifs par boutique existante, `promised_hours` des commandes), `audit 0010_evenements_paiements_livraison`. `python manage.py migrate` sur PostgreSQL ; vérifier `makemigrations --check` propre. La 0010 est idempotente et sans verrou long.
3. Après migration, contrôler une boutique réelle : `GET /storefront/{slug}` doit rendre les mêmes 15 zones et les 5 moyens qu'avant.
4. Déployer le **front** avec l'API (le front d'avant reste lisible : les clés existantes de la vitrine ont la même forme ; `fulfillment` et `payment_instructions` sont ajoutés).
5. Prévenir les propriétaires : les 5 moyens restent actifs sans numéro tant qu'ils n'ont pas donné le leur.
