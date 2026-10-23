# Chantier A2 · P06 : Notifications

Branche `claude/a2-notifications`, **sur `main`** (après le lot 3 de P5). **Étape 1 : ce fichier est le contrat, rien n'est codé.** Il est validé par l'utilisateur avant l'étape 2. Frontend : Marc. Backend : Koffi (§9).

Rappels communs (ceux de `chantier-p5.md`) :
- migrations nouvelles seulement, compatibles SQLite et PostgreSQL. D'autres chantiers en ajoutent en parallèle : ici **une seule migration, dans une nouvelle application** (`notifications 0001_initial`), donc aucun numéro à renuméroter dans `shops` ni `audit` ;
- tout se décide côté serveur (`ShopScopedView`, `effective_permissions`), les données passent par `.for_shop()` ;
- un non-membre reçoit 404, un droit manquant 403 ;
- action sensible : `record()` + `audit/actions.py` + migration audit + `DETAILS`. **Ce chantier n'ajoute aucune action** : régler ses propres e-mails n'est pas une action sensible (D8) ;
- textes saisis : `plain_text`. Erreurs : problem+json existant. Jamais de HTML venant d'un utilisateur.

| Lot | Branche | État |
|---|---|---|
| P06 · Notifications par e-mail | `claude/a2-notifications` | **contrat à valider**, rien n'est codé |

---

## 1. Ce qui change, en deux phrases

Aujourd'hui une nouvelle commande n'est vue que si l'espace marchand est ouvert (bandeau `features/live/live-orders.tsx`, relevé toutes les 30 s), et les seuls e-mails sont ceux de sécurité (`accounts/emails.py`). Une commande qui arrive à 21 h, quand personne n'a l'onglet ouvert, n'est connue que le lendemain.

Demain, **chacun choisit ce qu'il reçoit par e-mail**, boutique par boutique : nouvelle commande, stock bas, commande annulée, résumé du jour. WhatsApp viendra plus tard, sur le même modèle. Le bandeau en direct ne change pas : il sert quand l'espace est ouvert, l'e-mail quand on est parti.

## 2. Les événements (liste fermée)

Un seul fichier les décrit, côté serveur : `notifications/events.py`. Le front reçoit les identifiants, jamais une liste à lui.

| Événement (`id`) | Libellé | Quand | Droit requis pour le recevoir | `ready` |
|---|---|---|---|---|
| `new_order` | Nouvelle commande | une commande vient d'être passée en boutique | `orders.view` | oui |
| `low_stock` | Stock bas | un produit **passe** sous son seuil d'alerte ou à zéro (une fois, pas à chaque commande) | `products.view` | oui |
| `order_cancelled` | Commande annulée | le statut d'une commande passe à « annulée » | `orders.view` | oui |
| `daily_summary` | Résumé du jour | une fois par jour, par la commande de gestion `send_daily_summaries` | `orders.view` ; **le chiffre d'affaires seulement avec `dashboard.view`** | oui |
| `payment_received` | Paiement reçu | réservé à P05 | `orders.view` | **non** |
| `review_to_moderate` | Avis à modérer | réservé (avis clients) | `orders.manage` | **non** |
| `abandoned_cart` | Panier abandonné | réservé (paniers) | `orders.view` | **non** |

Règles :
- Un événement **non prêt** n'a ni ligne dans la page, ni accepté par `PUT`, ni envoi. Le passer à `ready` = une ligne dans `events.py` et son déclencheur, sans migration (la liste des choix du modèle n'est pas figée en base : la validation est faite par le serveur, voir 4).
- **Droit requis** : vérifié **à l'envoi** sur les droits réels de la personne à ce moment-là (`effective_permissions`), pas sur ceux qu'elle avait quand elle a réglé ses préférences. Un droit retiré arrête les e-mails correspondants dès le suivant.
- Les canaux : `email` aujourd'hui. `whatsapp` est annoncé dans la page (« WhatsApp : bientôt ») mais n'a **aucune** valeur, aucune table, aucun champ côté serveur : on ne réserve pas un modèle pour un canal dont on ne connaît pas encore les règles.

## 3. Qui reçoit quoi

### 3.1 Les défauts, selon le rôle

Les défauts vivent **dans le code** (`events.py`), pas en base. Une personne ne les change qu'en cochant ou décochant : seul ce choix est enregistré.

| Événement | Propriétaire | Gérant | Vendeur |
|---|---|---|---|
| Nouvelle commande | **oui** | **oui** | non |
| Stock bas | **oui** | **oui** | non |
| Commande annulée | **oui** | non | non |
| Résumé du jour | **oui** | **oui** | non |

Raisons : le vendeur travaille dans l'espace ouvert (il a le bandeau en direct) ; l'annulation est une information de pilotage ; un résumé sans CA n'apporte presque rien au vendeur. Tout reste réglable, par la personne elle-même (D2).

Un changement de rôle (un vendeur nommé gérant) **applique les défauts du nouveau rôle** pour tout ce qu'il n'avait pas réglé lui-même. Ses choix explicites restent, tant qu'il a encore le droit requis.

### 3.2 Les destinataires (calculés à chaque envoi)

Un membre reçoit un e-mail seulement si **toutes** ces conditions sont vraies :
1. son appartenance à la boutique existe encore ;
2. son compte est actif, **n'est pas un compte de démonstration** (`is_demo`) et a **déjà choisi son mot de passe** (`must_change_password = False`) : tant que la personne n'est pas entrée une fois, on n'écrit pas à une adresse que le propriétaire a seulement tapée (risque : une faute de frappe enverrait les commandes à quelqu'un d'autre) ;
3. il a le droit requis (2) ;
4. l'événement est activé pour lui (son choix, sinon le défaut de son rôle).

