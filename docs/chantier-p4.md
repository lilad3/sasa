# Chantier P4 : espace marchand (avant la remise du 22/10 à 23 h 59)

Décisions prises avec l'utilisateur le 21 et le 22/10. Répartition : **backend → session 51**, **frontend → session e2**.
Ce fichier est le contrat entre les deux. Toute différence se signale par message avant d'être codée.

Rappels communs :
- migrations nouvelles seulement (shops 0004…, accounts 0004…, audit 0005…), vérifiées par `makemigrations --check` ;
- tout se décide côté serveur (`ShopScopedView`) ;
- chaque action sensible : `record()` et, quand c'est indiqué, `require_reauth` ;
- erreurs au format problem+json existant.

## 0. Ce qui est dans le périmètre avant la remise

| Bloc | Backend | Front |
|---|---|---|
| A. Pouvoirs du gérant | droits effectifs, droits accordés, routes membres | « Mon personnel » |
| B. Présence | route de présence | « Mon personnel » |
| C. Clients et fidèles | modèle Customer, routes | page Clients + fiche |
| D. Objectif du mois | modèle, routes, messages auto | jauge + réglage |
| E. Dashboard | ajouts au résumé | dashboard façon maquette |
| F. Inscription | choix du plan, fuite « adresse prise » | étape « Votre plan » |
| G. Logo | envoi validé, service public | Paramètres + vitrine + barre latérale |

**Après la remise**, hors périmètre ce soir :
- réductions (codes liés au téléphone, champ en vitrine) ;
- canaux `?via=` ;
- éditeur « Ma boutique » (thèmes, blocs, brouillon/publication/versions) ;
- photos produits envoyées ;
- livraisons « à temps » ;
- export des clients ;
- démo à partir de `demo/articles/`.

## A. Pouvoirs du gérant

Nouveaux codes : `customers.view`, `customers.loyalty`, `customers.vip`, `goals.manage`, `team.manage_sellers`, `team.presence`, `storefront.edit`.

| Rôle | Droits |
|---|---|
| owner | tous |
| manager (défaut) | dashboard.view, orders.view, orders.manage, orders.export, products.view, products.write, team.view, notes.send, customers.view, customers.loyalty |
| seller | orders.view, orders.manage, products.view, team.view (inchangé) |

- `GRANTABLE = {team.manage_sellers, team.presence, storefront.edit}`. Il s'élargira après la remise à `discounts.give` et `customers.export`.
- Jamais accordables : `shop.manage` (plan, réglages, clés API), `goals.manage`, `customers.vip`.
- **Décision de l'utilisateur :** un gérant peut recevoir `team.manage_sellers`. Il ajoute ou retire alors des **vendeurs uniquement**, et peut leur redonner un mot de passe provisoire. Il ne peut ni nommer un gérant, ni toucher au propriétaire ou à un autre gérant, ni changer un poste. Les changements de poste restent au propriétaire.
- `Membership.grants` : JSONField, liste de codes ⊂ GRANTABLE, effective seulement pour un manager. Les grants sont vidés si la personne repasse vendeur.
- `effective_permissions(m) = ROLE_PERMISSIONS[m.role] | (set(m.grants) & GRANTABLE si manager)`. C'est cette fonction que `ShopScopedView` vérifie.
- `/me/shops` : `permissions` = droits effectifs triés. On y ajoute `grants` et `logo_version` (voir G).

