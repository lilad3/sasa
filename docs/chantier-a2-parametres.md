# Chantier A2 · P04 : Paramètres, le cadre

Branche `claude/a2-parametres`, **sur `main`** (après le lot 3 de P5). **Étape 1 : ce fichier est le contrat, rien n'est codé.** Il est validé par l'utilisateur avant l'étape 2. Frontend : Marc. Backend : Koffi (§5).

Rappels communs (ceux de `chantier-p5.md`) :
- migrations nouvelles seulement, compatibles SQLite et PostgreSQL. D'autres chantiers en ajoutent en parallèle : ici les migrations sont citées **sans numéro** (`shops 00NN_secteur`), la renumérotation se fait à l'intégration ;
- tout se décide côté serveur (`ShopScopedView`, `effective_permissions`), les données passent par `.for_shop()` ;
- un non-membre reçoit 404, un droit manquant 403 ;
- chaque action sensible : `record()`, action dans `audit/actions.py`, liste blanche `DETAILS` d'`activity.py`, migration audit (liste `choices`). **Ce chantier n'ajoute aucune action** : le secteur passe par `shop_updated` (§3.2) ;
- textes saisis : `plain_text`. Erreurs : problem+json existant. Jamais de HTML.

| Lot | Branche | État |
|---|---|---|
| P04 · Paramètres, le cadre | `claude/a2-parametres` | **contrat à valider**, rien n'est codé |

---

## 1. Ce qui change, en deux phrases

Aujourd'hui `/app/{shop}/parametres` a quatre onglets (`?onglet=boutique|plan|cles|journal`), réservés à `shop.manage` (sauf une page « La vitrine » avec le seul logo pour un gérant qui a `storefront.edit`). La sécurité personnelle est sur `/securite`, l'équipe sur `/personnel`.

Demain, **Paramètres est une liste d'entrées, comme chez Shopify** : chaque entrée ouvre sa page, chaque ligne **affiche son état** (« Logo manquant », « Pro · 9 900 F par mois »…), et une recherche en bas de l'écran mène à la bonne entrée. Les onze entrées sont dans la configuration ; **seules six s'affichent** tant que les autres pages n'existent pas.

## 2. La configuration unique des entrées

Un seul fichier décrit les entrées, côté front : `features/settings/entries.ts`. La liste, la recherche, les redirections et le titre des pages le lisent. Ajouter une rubrique plus tard (P05, P06…) = une ligne et un dossier.

```ts
export type EntryId =
  | "general" | "forfait" | "utilisateurs" | "paiements" | "livraison" | "clients"
  | "notifications" | "politiques" | "canaux" | "securite" | "avance";

export type Entry = {
  id: EntryId;
  label: string;          // « Général »
  hint: string;           // une ligne grise sous le libellé quand il n'y a pas d'état (jamais vide)
  icon: string;           // chemin SVG, même trait que nav-links.tsx
  keywords: string[];     // pour la recherche, en minuscules sans accents
  ready: boolean;         // false : prévue, jamais affichée, jamais cherchée
};
```

| # | Entrée | Adresse | `ready` | Chantier | Mots-clés (extrait, la liste complète est dans le fichier) |
|---|---|---|---|---|---|
| 1 | Général | `/parametres/general` | oui | P04 | nom, description, ville, contact, logo, couleur, vacances, congé, secteur, métier |
| 2 | Forfait et facturation | `/parametres/forfait` | oui | P04 | plan, forfait, abonnement, pro, business, prix, facture, facturation, historique |
| 3 | Utilisateurs et rôles | `/parametres/utilisateurs` | oui | P04 | équipe, personnel, gérant, vendeur, rôle, droit, permission, accès, qui peut faire quoi |
| 4 | Paiements | `/parametres/paiements` | **non** | P05 | wave, orange money, mtn, moov, mobile money, paiement, espèces |
| 5 | Livraison | `/parametres/livraison` | **non** | P05 | livraison, zone, frais, délai, commune, retrait |
| 6 | Clients | `/parametres/clients` | oui | P04 | client, fidèle, fidélité, seuil, consentement (réservé P12) |
| 7 | Notifications | `/parametres/notifications` | **non** (P06 la passe à oui) | P06 | e-mail, alerte, notification, résumé, stock bas |
| 8 | Politiques | `/parametres/politiques` | **non** | P15 | retour, remboursement, conditions, confidentialité |
| 9 | Canaux de vente | `/parametres/canaux` | **non** | P14 | whatsapp, facebook, instagram, tiktok, lien, canal |
| 10 | Sécurité | `/parametres/securite` | oui | P04 | mot de passe, double authentification, 2fa, appareil, session, journal, connexion |
| 11 | Avancé | `/parametres/avance` | oui | P04 | clé, api, développeur, intégration |