La commande qui déclenche (`Order.is_demo`) n'envoie rien.

## 4. Modèles (application `notifications`, migration 0001)

**`NotificationPreference`** : un choix explicite d'une personne, **par membre et par boutique** (clé : l'appartenance).

| Champ | Type | Règle |
|---|---|---|
| `id` | UUID | |
| `membership` | FK `shops.Membership` (CASCADE) | par boutique et par membre. Retirer le membre efface ses choix |
| `event` | texte (≤ 30) | validé par le serveur contre `events.py` (pas de `choices` en base) |
| `enabled` | booléen | |
| `updated_at` | date-heure | |

Contrainte d'unicité `(membership, event)`. **Seuls les écarts au défaut sont stockés** : si la valeur demandée est celle du défaut du rôle, la ligne est supprimée (ainsi un changement de rôle suit les défauts du nouveau rôle).

**`NotificationState`** : ce qu'il faut retenir pour ne pas inonder et ne pas répéter.

| Champ | Type | Règle |
|---|---|---|
| `membership` | FK (CASCADE) | |
| `event` | texte | |
| `last_sent_at` | date-heure, null | début de la fenêtre anti-rafale (5.3) |
| `held_count` | entier ≥ 0 | messages retenus dans la fenêtre, à dire dans le prochain envoi |
| `held_refs` | JSON, liste de 10 textes au plus | **références** de commande retenues (jamais de nom ni de téléphone) |
| `last_summary_on` | date, null | dernier jour où le résumé a été envoyé (un seul par jour) |

Unicité `(membership, event)`. Ne contient aucune donnée de client.

Le disjoncteur (5.5) et les plafonds (5.4) utilisent le cache en base et `core.ratelimit`, **sans table de plus**.

Pas de table « boîte d'envoi » : les envois partent après la validation de la transaction, et un envoi raté retombe en `held_count` (5.2). Voir D5.

## 5. L'envoi

### 5.1 Quand : après la validation, jamais pendant

Chaque déclencheur s'enregistre avec `transaction.on_commit(callback, robust=True)` :

| Événement | Où | Détail |
|---|---|---|
| `new_order` | `shops/checkout.py`, `place_order`, dans le bloc `atomic`, une fois la commande, les lignes et le stock écrits | si la transaction est annulée (`out_of_stock`, `price_changed`, `discount_invalid`), rien ne part. Un rejeu d'idempotence (`order is None`) ne notifie pas |
| `low_stock` | même endroit, dans la boucle qui décrémente le stock | un produit **traverse** son seuil : `stock_avant > seuil` et `stock_après ≤ seuil` (ou `stock_après = 0`). Les produits de la même commande vont dans **un seul** message. On passe des identifiants, le nom et le stock sont relus à l'envoi |
| `order_cancelled` | `shops/views.py`, `OrderDetailView.patch`, dans le bloc `atomic`, quand `new_status == cancelled` | |
| `daily_summary` | commande de gestion (5.6) | pas de requête client |

Le stock modifié à la main dans le catalogue ne déclenche **pas** de `low_stock` : la personne qui le fait le sait déjà (D6).

### 5.2 Jamais au point de faire échouer une commande

- Le callback est enveloppé dans `try … except Exception` qui **journalise** (`logger.exception`, sans adresse ni contenu) et **avale** l'erreur. `robust=True` est une seconde ceinture.
- Les calculs de destinataires et le rendu se font **dans** le callback, pas avant : un bug de gabarit ne peut pas toucher la transaction de la commande.
- La réponse à la cliente ou au client est **construite avant** l'envoi dans le cas courant ; le seul coût est le temps d'envoi, borné par 5.5.
- Un envoi qui échoue ne perd rien : le message **retombe en retenu** (`held_count += 1`, référence ajoutée) et part avec le prochain envoi ou au balayage (5.6).
- Test obligatoire : un serveur d'e-mail qui lève une exception (connexion refusée, délai dépassé) **ne change ni le statut 201, ni le corps de la réponse, ni la commande, ni le stock**.

### 5.3 Anti-rafale : un message par personne, par événement, toutes les 10 minutes

Fenêtre de **10 minutes** pour `new_order`, `order_cancelled` et `low_stock`.

1. Un événement arrive pour une personne. Le serveur tente de **prendre** la fenêtre par une mise à jour conditionnelle (même technique que le décompte des codes de réduction, atomique sur SQLite et PostgreSQL) :
   `NotificationState.filter(pk=…, Q(last_sent_at__isnull=True) | Q(last_sent_at__lte=maintenant − 10 min)).update(last_sent_at=maintenant, held_count=0)`.
2. Une ligne mise à jour : **c'est à cette requête d'envoyer**, tout de suite. Le message dit combien d'autres événements ont été retenus (`held_count` lu juste avant la remise à zéro).
3. Zéro ligne : la fenêtre est ouverte. L'événement est **retenu** : `held_count += 1` (mise à jour `F()`), sa référence est ajoutée à `held_refs` (10 au plus ; au-delà, seul le compteur monte).
4. Les messages retenus partent **groupés** dans un seul e-mail (« 4 nouvelles commandes depuis 14 h 02 »), au prochain événement après la fin de la fenêtre ou au balayage (5.6).