Routes membres :
- `GET members` : ajouter `grants` à chaque manager quand le lecteur a `shop.manage`.
- `POST members` : droit `team.manage_sellers` (le propriétaire l'a). Si le demandeur n'est pas propriétaire, `role` doit valoir `seller`, sinon 403. Reauth et audit inchangés.
- `PATCH members/{id}` : réservé à `shop.manage`, corps `{role?, grants?}`.
  - `grants` n'est accepté que si la cible est manager, sinon 400. Les codes inconnus ou non accordables sont refusés (400).
  - Reauth obligatoire.
  - Audit `member_grants_changed` (S, WARNING), avec `added` et `removed`.
- `DELETE members/{id}` et `POST members/{id}/temporary-password` : droit `team.manage_sellers`. Un demandeur non propriétaire ne vise qu'un vendeur, sinon 403.
- Tests :
  - un gérant sans le droit reçoit 403, avec le droit 200 ;
  - un gérant ne peut pas viser un gérant ;
  - un gérant ne peut pas s'accorder un droit ;
  - un droit retiré s'applique à la requête suivante.

## B. Présence (« Mon personnel »)

`GET /shops/{slug}/team/presence`, droit `team.presence`. Renvoie la liste des membres, propriétaire compris :

```json
[{ "user_id": "…", "name": "Fatou Diallo", "role": "manager", "is_you": false,
   "status": "today | absent | never",
   "last_seen_at": "…|null",
   "first_seen_today": "…|null",
   "handled_today": 14 }]
```

- `last_seen_at` : le maximum de `UserSession.last_seen_at`.
- `today` : vu depuis minuit, heure d'Abidjan.
- `never` : jamais connecté.
- `handled_today` : nombre d'événements `order_status_changed` de cet acteur, dans cette boutique, depuis minuit.
- **Jamais** d'IP, d'appareil ni de lieu.

## C. Clients et fidèles

Modèle `Customer` :
- `shop`, `phone` (au format +225…), `public_id` (`secrets.token_urlsafe(16)`, unique), `name` (le dernier connu) ;
- `is_vip`, `vip_set_by` (FK null), `vip_set_at`, `created_at` ;
- contrainte d'unicité sur `(shop, phone)`.

Les lignes sont créées par `place_order` (upsert) et par une synchronisation paresseuse : `bulk_create(ignore_conflicts)` des téléphones de commandes sans fiche, appelée par les routes de liste et de résumé. **Le numéro n'apparaît jamais dans une URL.**

`Shop.loyalty_threshold` : de 1 à 50, 3 par défaut.

Statistiques par client, calculées sur ses commandes dans la boutique :

| Champ | Calcul |
|---|---|
| `orders` | toutes ses commandes |
| `delivered` | commandes livrées |
| `cancelled` | commandes annulées |
| `spent` | somme des totaux hors annulées |
| `average_basket` | `spent` / nombre de commandes non annulées |
| `first_order_at`, `last_order_at` | dates de la première et de la dernière commande |
| `reliability` | livrées / (livrées + annulées) en %, `null` si aucune n'est terminée |
| `loyal` | `is_vip` ou `delivered ≥ loyalty_threshold` |

`flags` : sous-ensemble de :
- `new` : première commande il y a 30 jours au plus ;
- `win_back` : au moins 2 commandes non annulées, et la dernière remonte à plus de 45 jours ;
- `at_risk` : au moins 2 commandes annulées, ou au moins 2 commandes terminées avec `reliability < 50`.

Routes (droit `customers.view` sauf mention contraire) :
- `GET /shops/{slug}/customers?segment=all|loyal|new|win_back|at_risk&q=&sort=recent|spent&page=`
  - Paginée.
  - `q` cherche dans le nom, ou dans les chiffres du téléphone.
  - Élément : `{id, name, phone_masked, city, commune, orders, delivered, cancelled, spent, average_basket, first_order_at, last_order_at, reliability, loyal, vip, flags}`.
  - `phone_masked` vaut `"+225 07 08 •• •• 11"` : on garde les 4 premiers et les 2 derniers chiffres.
- `GET /shops/{slug}/customers/summary` :
  - `{total, active_30d, active_30d_previous, loyal, new_30d, win_back, at_risk, loyalty_threshold, loyal_top}` ;
  - `loyal_top` : au plus 6 éléments de liste, plus `monthly` (6 nombres, le CA de chaque mois, du plus ancien au plus récent).
- `GET /shops/{slug}/customers/{id}` : 404 hors de la boutique. Renvoie les champs de liste, plus :
  - `phone` (complet), `names_used` ;
  - `payment_favorite` (méthode) ;
  - `addresses` (les 3 premières, `{city, commune, landmark, orders}`) ;
  - `products` (les 5 premiers, `{name, quantity}`) ;
  - `orders` (les 20 dernières, `{id, reference, created_at, total, status, payment_method}`) ;
  - `vip_set_by` (`{name}` ou null), `vip_set_at`.
- `PATCH /shops/{slug}/customers/settings`, corps `{loyalty_threshold}`, droit `customers.loyalty`. Audit `loyalty_threshold_changed` (B, INFO).
- `POST /shops/{slug}/customers/vip`, corps `{phone, name}`, droit `customers.vip` (le propriétaire seulement).
  - Le numéro passe par `normalize_phone`. La fiche est créée si besoin, avec `is_vip=True`.
  - Audit `customer_vip_set` (B, INFO), avec une cible de la forme `("customer", public_id, name)`.
  - Renvoie la fiche.
- `DELETE /shops/{slug}/customers/{id}/vip`, droit `customers.vip`. Audit `customer_vip_removed`.

## D. Objectif du mois

Modèle `ShopGoal` :
- `shop`, `month` (date du 1er du mois), `amount` (FCFA) ;
- `set_by` (FK null), `set_by_name`, `created_at`, `updated_at` ;
- contrainte d'unicité sur `(shop, month)`.

`GET /shops/{slug}/goal`, droit `team.view` (tous les membres) :

```json
{ "month": "2026-10", "label": "octobre", "days_left": 9,
  "goal": null | { "percent": 80.2, "reached": false, "set_at": "…",
                   "set_by": {"name": "Adjoua Konan", "role": "owner", "is_you": true},
                   "amount": 6000000 | null, "revenue": 4812500 | null },
  "history": [{ "month": "2026-09", "label": "septembre", "percent": 104.3, "reached": true, "amount": 5000000 | null }] }
```

**`amount` et `revenue` valent null sans `dashboard.view`.** Le vendeur ne voit que le pourcentage : c'est l'option A choisie par l'utilisateur. `revenue` = somme des totaux hors annulées sur le mois. `history` couvre les 3 derniers mois qui ont un objectif.

`PUT /shops/{slug}/goal`, corps `{amount}` (de 1 000 à 2 000 000 000), droit `goals.manage` (le propriétaire seulement) :
- ne vaut que pour le mois en cours ;
- limite de 20 appels par heure ;
- audit `goal_set` (B, INFO), avec `month`, `previous` et `amount`.

Il envoie ensuite automatiquement des messages d'équipe (`TeamNote`, avec un nouveau champ `kind` = `message|goal`) :
- aux gérants : « Objectif de {mois} : {montant} F. Suivez la progression sur la vue d'ensemble. » ;
- aux vendeurs, **sans montant** : « {Prénom} a fixé l'objectif de {mois} pour l'équipe. Suivez la progression sur la vue d'ensemble. ».

Aucun message n'est créé sans destinataire.

## E. Ajouts au résumé du dashboard

Ces ajouts sont dans `GET /dashboard` (droit `dashboard.view`) :
- `top_products[i]` gagne `category`, `image_url` (null), `previous_revenue` (même produit sur la période précédente) et `series` (CA par jour, autant de nombres que de jours dans la période) ;
- `month` : `{month: "2026-10", label: "octobre", revenue, orders, previous_revenue}`. `previous_revenue` couvre le mois précédent, jusqu'au même quantième ;
- `generated_at` : la date et l'heure du calcul ;
- `has_demo_data` : vrai si la boutique a des commandes `is_demo`. Le front affiche alors l'étiquette « exemple ».

## F. Inscription

- `SignupSerializer` gagne `plan` (`free|pro|business`, `free` par défaut). Avec la vérification par e-mail, le plan voyage dans le jeton signé.
- `create_shop_for_owner(user, name, plan)`. En démo, le plan choisi s'applique tout de suite, sans paiement. L'audit `shop_created` reçoit `plan`.
- **Fuite « adresse déjà prise »** : correction validée par l'utilisateur. En mode direct, le 409 `email_taken` révèle qui a un compte. Je recommande d'activer la vérification par e-mail par défaut (`SIGNUP_EMAIL_VERIFICATION=1`, toujours 202, sans fuite), avec un backend d'e-mail console en développement. Le front sait déjà afficher les deux formulaires (`GET /auth/signup`). Si tu choisis une autre solution, préviens-moi.

## G. Logo de la boutique

Il faut Pillow (`uv add pillow`).

`POST /shops/{slug}/logo`, en multipart (champ `logo`), droit `storefront.edit` :
- 2 Mo au maximum ;
- le format est lu d'après le contenu : PNG, JPEG ou WebP seulement. SVG et GIF sont refusés, comme tout ce qui ne s'ouvre pas avec Pillow ;
- l'image est redimensionnée à 512 px au plus sur son grand côté, puis réencodée en PNG, ce qui retire les EXIF et la position GPS ;
- le nom du fichier est aléatoire ;
- audit `shop_logo_changed` (B, INFO) ;
- réponse : `{logo_version}`.

`DELETE /shops/{slug}/logo` : même droit, même audit.

`GET /api/v1/storefront/{slug}/logo` est public, derrière le BFF :
- il renvoie `image/png` avec `X-Content-Type-Options: nosniff` et un cache long ;
- il répond 404 sans logo.

Le front le relaie par une route Next (le navigateur ne parle jamais à Django). `logo_version` (une empreinte courte, ou null) s'ajoute à la vitrine (`GET /storefront/{slug}`) et à `/me/shops`, pour invalider le cache.

## Journal

Actions à ajouter dans `audit/actions.py`, avec une migration des choix et la liste blanche `DETAILS` d'`activity.py` :
- `member_grants_changed`
- `goal_set`
- `customer_vip_set`
- `customer_vip_removed`
- `loyalty_threshold_changed`
- `shop_logo_changed`

## Écarts et précisions du backend (session 51, signalés à e2)

- **Fiche client** : `orders` est la liste des 20 dernières commandes, comme écrit plus haut ; le nombre de commandes passe dans `order_count`.
- **Messages d'équipe** : chaque note porte `kind` (`message` ou `goal`). Les messages automatiques élident « de » devant une voyelle (« Objectif d'octobre »).
- **Logo** : stocké en base dans un modèle à part (`ShopLogo`), pas en fichier ; même API. Servi avec `X-Content-Type-Options: nosniff`, `Cache-Control: immutable` et une CSP `sandbox`.
- **Inscription** : `SIGNUP_EMAIL_VERIFICATION=1` par défaut ; le plan voyage dans le jeton signé.
- **Clients** : un client sans commande n'apparaît que s'il a été nommé fidèle ; `DELETE customers/{id}/vip` renvoie la fiche (200).