Règles :
- **Une entrée non prête n'a ni ligne, ni mot-clé actif, ni dossier de page.** Une adresse tapée à la main donne `notFound()`. « wave » ne mène donc nulle part tant que P05 n'a pas passé `ready` à `true` : la recherche répond « Aucun paramètre ne correspond » (un test passe `ready` à `true` pour prouver que « wave » trouve Paiements).
- L'ordre est celui du tableau. La liste ne se réordonne jamais selon le rôle : elle se **réduit**.
- Les libellés sont du français courant et des termes Shopify. Le titre de page est celui de l'entrée ; les phrases d'aide s'écrivent selon le lecteur (`lib/voice.ts`, §7).

### 2.1 Qui voit quoi (décidé par le serveur, §4.1)

| Entrée | Propriétaire | Gérant | Vendeur |
|---|---|---|---|
| Général | tout | **le logo seulement**, avec `storefront.edit` ; sinon rien | non |
| Forfait et facturation | oui (`shop.manage`) | non | non |
| Utilisateurs et rôles | oui | oui, en lecture (voir 3.4) | non |
| Clients | oui | oui, avec `customers.loyalty` (défaut du gérant) | non |
| Sécurité | **tout** : compte + boutique | **son compte** | **son compte** |
| Avancé | oui (`shop.manage`) | non | non |

Le vendeur ne voit donc qu'**une** ligne : Sécurité. Son accès à `/parametres` ouvre directement cette page (pas de liste d'une seule ligne, 3.1).

## 3. Les pages

### 3.1 Adresses, liste, redirections

| Adresse | Effet |
|---|---|
| `/app/{shop}/parametres` | la liste. **Mobile** : la liste est la page. **Ordinateur** : liste à gauche (4 lames sur 12), contenu à droite (8 lames) ; ici, le contenu est celui de la **première entrée accessible**, rendu par le même composant que sa page propre, sans redirection (décision D1) |
| `/app/{shop}/parametres/{entree}` | la page de l'entrée. **Mobile** : plein écran, avec « ‹ Paramètres » en haut. **Ordinateur** : à droite de la liste, l'entrée courante porte `aria-current="page"` |
| un vendeur sur `/parametres` | redirigé vers `/parametres/securite` (il n'a qu'elle) |
| entrée connue, mais interdite à ce rôle | page « Réservé au propriétaire » (le texte existant, adapté par `voice.ts`), avec un lien vers la liste. **Pas** de 404 : un ancien favori doit s'expliquer |
| entrée inconnue ou non prête | `notFound()` |