Conséquence assumée : la première commande est signalée tout de suite, la rafale qui suit est **résumée**. Sur l'hébergement gratuit, qui n'a pas de tâche toutes les 10 minutes (10.3), les commandes retenues partent au prochain événement ou au balayage quotidien ; elles restent visibles en direct dans l'espace marchand et dans le résumé du jour. À valider (D4).

Création de l'état : `get_or_create` avec reprise sur `IntegrityError` (deux premières commandes simultanées).

### 5.4 Plafonds de sécurité

- **200 e-mails par jour et par boutique** (`core.ratelimit.hit`, portée `notify:shop`, jamais `enforce` : on ne lève pas d'erreur). Au-delà, les messages sont retenus, pas perdus ; un journal (`logger.warning`) le dit une fois par heure. Rôle : une personne malveillante qui passerait beaucoup de vraies commandes depuis des IP différentes ne peut pas transformer Akwaba en machine à spams contre l'équipe d'une boutique.
- **20 destinataires au plus par envoi** (le plan Business plafonne à 20 personnes).
- **Une seule connexion** au serveur d'e-mail par déclencheur (`get_connection()` puis `send_messages`), jamais une connexion par destinataire.

### 5.5 Disjoncteur et délai

- `EMAIL_TIMEOUT` à **5 s** (réglage Django, **absent aujourd'hui** : sans lui, une connexion qui pend bloque la requête sans limite).
- Après un échec de connexion, le serveur n'essaie plus d'envoyer pendant **5 minutes** (clé de cache `notify:breaker`) : les messages sont retenus. Un serveur d'e-mail en panne ne ralentit donc pas chaque commande de 5 s.
- Pas de thread, pas de file : l'hébergement gratuit n'offre pas de processus de fond (10.3). Quand il y en aura un, le déclencheur passera dans la file sans changer le contrat (D5).

### 5.6 Les commandes de gestion

**`manage.py send_daily_summaries`** (planifiée une fois par jour, 20 h, heure d'Abidjan = UTC).
- Options : `--shop <slug>`, `--date AAAA-MM-JJ` (aujourd'hui par défaut, jamais dans le futur), `--dry-run` (affiche qui recevrait quoi, **n'envoie rien**, ne note rien).
- Pour chaque boutique non démo, pour chaque destinataire (3.2) du `daily_summary` :
  - **Un seul résumé par jour et par personne** : mise à jour conditionnelle sur `last_summary_on` (`IS NULL` ou `< jour`). Relancer la commande ne renvoie rien. Un envoi qui échoue **remet** la date d'avant, pour qu'une relance le renvoie.
  - **Pas de message vide** : zéro commande reçue ce jour **et** rien à traiter → pas d'e-mail (D3).
- Elle appelle d'abord `send_held_notifications` (les retenus de la journée partent avant le résumé).
- Code de sortie ≠ 0 si **tous** les envois d'une exécution ont échoué (la planification l'affiche).

**`manage.py send_held_notifications`** : envoie les retenus dont la fenêtre est terminée (`held_count > 0` et `last_sent_at ≤ maintenant − 10 min`). À planifier toutes les 10 minutes là où c'est possible ; sinon, le résumé quotidien s'en charge.

Les deux : idempotentes, sans effet si `NOTIFICATIONS_ENABLED` est faux (elles le disent), et sans autre sortie que des compteurs (jamais d'adresse).

## 6. Les e-mails

### 6.1 Principes

- **Sobres, aux couleurs Akwaba** : texte + HTML (`EmailMultiAlternatives`). Le HTML n'a **aucune image distante**, aucun pixel de suivi, aucune police externe ; styles en ligne. Bandeau `encre` (#17110a) avec un filet orange, corps sur `creme` (#faf4ea, **pas de blanc pur**), texte `encre`, bouton `indigo` (#4a57d6) avec texte `creme`. Pas de vert.
- **Écrits selon le rôle du lecteur** (même esprit que `lib/voice.ts`) et neutres : le propriétaire lit « votre boutique », un gérant ou un vendeur lit le nom de la boutique. Jamais « le patron », « la patronne ».
- Tout texte inséré (nom de produit, nom de boutique, référence) passe par l'échappement automatique du moteur de gabarits en HTML et reste du texte brut dans la version texte. Le sujet est nettoyé de tout retour à la ligne (anti-injection d'en-tête) et limité à 150 caractères.
- Un lien « **Gérer mes notifications** » dans chaque e-mail, vers `{FRONTEND_URL}/app/{slug}/parametres/notifications`. Il **n'embarque aucun jeton** : s'il faut se connecter, `proxy.ts` renvoie vers `/connexion?suite=…` et ramène à la page ensuite.
- Le lien vers la commande est `{FRONTEND_URL}/app/{slug}/commandes/{id}` (identifiant interne, **pas** de jeton, **pas** de référence ni de téléphone dans l'adresse). Il ne marche que pour une personne connectée et membre de la boutique : quelqu'un d'autre reçoit 404 comme aujourd'hui.
- Pied de page : « Vous recevez ce message parce que « Nouvelle commande » est activé pour vous dans {boutique}. Gérer mes notifications : … ». Pas de lien de désabonnement en un clic : il demanderait un jeton dans l'adresse, ce qu'on s'interdit (D9).

### 6.2 Ce qui n'y figure jamais

- **le téléphone du client**, entier **ou masqué** ; son nom ; son adresse ; son repère. On donne la **ville ou la commune** de livraison (utile pour s'organiser, peu identifiante) et on renvoie à la commande pour le reste ;
- le contenu des notes internes, le code de réduction, les adresses IP, les noms de clés API ;
- le chiffre d'affaires **cumulé** pour quelqu'un sans `dashboard.view`. Un total de **commande** est visible par tout `orders.view` (c'est déjà dans la liste des commandes) ; un total **du jour** est un chiffre d'affaires.

### 6.3 Les quatre messages (textes de référence)

**Nouvelle commande** (propriétaire).
- Sujet : « Nouvelle commande KRT-7P2 · Maison Adjoua »
- Corps :
  > Bonjour Adjoua,
  > Vous avez reçu une nouvelle commande.
  > **KRT-7P2** · 3 articles · 17 500 F · Paiement à la livraison · Cocody
  > [Ouvrir la commande]
  > Vous recevez ce message parce que « Nouvelle commande » est activé pour vous dans Maison Adjoua. Gérer mes notifications : …
  > L'équipe Akwaba

**Nouvelle commande** (gérant ou vendeur) : « Bonjour Fatou, Maison Adjoua a reçu une nouvelle commande. » (même ligne de détail).

**Plusieurs commandes** (groupe) : « 4 nouvelles commandes depuis 14 h 02. Les dernières : KRT-7P2, MNB-4X9, TZA-R22. [Voir les commandes] » (liste des commandes, sans filtre ; la page de commandes filtre déjà par statut).

**Commande annulée** : sujet « Commande KRT-7P2 annulée · Maison Adjoua » ; « La commande KRT-7P2 (17 500 F) a été annulée. Elle était « confirmée ». [Ouvrir la commande] ».

**Stock bas** : sujet « Stock bas · Maison Adjoua » (un produit : « Stock bas · Beurre de karité brut 500 g ») ; liste : « Beurre de karité brut 500 g : 4 restants (seuil 5) », « Savon noir artisanal 250 g : épuisé ». [Voir le catalogue].

**Résumé du jour** : sujet « Résumé du jour · Maison Adjoua · 23 oct. » ; lignes :
- « Commandes reçues : 7 (dont 1 annulée) » ; « À traiter : 4 » ; « Livrées aujourd'hui : 2 » ;
- « Produits bientôt en rupture : 3 » (si `products.view`) ;
- **« Chiffre d'affaires du jour : 87 500 F » seulement avec `dashboard.view`** (ventes non annulées, comme le tableau de bord). Sans lui, la ligne n'existe pas, pas même « non communiqué ». Le bouton mène au tableau de bord avec `dashboard.view`, sinon à la liste des commandes (un lien vers une page interdite serait un faux espoir).

Les aperçus HTML sont dans `docs/maquettes/notifications/emails.html`.

## 7. Routes

Toutes sous `/api/v1/shops/{slug}/`. Droit : **`orders.view`** (les trois rôles l'ont : pas besoin d'un droit de plus, et la page est ouverte à tous les rôles ; si un rôle sans `orders.view` apparaît un jour, il faudra revoir ce choix).

### 7.1 `GET notifications`

```json
{ "sending": true,
  "email": "adjoua@exemple.ci",
  "events": [
    { "id": "new_order", "enabled": true,  "default": true,  "custom": false },
    { "id": "low_stock", "enabled": true,  "default": true,  "custom": false },
    { "id": "order_cancelled", "enabled": false, "default": true, "custom": true },
    { "id": "daily_summary", "enabled": true, "default": true, "custom": false, "includes_revenue": true }
  ] }
```

- Seulement les événements **prêts** et **auxquels la personne a droit** (rôle + droits accordés). Un vendeur ne voit jamais une ligne dont il ne pourrait pas lire le contenu.
- `default` : le défaut du rôle de la personne. `custom` : `enabled != default`, c'est-à-dire un choix explicite.
- `sending` : l'envoi est-il actif sur ce serveur (`NOTIFICATIONS_ENABLED` **et** un serveur d'e-mail réel, pas la console) ? Le front dit la vérité : « L'envoi d'e-mails n'est pas encore activé sur ce serveur. Vos choix sont gardés ».
- `includes_revenue` : la ligne `daily_summary` seulement (le résumé contiendra le chiffre d'affaires, ou non, pour cette personne).
- `email` : l'adresse **de la personne qui lit** (son compte), jamais celle d'un autre.
- Les libellés et aides sont dans le front (`features/notifications/text.ts`) pour les identifiants connus. **Un identifiant inconnu du front est ignoré** (pas de ligne), pour qu'un serveur plus récent ne casse pas un front plus ancien.

### 7.2 `PUT notifications`

Corps : `{"events": {"low_stock": false, "new_order": true}}`, **partiel** (les événements absents ne changent pas).

- 400 `invalid_event` pour tout identifiant **inconnu, non prêt ou auquel la personne n'a pas droit**, avec **le même corps** dans les trois cas : on n'apprend rien sur ce qui existe (test qui compare les réponses). Un corps vide, un `events` qui n'est pas un objet, ou une valeur non booléenne : 400 `validation_error`. 20 clés au plus.
- Valeur égale au défaut du rôle : la ligne explicite est supprimée.
- Limite : **60 modifications par heure et par membre** (`notify_prefs`), 429 au-delà.
- Réponse 200 : le même corps que `GET`. Pas de confirmation renforcée (ce sont ses propres e-mails, vers son adresse), **pas de journal** (D8).
- Un non-membre de la boutique : 404. Un membre ne peut régler **que sa propre** appartenance : l'identifiant du membre n'est jamais dans l'adresse ni dans le corps, il vient de la session.

### 7.3 `POST notifications/test` (proposé, D7)

Envoie « un e-mail de test » **à l'adresse du compte** de la personne, jamais à une adresse saisie. Corps vide. 3 par heure et par membre, 20 par jour et par boutique ; 409 `notifications_disabled` si l'envoi n'est pas actif ; 502 `email_failed` si l'envoi échoue. Aucune donnée de la boutique dans le message. Il sert à vérifier la configuration de production (10) sans attendre une vraie commande.

### 7.4 Ce qui ne change pas

Les e-mails de sécurité (`accounts/emails.py`) restent à part : **non désactivables**, ils ne passent pas par ce module et n'en dépendent pas.

## 8. Front (étape 2)

### 8.1 La page `/app/{shop}/parametres/notifications`

Pour **tous les rôles**. Quand le cadre P04 est intégré, c'est l'entrée « Notifications » (7) de la configuration : P06 passe son `ready` à vrai et ajoute son état (« 3 types d'e-mails actifs »). Sans P04, la page marche par son adresse (celle du lien « Gérer mes notifications » des e-mails).

- En-tête : « Notifications » ; propriétaire : « Choisissez ce que vous recevez par e-mail pour votre boutique. » ; gérant et vendeur : « Choisissez ce que vous recevez par e-mail pour {boutique}. »
- Une ligne par événement, avec un **interrupteur** et deux phrases (ce que c'est, ce que contient l'e-mail), par exemple :
  - « **Nouvelle commande** : un e-mail à chaque commande, regroupés si elles arrivent en rafale. »
  - « **Stock bas** : quand un produit passe sous son seuil d'alerte ou s'épuise. »
  - « **Commande annulée** : quand une commande est annulée. »
  - « **Résumé du jour** : chaque soir, ce qui s'est passé aujourd'hui. » + « Avec le chiffre d'affaires. » ou « Sans le chiffre d'affaires. » selon `includes_revenue`.
- Chaque ligne indique si c'est le **réglage d'origine** de son rôle ou **le vôtre** (« Choix personnel »), et un lien « Revenir aux réglages d'origine » remet tout au défaut (une requête `PUT` avec les valeurs par défaut, donc des lignes supprimées).
- Bandeau d'état : « Les e-mails partent à **adjoua@exemple.ci** » (adresse de la personne) ; si `sending` est faux : « L'envoi d'e-mails n'est pas encore activé sur ce serveur. Vos choix sont gardés. » (ton ocre, pas de rouge : rien n'est cassé côté personne).
- Ligne de canal : « E-mail · **WhatsApp : bientôt** » (texte, sans contrôle).
- Rappel : « Quand l'espace est ouvert, les nouvelles commandes s'affichent aussi en direct, avec un son si vous l'avez demandé. »
- Bouton « M'envoyer un e-mail de test » (si D7 est accepté), avec le résultat annoncé dans une zone `aria-live`.
- **Enregistrement immédiat** à chaque interrupteur (Server Action, `useActionState`), avec « Enregistré » annoncé dans une zone `aria-live="polite"` ; sans JavaScript, chaque interrupteur est un bouton de formulaire. Pas de bouton « Enregistrer » à oublier (D10).
- Interrupteur dessiné à la main (`role="switch"`, `aria-checked`, libellé réel), **pas** de case native blanche ni de vert : actif en `indigo`, inactif en gris chaud. Cible tactile de 44 px.

### 8.2 Fichiers

| Fichier | Rôle |
|---|---|
| `app/app/[shop]/parametres/notifications/page.tsx` | la page (Suspense, `getMe`/`getMyShops` pour la voix) |
| `features/notifications/actions.ts` | Server Actions : `saveEvents`, `resetEvents`, `sendTest` (zod, liste fermée d'identifiants) |
| `features/notifications/event-row.tsx` | une ligne avec son interrupteur |
| `features/notifications/text.ts` | libellés et aides des identifiants connus |
| `features/notifications/data.ts` | `getNotifications(slug)` |
| `lib/types.ts` | `NotificationsSettings`, `NotificationEvent` |
| `lib/messages.ts` | `invalid_event`, `notifications_disabled`, `email_failed` |
| `lib/voice.ts` | phrases de l'en-tête selon le rôle |

### 8.3 Visuel

Nuit, lumière orange, indigo, ocre, corail ; **ni vert ni blanc pur**. Cartes `vitre`. Une icône d'enveloppe dessinée dans le trait de `nav-links.tsx` (`viewBox 0 0 24 24`, trait 1,7, bouts ronds) pour l'entrée de liste : `M3.5 6.5h17v11h-17zM3.5 7l8.5 6.5L20.5 7`. Pas de cloche. Mouvement : seulement `transform` et `opacity`, jamais en boucle ; `prefers-reduced-motion` respecté. Mobile : une colonne, pas de « lames ». Maquette autonome : `docs/maquettes/notifications/page.html` (trois rôles) ; e-mails : `docs/maquettes/notifications/emails.html`.

## 9. Partie backend détaillée, pour Koffi

### 9.1 Structure

Nouvelle application `notifications/` ajoutée à `INSTALLED_APPS` et `config/urls.py` :

```
notifications/
  models.py        NotificationPreference, NotificationState
  events.py        registre fermé (id, droit requis, défauts par rôle, ready) + resolve(membership, event)
  recipients.py    destinataires d'un événement pour une boutique (3.2), en 2 requêtes
  compose.py       sujets et corps, texte + HTML, selon le rôle ; aucun accès réseau
  send.py          prise de fenêtre (5.3), retenus, plafonds (5.4), disjoncteur (5.5), envoi sur une connexion
  triggers.py      notify_new_order(order_id), notify_low_stock(shop_id, product_ids), notify_order_cancelled(order_id) : tout le try/except est ici
  views.py urls.py GET/PUT notifications, POST notifications/test
  management/commands/send_daily_summaries.py  send_held_notifications.py
  templates/notifications/*.txt *.html
  tests/
```

### 9.2 Branchements dans l'existant (les seuls)

- `shops/checkout.py`, `place_order` : après les écritures et la boucle du stock, `transaction.on_commit(partial(triggers.notify_new_order, order.pk), robust=True)` et, s'il y a des franchissements de seuil, `…notify_low_stock, shop.pk, ids`. Rien d'autre ne change dans la fonction (en particulier ni l'ordre des écritures, ni les erreurs).
- `shops/views.py`, `OrderDetailView.patch` : après l'enregistrement du statut, si `new_status == cancelled`, `on_commit(partial(triggers.notify_order_cancelled, order.pk), robust=True)`.
- `config/settings.py` : `EMAIL_BACKEND`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USE_TLS`, `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` lus dans l'environnement ; `EMAIL_TIMEOUT` (5 par défaut) ; `DEFAULT_FROM_EMAIL` lu dans l'environnement (aujourd'hui figé sur `akwaba.test`) ; `NOTIFICATIONS_ENABLED`.
- `.env.example` : les noms de ces variables, **sans valeur secrète**.
- `docs/contrat-api.md` : §3.2 (`invalid_event`, `notifications_disabled`, `email_failed`), §3.3 (limites), §4.3 (les routes), à la fin de l'étape 2.

### 9.3 Trois points techniques

- **Jamais de lecture de l'objet « commande » dans le callback sans le relire** : le callback reçoit un identifiant et recharge (`Order.objects.for_shop(...)`), pour ne pas dépendre de l'état d'une transaction finie.
- **Rendu** : `render_to_string` sur des gabarits fixes, autoescape actif, aucune concaténation de HTML. Le texte brut est généré à partir des mêmes données, pas du HTML.
- **Aucune adresse ni contenu dans les journaux** : `membership_id`, `shop_id`, `event`, `count`.

### 9.4 Migration

`notifications/migrations/0001_initial.py` : deux tables, deux contraintes d'unicité, une clé étrangère chacune vers `shops.Membership` avec `on_delete=CASCADE`. Dépendance : la dernière migration `shops` **de main** au moment de l'écriture (`0008_versions_vitrine`) : si P04 ou un autre chantier en ajoute avant l'intégration, la dépendance se corrige à ce moment (une seule ligne). Aucune migration `shops`, aucune migration `audit`.

## 10. Configuration à prévoir en production (à faire par la personne qui déploie)

Sans cela, **rien ne part** : Django retombe sur l'affichage dans la console (comme en développement) et la page dit « l'envoi n'est pas activé ».

### 10.1 Variables d'environnement (noms ; les valeurs vont dans `.env`, jamais dans Git)

| Variable | Rôle |
|---|---|
| `NOTIFICATIONS_ENABLED=1` | active les envois ; 0 : les événements sont ignorés et les commandes de gestion le disent |
| `DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend` | |
| `EMAIL_HOST`, `EMAIL_PORT` (587), `EMAIL_USE_TLS=1` | serveur d'envoi (SMTP) |
| `EMAIL_HOST_USER`, `EMAIL_HOST_PASSWORD` | identifiants du service d'envoi (secret) |
| `DJANGO_EMAIL_TIMEOUT=5` | délai de connexion, en secondes |
| `DJANGO_DEFAULT_FROM_EMAIL="Akwaba <notifications@votre-domaine>"` | l'expéditeur, sur **un domaine que vous possédez** |
| `FRONTEND_URL=https://…` | l'adresse publique : elle sert à fabriquer les liens des e-mails (sans elle, ils pointent vers `localhost`) |

### 10.2 Délivrabilité

Pour que les e-mails arrivent ailleurs que dans les spams : l'expéditeur sur un **domaine à soi**, avec les enregistrements **SPF**, **DKIM** et **DMARC** du service d'envoi publiés dans le DNS du domaine. Un expéditeur en `gmail.com` ou `akwaba.test` depuis un autre serveur est refusé ou classé indésirable.

### 10.3 PythonAnywhere (hébergement gratuit)

D'après la documentation de PythonAnywhere (à **revérifier au moment du déploiement**, ces règles changent) :
- Un compte **gratuit** ne peut sortir que vers une **liste blanche** de sites. Un serveur SMTP quelconque n'y est pas : **l'envoi d'e-mails peut y être impossible**. Les options sont : un compte payant (accès sortant libre), ou un service d'envoi dont l'adresse figure dans la liste blanche, ou un autre hébergement pour l'API. Il faut **faire le test d'envoi de 7.3 sur le serveur de production avant d'annoncer la fonction**.
- Pas de processus permanent sur un compte gratuit : c'est la raison de l'envoi direct après validation (5.1) et du disjoncteur (5.5).
- **Tâches planifiées** : le compte gratuit n'en offre qu'**une par jour**, les comptes payants une par heure ou par jour. Il faut donc planifier **une** tâche quotidienne à **20 h** : `python manage.py send_daily_summaries` (qui envoie aussi les retenus). La même heure en UTC : Abidjan n'a pas d'heure d'été. Le balayage toutes les 10 minutes (`send_held_notifications`) n'est pas possible sur le gratuit.
- Le cache en base (`createcachetable`) est déjà exigé par le contrat §2.14 ; le disjoncteur s'en sert.

### 10.4 Vérification après déploiement

1. `manage.py send_daily_summaries --dry-run` : liste qui recevrait quoi, n'envoie rien.
2. Page Notifications → « M'envoyer un e-mail de test » : l'e-mail arrive, **hors spams**, avec les bonnes couleurs et un lien « Gérer mes notifications » qui ouvre bien la page.
3. Passer une commande de test depuis la vitrine : le propriétaire reçoit « Nouvelle commande ».

## 11. Tests prévus

Backend :
- **Registre fermé** : identifiants, droits requis, défauts par rôle ; les événements non prêts sont refusés (`PUT`), absents (`GET`) et jamais envoyés.
- **Droits** : un vendeur ne voit ni ne reçoit `daily_summary` avec CA ; un gérant sans `dashboard.view` (cas d'un droit retiré dans le test) reçoit le résumé **sans** la ligne de CA ; le corps rendu ne contient aucun montant de CA (recherche du total de la journée dans le texte et le HTML) ; un droit retiré après réglage arrête les envois.
- **Aucune donnée en trop** : l'e-mail de commande ne contient ni téléphone (entier, masqué, ni suite de chiffres du numéro), ni nom du client, ni repère, ni code de réduction, ni note interne ; le lien ne contient ni jeton ni référence ni téléphone ; test sur le texte **et** sur le HTML.
- **Après validation** : une commande refusée (`out_of_stock`, `discount_invalid`, `price_changed`) n'envoie rien ; une commande réussie envoie après la validation (`captureOnCommitCallbacks`) ; un rejeu d'idempotence n'envoie rien ; une commande de démonstration n'envoie rien.
- **Jamais bloquant** : serveur d'e-mail qui lève (connexion refusée, délai) pendant une commande → 201, même corps, commande et stock intacts ; même chose pour l'annulation (statut passé) ; un bug du gabarit (patch qui lève) ne change rien non plus.
- **Anti-rafale** : 1re commande → 1 e-mail ; 4 suivantes dans la fenêtre → 0 e-mail, `held_count = 4` ; au prochain événement après la fenêtre (horloge simulée) → 1 e-mail groupé annonçant 4 autres ; `send_held_notifications` envoie le groupe puis remet à zéro ; deux prises simultanées de la fenêtre (la perdante lit zéro ligne) n'envoient qu'un message ; `held_refs` plafonné à 10 et sans donnée de client.
- **Plafonds** : 200 par jour et par boutique (le 201e est retenu, pas d'erreur) ; 20 destinataires au plus ; une seule connexion ouverte par déclencheur.
- **Disjoncteur** : après un échec, aucun nouvel essai pendant 5 minutes ; les messages sont retenus ; il se referme.
- **Destinataires** : exclus : compte de démo, inactif, mot de passe à choisir, membre retiré, événement désactivé ; changement de rôle applique les défauts du nouveau rôle sans effacer un choix explicite encore permis ; une personne dans deux boutiques a deux jeux de choix indépendants et le sujet porte le bon nom de boutique.
- **Stock bas** : seulement au franchissement (un produit déjà sous le seuil ne ré-alerte pas), à zéro aussi, plusieurs produits d'une commande dans un seul message ; stock modifié à la main : rien.
- **Résumé du jour** : une fois par jour (la 2e exécution n'envoie rien), relance après un échec, pas de message vide, bornes du jour à Abidjan, `--dry-run` n'envoie ni ne note rien, `--date` futur refusé, boutiques de démo exclues, code de sortie ≠ 0 si tout échoue.
- **Routes** : `GET` et `PUT` pour chaque rôle ; 404 non-membre et autre boutique ; `invalid_event` identique pour inconnu, non prêt et sans droit ; valeur égale au défaut supprime la ligne ; `PUT` idempotent ; 429 à la 61e modification ; `sending` faux avec le backend console ; le champ `email` est celui de la personne ; 20 clés au plus ; les choix d'un membre ne changent rien pour un autre.
- **Gabarits** : un nom de produit `<script>` ressort échappé en HTML ; un nom de boutique avec retour à la ligne ne casse pas l'en-tête ; sujet ≤ 150 caractères.
- **E-mail de test** (si D7) : part vers l'adresse du compte seulement ; 3 par heure ; 409 si l'envoi n'est pas actif ; aucune donnée de boutique dans le corps.
- **Isolation** : les e-mails de sécurité sont inchangés (leurs tests existants passent) et ne sont jamais désactivables ; `makemigrations --check` ; migration appliquée sur SQLite et PostgreSQL (CI) ; `assertNumQueries` borné pour le calcul des destinataires.

Front : `npm run lint` et `npm run build` ; page à 375 px et 1280 px pour les trois rôles ; interrupteurs utilisables au clavier et annoncés (`role="switch"`) ; message « Enregistré » en `aria-live` ; sans JavaScript, un interrupteur enregistre ; identifiant inconnu du serveur ignoré.

## 12. Décisions à valider

| # | Question | Recommandation |
|---|---|---|
| D1 | Les défauts par rôle (3.1) | **Tels qu'écrits** : propriétaire reçoit tout ; gérant reçoit commandes, stock et résumé ; vendeur ne reçoit rien tant qu'il ne l'a pas demandé. Un e-mail par commande à toute l'équipe serait vite perçu comme du bruit. |
| D2 | Un vendeur peut-il activer des e-mails ? | **Oui** (nouvelle commande, stock bas, annulée, résumé sans CA) : c'est lui qui choisit, avec ses propres droits. |
| D3 | Résumé du jour : envoyer un message vide ? | **Non.** Zéro commande et rien à traiter : pas d'e-mail. Un résumé « il ne s'est rien passé » fait désactiver tout le reste. |
| D4 | Fenêtre anti-rafale de 10 minutes, première commande tout de suite ? | **Oui.** Sur l'hébergement gratuit, les messages retenus ne partent qu'au prochain événement ou au balayage quotidien : c'est une limite assumée, à ne pas cacher. Si vous préférez ne jamais retenir, il faut un processus de fond (hébergement payant). |
| D5 | Une file d'envoi (table « boîte d'envoi » + processus) ? | **Pas maintenant.** Le gratuit n'a pas de processus de fond ; l'envoi direct après validation, borné (5 s, disjoncteur, plafonds), suffit, et un échec retombe en « retenu ». On bascule quand un worker existe. |
| D6 | Stock bas aussi quand quelqu'un modifie le stock à la main ? | **Non** : il le sait. Seules les ventes déclenchent. |
| D7 | Bouton « M'envoyer un e-mail de test » ? | **Oui** : c'est le moyen de vérifier la configuration de production, surtout sur PythonAnywhere. Il n'écrit qu'à l'adresse du compte, 3 par heure. |
| D8 | Journaliser les changements de préférences ? | **Non.** Ce n'est pas une action sensible (ce sont ses propres e-mails, vers sa propre adresse) et le journal du propriétaire n'a pas à savoir qui désactive quoi. Alice peut demander l'inverse : ce serait `notification_prefs_changed` (B, INFO, détail : liste des événements modifiés) + migration audit. |
| D9 | Lien de désabonnement en un clic ? | **Non.** Il exigerait un jeton dans l'adresse, ce qu'on s'interdit. « Gérer mes notifications » mène à la page, après connexion. Ce sont des e-mails de service envoyés à l'équipe, pas de la prospection. |
| D10 | Enregistrement immédiat ou bouton « Enregistrer » ? | **Immédiat**, avec confirmation annoncée. Moins d'oubli, et c'est le geste des interrupteurs. |
| D11 | Nom du client dans l'e-mail ? | **Non**, ni prénom ni nom. Référence, nombre d'articles, total, mode de paiement, ville ou commune : assez pour décider d'ouvrir. |
| D12 | Le total d'une commande, dans l'e-mail d'un vendeur ? | **Oui** : il le lit déjà dans la liste des commandes. Le total **du jour**, non (c'est un chiffre d'affaires). |

## 13. Choix visuels à soumettre à l'utilisateur

1. **Le bandeau des e-mails** : `encre` avec filet orange (retenu) ou crème avec filet orange ? L'e-mail doit rester lisible en mode sombre des messageries.
2. **Le bouton « Ouvrir la commande »** : indigo plein (retenu) ou contour ocre ?
3. **L'interrupteur** : actif indigo, inactif gris chaud (retenu). Pas de vert.
4. **Les phrases d'aide sous chaque interrupteur** : deux lignes (retenu) ou une seule, plus sèche ?
5. **Une icône d'enveloppe** pour l'entrée de liste (retenu) plutôt qu'une cloche, comme pour le reste de l'interface.

## 14. Risques

- **L'envoi peut être impossible en production gratuite.** Le contrat l'écrit en clair (10.3) et la page le dit à la personne. Tant que l'e-mail de test n'arrive pas en production, **la fonction ne doit pas être annoncée**.
- **Adresse non vérifiée** : une adresse tapée par le propriétaire pourrait être fausse. On n'écrit qu'une fois la personne entrée une fois dans son compte (3.2), et le contenu est limité à ce que le membre voit déjà. Risque résiduel : faible, à confirmer par Alice.
- **Retard ou perte apparente en cas de rafale** (hébergement gratuit) : les messages retenus ne partent qu'au prochain événement ou au balayage quotidien (D4).
- **Latence de la commande** : l'envoi se fait dans la requête qui crée la commande, après validation. Borné à 5 s par déclencheur et coupé par le disjoncteur après un échec ; sans cela, un serveur d'e-mail lent ralentirait chaque commande de vos clients.
- **Abus par commandes** : quelqu'un qui passe beaucoup de vraies commandes pourrait submerger l'équipe : fenêtre de 10 minutes par personne, plafond de 200 e-mails par jour et par boutique, et les limites existantes de la vitrine (10 commandes par heure et par IP).
- **Fuite de données par e-mail** : un e-mail sort du contrôle d'Akwaba. C'est pourquoi aucun téléphone, nom ni adresse n'y figure, le lien est protégé par la connexion, et le chiffre d'affaires reste lié à `dashboard.view`.
- **Conflits de migration** : une seule nouvelle application, une seule migration, aucun numéro partagé ; la dépendance vers `shops` se corrige à l'intégration.
- **Dépendance avec P04** : la page marche sans lui (adresse directe) ; pour qu'elle apparaisse dans la liste des paramètres, P04 doit être intégré d'abord.

---

## Revue sécurité (Alice)

*(À remplir par Alice avant l'étape 2.)*