**Anciens liens** (redirections 307 faites par la page `parametres/page.tsx` et par l'ancienne `securite/page.tsx`, qui reconstruisent une adresse propre sans `onglet`) :

| Ancien | Nouveau |
|---|---|
| `?onglet=boutique` | `/parametres/general` |
| `?onglet=plan` | `/parametres/forfait` |
| `?onglet=cles` | `/parametres/avance` |
| `?onglet=journal[&type=tout][&page=N]` | `/parametres/securite?type=…&page=N` (le journal de la boutique garde ses paramètres) |
| `?onglet=equipe` | `/parametres/utilisateurs` (c'était `/personnel` depuis P5 : voir D2) |
| `?onglet=` inconnu | la liste |
| `/app/{shop}/securite[?journal=N]` | `/parametres/securite[?journal=N]` (le journal personnel garde son paramètre `journal`) |

Le menu latéral (`nav-links.tsx`) : le lien fixe « Sécurité » devient **« Paramètres »** (icône `settings`, déjà dessinée) pour tous les rôles ; « La vitrine » disparaît du menu (le gérant passe par la liste). La rubrique « Sécurité » reste atteignable par la liste et par la recherche. Tous les liens internes vers `/securite` et `?onglet=` (`produits`, `ma-boutique/editor`, `add-member-form`, `security-card`, `journal`, `sidebar`) sont remplacés ; un `grep` sert de test (étape 2).

### 3.2 Chaque ligne affiche son état

Une ligne = icône, libellé, **état** sur une deuxième ligne, chevron. L'état a un ton : **normal** (texte-2) ou **attention** (point ocre devant le texte, jamais seul : le texte dit déjà de quoi il s'agit). Le ton « attention » n'est jamais rouge : rien n'est une erreur.

| Entrée | État normal | État « attention » (point ocre) |
|---|---|---|
| Général | « Maison Adjoua · Cocody » (nom · ville ; sans ville, le nom seul) | « Logo manquant » ; sinon « En vacances jusqu'au 3 nov. » (la 1re anomalie l'emporte, dans cet ordre : vacances, logo) |
| Général (gérant, logo seul) | « Logo en place » | « Logo manquant » |
| Forfait et facturation | « Pro · 9 900 F par mois » ; « Gratuit » seul pour le plan gratuit | « Pro · 48 produits sur 50 » quand une limite chiffrée est atteinte à 90 % ou plus |
| Utilisateurs et rôles | « 4 personnes » (« 1 personne » si seule) | pour le propriétaire seulement : « 4 personnes · 1 n'a pas encore choisi son mot de passe » |
| Clients | « Fidèle dès 3 commandes » (« dès 1 commande » au singulier) | – |
| Sécurité | « Double authentification active » | « Activez la double authentification » (état de **sa** double authentification, jamais celle d'un autre) |
| Avancé | « 2 clés actives » ; « Aucune clé » | – (sur le plan Gratuit : « Réservé au plan Pro », ton normal) |

Aucun état ne contient de chiffre d'affaires, de nom de client, de téléphone ni d'e-mail. Les montants sont ceux du **prix du plan**, pas de ventes.

### 3.3 La recherche, en bas

- Un champ **en bas de l'écran** : sur mobile, fixé au bas (au-dessus de la zone sûre de l'iPhone), les résultats s'ouvrent **vers le haut** ; sur ordinateur, collé au bas de la colonne de liste (`sticky bottom`).
- Libellé réel « Rechercher un paramètre » (pas seulement un `placeholder`). Motif ARIA *combobox* : `role="combobox"`, `aria-expanded`, `aria-controls`, liste `role="listbox"`, flèches haut/bas, Entrée ouvre, Échap ferme. Résultats annoncés dans une zone `aria-live="polite"` (« 2 résultats »).
- Cherche dans libellé + mots-clés, **sans accents ni casse** (`wave`, `Wave`, `ÉQUIPE` = `equipe`), par préfixe de mot. Au plus 5 résultats. Rien d'autre qu'une entrée : pas de recherche dans les données.
- **Elle ne cherche que dans les entrées que cette personne voit** (la liste filtrée par le serveur, 4.1) : un vendeur qui tape « clé » n'apprend pas qu'une page Avancé existe.
- Aucune requête réseau : tout se fait dans le navigateur, sur la configuration et la liste reçue.

### 3.4 Détail des entrées livrées

**1 · Général** (`shop.manage` ; gérant avec `storefront.edit` : logo seul).
- Formulaire existant (`ProfileForm`) : nom, description, ville, couleur (limitée par plan, inchangée). Le contact reste ce que le formulaire connaît aujourd'hui (aucun champ nouveau, **D3**). `LogoForm` et `VacationPanel` : inchangés.
- **Nouveau champ « Secteur »** : liste fermée de 8 choix, présentée en boutons-radio (pas de texte libre). Valeurs et libellés :

| Valeur | Libellé |
|---|---|
| `restaurant` | Restaurant |
| `mode` | Mode et vêtements |
| `tech` | Tech et électronique |
| `beaute` | Beauté et soins |
| `epicerie` | Épicerie et alimentation |
| `maison` | Maison et déco |
| `artisanat` | Artisanat |
| `autre` | Autre (par défaut) |

  Aide : « Cela nous aide à vous proposer le bon thème et les bons réglages. Vos clients ne le voient pas. » Le secteur **n'est pas public** : `GET /storefront/{slug}` ne le renvoie pas.
- Gérant avec `storefront.edit` : la page n'affiche que le logo et la phrase « Le propriétaire gère le reste. ».

**2 · Forfait et facturation** (`shop.manage`).
- Haut de page : les compteurs d'utilisation et le `PlanPicker` existants, déplacés tels quels (confirmation renforcée inchangée).
- **Historique des changements de plan** : « 12 oct. 2026 · Gratuit → Pro · par Adjoua Koné », les 24 derniers, lus dans le journal (4.3). Vide : « Votre plan n'a pas changé depuis la création de la boutique. »
- **Facturation : état vide honnête.** Un bloc « Facturation » dit : « Le paiement de l'abonnement n'est pas encore en place : aucun prélèvement n'est fait, aucune facture n'est émise. Quand il le sera, vos factures apparaîtront ici. » **Rien n'est inventé** : pas de carte, pas de facture factice, pas de prochaine échéance. La phrase actuelle « Paiement simulé pour l'instant » est remplacée par ce bloc.

**3 · Utilisateurs et rôles** (propriétaire et gérant ; le gérant en lecture).
- Section **Votre équipe** : liste compacte (prénom, nom, rôle, « vous »), avec le bouton « Gérer mon personnel » vers `/personnel`. **`/personnel` reste la seule page où l'on ajoute, retire, change un rôle ou accorde un pouvoir** : on ne duplique ni `AddMemberForm`, ni `MemberRow`, ni les messages, ni la présence (D2).
- Section **Qui peut faire quoi** (4.2) : un tableau rôles en colonnes, droits en lignes, regroupés (Commandes, Produits, Clients, Équipe, Boutique), avec trois états en texte : « Oui », « Non », « Si le propriétaire l'accorde » (gérant, droits `GRANTABLE`). La colonne « Vous » est mise en avant. Sur mobile : une carte par rôle, pas de tableau large.
- Libellés des droits : `features/settings/grants.ts` (§7).

**6 · Clients** (`customers.loyalty`).
- Le seuil de fidélité (1 à 50), réglé par `PATCH customers/settings` existant, journalisé par `loyalty_threshold_changed` (déjà). Le formulaire quitte la page Clients ? **Non** : il y reste aussi (le gérant l'y trouve en travaillant) ; la page Paramètres réutilise le même composant, c'est un second **accès**, pas un second formulaire.
- Une section **Consentement** réservée à P12 : un emplacement dans la page, vide et **non affiché** tant que P12 n'est pas livré (un `children` facultatif, pas de texte provisoire).

**10 · Sécurité**.
- Section **Mon compte** (tous les rôles) : `MfaPanel`, `PasswordForm`, `SessionList` (appareils), `SecurityJournal` (journal personnel, `?journal=N`). Page `/securite` inchangée sur le fond, déplacée.
- Section **La boutique** (propriétaire seulement, sous « Mon compte ») : `SecurityCard` (verdicts) et `ShopJournal` (qui a fait quoi, 90 jours, `?type=` et `?page=`).
- Compte de démonstration : la bannière actuelle est conservée.

**11 · Avancé** (`shop.manage`).
- Les clés API **inchangées** (`ApiKeyForm`, liste, `RevokeKey`, aide « Utiliser une clé »).

### 3.5 Visuel (voir aussi les choix à soumettre, §8)

- Fond nuit, lumière orange, indigo/ocre/corail. **Ni vert ni blanc pur.** Les cartes restent `vitre` et `carte`.
- Icônes : onze SVG dans le trait de `nav-links.tsx` (`viewBox 0 0 24 24`, trait 1,7, bouts ronds, pas de remplissage). Les icônes à dessiner : `general` (carte de visite avec trait), `forfait` (étiquette), `utilisateurs` (réutilise `staff` en le complétant), `paiements`, `livraison`, `clients` (réutilise `customers`), `notifications` (une enveloppe, pas de cloche), `politiques` (feuille pliée), `canaux` (deux traits qui se rejoignent), `securite` (réutilise `security`), `avance` (deux chevrons). Les six dessins nécessaires aux entrées livrées sont codés à l'étape 2 ; les autres au moment de leur chantier.
- Pas de « lames » sur mobile : la liste est un bloc simple, de pleine largeur, avec des séparateurs fins. Sur ordinateur, la liste et le contenu occupent les lames de la grille (4 + 8).
- Mouvement : seulement `transform` et `opacity` ; rien ne bouge en boucle ; `prefers-reduced-motion` respecté.
- Le point « attention » est ocre `#f2b33d` avec un texte `texte` (contraste du texte, pas du point). Chaque ligne est un lien de 56 px de haut au minimum.

La maquette autonome est `docs/maquettes/parametres/index.html` : ordinateur et téléphone, avec un sélecteur de rôle (propriétaire, gérant, vendeur) et la recherche qui fonctionne.

## 4. Backend : routes

### 4.1 `GET /shops/{slug}/settings/summary`

Droit : **tout membre** (`ANY_MEMBER`, voir 5.1). Non-membre : 404.

Réponse : **seulement les entrées auxquelles la personne a droit et qui sont prêtes**, dans l'ordre de la liste.

```json
{ "entries": [
  { "id": "general",      "scope": "full", "state": { "text": "Maison Adjoua · Cocody", "tone": "normal" } },
  { "id": "forfait",      "state": { "text": "Pro · 9 900 F par mois", "tone": "normal" } },
  { "id": "utilisateurs", "state": { "text": "4 personnes · 1 n'a pas encore choisi son mot de passe", "tone": "attention" } },
  { "id": "clients",      "state": { "text": "Fidèle dès 3 commandes", "tone": "normal" } },
  { "id": "securite",     "scope": "full", "state": { "text": "Activez la double authentification", "tone": "attention" } },
  { "id": "avance",       "state": { "text": "2 clés actives", "tone": "normal" } }
] }
```

- `tone` : `normal` ou `attention`, liste fermée. `scope` (facultatif) : `full` ou `logo` pour Général ; pour Sécurité, `full` (propriétaire : compte et boutique) ou `account`.
- Le texte est fabriqué **par le serveur** (`shops/settings_summary.py`) : le front l'affiche tel quel, sans le recalculer. Il est neutre, sans « vous » sauf pour Sécurité, qui parle de la personne qui lit.
- **Ce que le serveur ne met jamais dans la réponse** : chiffre d'affaires, montants de ventes, noms ou téléphones de clients, e-mails des membres, noms des clés, identifiants, détails d'un appareil.
- Les entrées non prêtes (`IMPLEMENTED` dans `settings_summary.py`) ne sont jamais renvoyées, même pour le propriétaire. Une constante par entrée : P05, P06… la passent à vrai en ajoutant leur calcul.
- Requêtes : une pour le nombre de membres, une pour les clés actives, une pour la double authentification, une pour le logo (existence de la ligne `ShopLogo`). Pas de boucle par membre. Test : `assertNumQueries` borné.
- Limite de débit : 120 par minute et par membre (`core.ratelimit.enforce`, portée `settings_summary`).

Règles d'accès (calculées à partir de `self.permissions`, jamais du rôle seul) :

| Entrée | Condition |
|---|---|
| `general` | `shop.manage` → `scope: full` ; sinon `storefront.edit` → `scope: logo` ; sinon absente |
| `forfait`, `avance` | `shop.manage` |
| `utilisateurs` | `team.view` **et** rôle ≠ vendeur (le vendeur a `team.view` pour lire les messages, pas pour cette liste) |
| `clients` | `customers.loyalty` |
| `securite` | toujours ; `scope: full` si `shop.manage`, sinon `account` |

### 4.2 `GET /shops/{slug}/permissions`

Droit : tout membre. Sert la page « Qui peut faire quoi », **générée depuis `ROLE_PERMISSIONS` et `GRANTABLE`** : aucune liste de droits n'est recopiée dans le front, un nouveau droit apparaît sans toucher à cette route.

```json
{ "roles": ["owner", "manager", "seller"],
  "you": { "role": "manager" },
  "permissions": [
    { "code": "orders.view",   "owner": true, "manager": true, "seller": true,  "grantable": false, "yours": true },
    { "code": "storefront.edit","owner": true, "manager": false, "seller": false, "grantable": true,  "yours": false },
    { "code": "shop.manage",   "owner": true, "manager": false, "seller": false, "grantable": false, "yours": false }
  ] }
```

- `owner`, `manager`, `seller` : le droit fait partie du **rôle** (`ROLE_PERMISSIONS`). `grantable` : `code in GRANTABLE` (le gérant l'a alors **si le propriétaire l'accorde**). `yours` : `code in effective_permissions(membership)` pour le lecteur (droits accordés compris).
- Ne renvoie **ni** les droits accordés aux autres, **ni** les plafonds de réduction, **ni** les noms : seulement les règles et la situation du lecteur.
- Ordre : celui d'un tableau `PERMISSION_ORDER` fixe dans `permissions.py` (groupes lisibles), complété par les codes inconnus à la fin (pour qu'aucun droit ne manque).
- Mise en cache : aucune (peu coûteux, et un droit retiré ne doit pas rester affiché).
- Libellés : `features/settings/grants.ts` gagne `PERMISSION_TEXT: Record<string, { label, group }>` pour **tous** les codes (pas seulement les accordables). Un code sans libellé s'affiche en repli « Autre droit » et un test (5.5) le détecte avant la mise en ligne.

### 4.3 `GET /shops/{slug}/plan/history`

Droit : `shop.manage`. Lit `AuditEvent` (`action = "plan_changed"`, `shop_id`), **12 mois** au plus, 24 éléments, du plus récent au plus ancien (D5 : le journal affiche 90 jours, un historique de forfait doit remonter plus loin).

```json
{ "results": [
  { "id": "…", "at": "2026-10-12T09:14:00Z", "previous_plan": "free", "new_plan": "pro",
    "actor": { "name": "Adjoua Koné", "is_you": true } } ] }
```

- Construit par `event_payload` et la liste blanche `DETAILS["plan_changed"]` : même source que le journal, aucune donnée de plus (ni adresse IP, ni appareil).
- Pas de nouvelle action d'audit : lecture seule d'un événement existant.

### 4.4 `PATCH /shops/{slug}/settings` : le secteur

- `ShopSettingsSerializer` gagne `sector = ChoiceField(choices=Sector.choices)` (liste fermée, **jamais** de texte libre). Droit inchangé : `shop.manage`.
- `settings_payload` renvoie `sector` (valeur, pas le libellé).
- `record("shop_updated", …, fields=[…, "sector"])` : le détail `fields` existe déjà dans `DETAILS`. On ne stocke ni l'ancienne ni la nouvelle valeur (le secteur n'est pas une donnée sensible, mais le journal n'a pas besoin de plus pour dire « le secteur a changé »).
- Valeur inconnue : 400 `invalid_choice`. Gérant avec `storefront.edit` seul : 403 (le logo a sa route).

### 4.5 Ce qui ne change pas

`GET/PATCH …/settings` (hors secteur), `GET …/plans`, `POST …/plan`, `…/api-keys`, `…/activity`, `…/security-overview`, `…/customers/settings`, `…/logo`, `…/members`. Leurs droits et leur journal restent les mêmes : **le cadre n'ouvre aucun droit**. Une personne qui appelle directement une de ces routes sans y avoir droit reçoit le même 403 qu'aujourd'hui.

## 5. Partie backend détaillée, pour Koffi

### 5.1 `shops/permissions.py`

- Ajouter `ANY_MEMBER = "__member__"`. Dans `ShopScopedView.initial`, si `self.permission_by_method.get(method) == ANY_MEMBER`, on **saute** le test de droit (l'appartenance est déjà vérifiée au-dessus). Toute autre valeur garde le comportement actuel. `ANY_MEMBER` n'est **pas** un droit : il n'est dans aucun ensemble et n'apparaît pas dans `/me/shops`.
- Ajouter `PERMISSION_ORDER` (tuple de codes, groupés) et une fonction `permissions_matrix(membership)` qui construit la réponse de 4.2 à partir de `ROLE_PERMISSIONS`, `GRANTABLE` et `effective_permissions`.

### 5.2 `shops/models.py` + migration `shops 00NN_secteur`

```python
class Sector(models.TextChoices):
    RESTAURANT = "restaurant", "Restaurant"
    MODE = "mode", "Mode et vêtements"
    TECH = "tech", "Tech et électronique"
    BEAUTE = "beaute", "Beauté et soins"
    EPICERIE = "epicerie", "Épicerie et alimentation"
    MAISON = "maison", "Maison et déco"
    ARTISANAT = "artisanat", "Artisanat"
    AUTRE = "autre", "Autre"
```

`Shop.sector = CharField("secteur", max_length=12, choices=Sector.choices, default=Sector.AUTRE)`. Migration : un seul `AddField` avec défaut (SQLite et PostgreSQL le font sans réécriture lourde pour cette taille de table). Les boutiques existantes passent à `autre`. `makemigrations --check` propre. `seed_demo` : donne un secteur à chaque boutique de démo (Maison Adjoua : `mode`, Comptoir Fofana : `epicerie`).

### 5.3 `shops/settings_summary.py` (nouveau)

- `IMPLEMENTED = {"general", "forfait", "utilisateurs", "clients", "securite", "avance"}`.
- Une fonction par entrée, `state_general(shop, permissions)`, etc., qui renvoie `{"text", "tone"}`. Tous les textes sont ici (une seule source), avec les accords (« 1 personne », « 4 personnes » ; « dès 1 commande », « dès 3 commandes »). Les prix passent par `plans.spec(shop).price` et un formateur `10 000` avec espace insécable fine (même règle que `formatFcfa` du front : « 9 900 F », voir 5.4).
- `SettingsSummaryView(ShopScopedView)` : `permission_by_method = {"GET": ANY_MEMBER}`, `enforce("settings_summary", …)`, boucle sur `ENTRIES` dans l'ordre, ajoute celles dont la règle de 4.1 est vraie.
- Utilisateurs « mot de passe pas choisi » : `Membership.objects.filter(shop=…, user__must_change_password=True).count()`, **uniquement si `shop.manage`**.
- Sécurité : `TOTPDevice.objects.filter(user=request.user, confirmed_at__isnull=False).exists()`.
- Logo : `ShopLogo.objects.filter(shop=…).exists()` (`related_name="logo"`).
- Forfait : « 90 % de la limite » sur `products` et `members` seulement (les limites que le serveur applique ; les commandes sont indicatives et ne déclenchent rien). Réutilise `plans.plans_payload(shop)["usage"]`.

### 5.4 Le format des francs

Le serveur écrit « 9 900 F par mois » ; le front écrit déjà `formatFcfa` (`Intl.NumberFormat`, fr-FR, qui sépare les milliers par **U+202F**, espace fine insécable, puis « F »). Le serveur produit exactement la même chaîne et un test la compare à la valeur attendue. Si le front change, on aligne le serveur sur le front, pas l'inverse.

### 5.5 Tests prévus

Backend :
- **Qui voit quoi** : propriétaire = 6 entrées ; gérant par défaut = utilisateurs, clients, sécurité (`scope: account`) ; gérant + `storefront.edit` = en plus général (`scope: logo`) ; vendeur = sécurité seule ; non-membre 404.
- **Texte et ton** pour chaque état de 3.2, dont les accords (1 personne, 1 commande) et l'ordre vacances > logo.
- **Aucune fuite** : la réponse ne contient pas la chaîne du CA d'une commande de test, ni un e-mail, ni un téléphone de client (test sur le JSON sérialisé).
- Les entrées non prêtes ne sortent jamais (même pour le propriétaire) ; en ajoutant `"paiements"` à `IMPLEMENTED` dans le test, l'entrée sort.
- `assertNumQueries` borné ; 429 au-delà de 120 par minute.
- **Matrice des droits** : un test parcourt `ROLE_PERMISSIONS` et `GRANTABLE` et vérifie que chaque code est présent, que `grantable` et les trois rôles sont justes, et que `yours` tient compte des droits accordés. Un droit ajouté à `ROLE_PERMISSIONS` dans le test apparaît sans autre changement. La réponse ne contient pas les `grants` des autres membres.
- Test de couverture : chaque code de la matrice a un libellé dans `grants.ts` (lecture du fichier par expression régulière, ignoré s'il est absent).
- **Historique du plan** : 403 gérant, 404 autre boutique, seuls les `plan_changed` de la boutique, 12 mois, ordre, aucun champ hors liste blanche.
- **Secteur** : 8 valeurs acceptées, valeur inconnue 400, texte libre refusé, gérant 403, `shop_updated` journalisé avec `fields` contenant `sector`, défaut `autre`, secteur absent de `GET /storefront/{slug}`.
- **`ANY_MEMBER` en lecture seule** : un test parcourt toutes les vues du module `urls` et échoue si une méthode d'écriture (POST, PATCH, PUT, DELETE) l'utilise.
- `makemigrations --check` ; migration appliquée sur SQLite et sur PostgreSQL (CI).

Front :
- `npm run lint` et `npm run build`.
- Redirections : chaque ancien lien du tableau 3.1, `onglet` inconnu, `journal` et `type`/`page` conservés.
- Navigation clavier de la recherche, `wave` sans résultat puis avec résultat quand Paiements est prête, accents (`securité`, `ÉQUIPE`).
- Aucune entrée interdite dans la liste d'un vendeur ; accès direct à une page interdite = message, pas d'erreur.
- Parcours manuel à 375 px et 1280 px : pas de défilement horizontal, cibles de 44 px, focus visible.

## 6. Front : fichiers (étape 2)

| Fichier | Rôle |
|---|---|
| `features/settings/entries.ts` | la configuration unique (2) |
| `features/settings/settings-list.tsx` | la liste, client (`usePathname` pour `aria-current`), reçoit le résumé du serveur |
| `features/settings/settings-search.tsx` | la recherche en bas (3.3) |
| `app/app/[shop]/parametres/layout.tsx` | charge le résumé (Suspense), pose liste + contenu |
| `app/app/[shop]/parametres/page.tsx` | la liste sur mobile ; redirections `?onglet=` ; vendeur → sécurité |
| `parametres/{general,forfait,utilisateurs,clients,securite,avance}/page.tsx` | une page par entrée, qui reprend les composants existants |
| `features/settings/permissions-table.tsx` | « Qui peut faire quoi » |
| `features/settings/plan-history.tsx`, `billing-empty.tsx` | historique et facturation vide |
| `features/settings/sector-field.tsx` | le champ Secteur |
| `app/app/[shop]/securite/page.tsx` | ne garde que la redirection |
| `lib/types.ts` | `SettingsEntry`, `SettingsSummary`, `PermissionsMatrix`, `PlanHistoryItem`, `ShopSettings.sector` |
| `lib/voice.ts` | phrases d'aide selon le rôle (neutres) |
| `lib/messages.ts` | `invalid_choice` pour le secteur, si absent |

## 7. Textes

Selon le lecteur, en écriture neutre (jamais « le patron », « la patronne ») :

- Liste, propriétaire : « Les réglages de votre boutique, rubrique par rubrique. » Gérant : « Les réglages de {boutique} auxquels vous avez accès. » Vendeur : « Votre compte. »
- Mention des actions sensibles (propriétaire) : « Les actions qui engagent la boutique (plan, clés API) demandent de confirmer que c'est bien vous. » (la phrase existante).
- Page interdite : « Cette rubrique est réservée au propriétaire de {boutique}. Demandez-lui le changement dont vous avez besoin. »
- Recherche : libellé « Rechercher un paramètre » ; vide : « Aucun paramètre ne correspond. » ; annonce : « 2 résultats ».
- Facturation (3.4) : voir plus haut, mot pour mot.

## 8. Décisions à valider

| # | Question | Recommandation |
|---|---|---|
| D1 | Sur ordinateur, que montre `/parametres` à droite ? | **La première entrée accessible, rendue sans redirection** (Général pour le propriétaire, Clients ou Sécurité pour les autres). Une page vide « choisissez une rubrique » ferait un grand trou ; une redirection ferait deux adresses pour le même écran. Le vendeur est redirigé vers Sécurité. |
| D2 | `/personnel` : intégrer à Paramètres ou renvoyer ? | **Renvoyer.** `/personnel` garde la gestion de l'équipe, les messages et la présence (c'est un outil du quotidien). « Utilisateurs et rôles » montre l'équipe en lecture, la matrice « Qui peut faire quoi » et un bouton « Gérer mon personnel ». Aucun formulaire dupliqué. `?onglet=equipe` mène à `utilisateurs` (la demande), qui renvoie ensuite vers `/personnel`. |
| D3 | « Contact » dans Général : quel champ ? | **Pas de nouveau champ ici.** La boutique n'a ni e-mail ni téléphone de contact public aujourd'hui, et en ajouter une donnée personnelle visible en vitrine demande une décision à part (P15 Politiques ou P14 Canaux). Général garde nom, description, ville, couleur, logo, vacances, secteur. À confirmer. |
| D4 | Qui reçoit l'entrée Utilisateurs, le gérant sans pouvoirs ? | **Oui, en lecture** : savoir qui est dans l'équipe et ce que chaque rôle peut faire est utile, et le serveur ne montre ni e-mail ni droits des autres. Le vendeur ne la voit pas. |
| D5 | Combien de temps remonte l'historique du plan ? | **12 mois** (le journal de la boutique, lui, garde 90 jours). Un historique de forfait sert à comprendre une facture un jour ; 24 lignes au plus. |
| D6 | Secteur demandé à l'inscription ? | **Plus tard.** On ne change pas le parcours d'inscription dans ce chantier ; le secteur se règle dans Général. Une carte « Choisissez votre secteur » sur le dashboard pourra venir avec le choix du thème. |
| D7 | Le secteur public ? | **Non.** Il sert l'équipe produit et le thème. Si une vitrine veut un jour l'afficher, ce sera un champ de configuration à part. |
| D8 | Remplacer « Sécurité » par « Paramètres » dans le menu ? | **Oui.** « Sécurité » reste trouvable par la liste et la recherche. Un seul lien fixe évite deux portes pour la même rubrique. |
| D9 | `ANY_MEMBER` ou un nouveau droit `settings.view` ? | **`ANY_MEMBER`.** Un droit de plus se retrouverait dans `/me/shops`, dans les matrices et dans les accordages, pour ne rien protéger : la route filtre déjà ligne par ligne. |
| D10 | Les redirections sont-elles permanentes ? | **Non, 307.** Les adresses de l'espace marchand sont personnelles ; une redirection 308 se garde en cache longtemps dans le navigateur. |

## 9. Choix visuels à soumettre à l'utilisateur

1. **L'état « attention »** : point ocre + texte normal (retenu), ou texte en ocre ? Je propose le point seul, pour que la liste reste lisible quand plusieurs lignes demandent quelque chose.
2. **Le chevron de chaque ligne** : trait fin à droite (retenu), ou rien et ligne entière cliquable ?
3. **La recherche en bas sur ordinateur** : champ collé au bas de la colonne de liste (retenu) ou barre fixe sur toute la largeur du contenu ?
4. **Sur mobile, les résultats s'ouvrent vers le haut**, au-dessus du champ (clavier ouvert). Alternative : filtrer la liste elle-même en direct.
5. **Les onze icônes** (six dessinées maintenant). À regarder sur la maquette avant de les coder.

## 10. Risques

- **Divergence texte serveur / front** (francs, accords) : traitée par un test (5.4). Un état mal formulé est visible, jamais dangereux.
- **Une liste « trop fournie »** : tant que P05, P06, P14, P15 ne sont pas livrés, le propriétaire voit six lignes, le vendeur une. La liste ne promet rien (aucune ligne grisée « bientôt »).
- **Liens cassés** : beaucoup de liens pointent vers `?onglet=` et `/securite` ; le `grep` de l'étape 2 et les redirections couvrent l'ancien, mais les liens enregistrés (e-mails de sécurité envoyés avant la mise en ligne) passent par les redirections 307 : à garder au moins une version.
- **Conflits de migration** : une seule migration shops et aucune audit ici ; l'intégration renumérote.
- **Droits** : le cadre n'en crée pas ; chaque route garde sa garde. La nouveauté sensible est `ANY_MEMBER`, qui ne doit servir qu'à ces deux routes en lecture (un test échoue si une vue d'écriture l'utilise).

---

## Revue sécurité (Alice)

*(À remplir par Alice avant l'étape 2.)*
