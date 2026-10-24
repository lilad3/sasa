# Contrat d'API — Akwaba

Version 0.4 · 20/10/2026 · **Statut : P1 et P2 implémentés et testés** (`backend/`), ainsi que la boutique publique (§4.4). Le reste du P3 reste une proposition.

Ce document est la référence commune du front (Next.js) et du back (Django + DRF). Une réponse qui n'est pas décrite ici n'existe pas : le front ne l'invente pas et le back ne l'improvise pas.

---

## 1. Architecture de confiance

```
Navigateur ──cookies HttpOnly──▶ Next.js (BFF) ──Bearer JWT + secret BFF──▶ Django /api/v1/ ──▶ SQLite
                                                                                   ▲
Intégration tierce ──────────────────────────────clé API─────────────▶ Django /api/public/v1/
```

- **Le navigateur ne parle jamais à Django.** Il parle à Next. Les Server Actions et Server Components de Next appellent Django côté serveur.
- **Le JavaScript du navigateur ne voit jamais un token.** Next les range dans des cookies HttpOnly.
- **Django ne pose aucun cookie** sur `/api/v1/`. Il authentifie uniquement par `Authorization: Bearer`. L'authentification par session DRF est désactivée, donc le CSRF ne s'applique pas à l'API. Seul l'admin Django garde session + CSRF.
- **CORS fermé** : aucune origine autorisée. Tous les appels sont de serveur à serveur.

### 1.1 Ce que Next envoie à chaque appel

| En-tête | Contenu | Pourquoi |
|---|---|---|
| `Authorization` | `Bearer <access>` | Identité de l'utilisateur |
| `X-Akwaba-Bff` | secret partagé (`BFF_SHARED_SECRET`) | Prouve que l'appel vient du BFF |
| `X-Client-IP` | IP réelle du visiteur | Sans elle, tous les visiteurs ont l'IP du serveur Next : la limitation par IP bloquerait tout le monde ou personne |
| `X-Client-UA` | User-Agent du visiteur | Libellé d'appareil dans les sessions et le journal |
| `X-Device-Id` | valeur du cookie appareil | Détection des nouveaux appareils |
| `X-Request-ID` | identifiant unique de requête | Traçabilité de bout en bout |

Django ne fait confiance à `X-Client-IP`, `X-Client-UA` et `X-Device-Id` **que si** `X-Akwaba-Bff` est valide (comparaison à temps constant). Sans secret valide, `/api/v1/` répond `403 bff_required`.

### 1.2 Cookies (posés par Next, jamais par Django)

| Cookie | Contenu | Attributs | Durée |
|---|---|---|---|
| `__Host-akw_at` | access token | HttpOnly · Secure · SameSite=Lax · Path=/ | 5 min |
| `__Host-akw_rt` | refresh token | HttpOnly · Secure · SameSite=Lax · Path=/ | 7 j · **cookie de session** en mode appareil partagé |
| `__Host-akw_dev` | identifiant d'appareil (128 bits aléatoires) | HttpOnly · Secure · SameSite=Lax · Path=/ | 1 an · **absent** en mode appareil partagé |

En développement (`http://localhost`), les noms perdent le préfixe `__Host-`.

---

## 2. Protections

### 2.1 Carte des menaces

| Menace | Parade | Où |
|---|---|---|
| Vol de token par XSS | Tokens en cookies HttpOnly, CSP stricte | Next |
| Mot de passe deviné, credential stuffing | Verrou par e-mail + limite par IP réelle + Argon2id | Django |
| Énumération des comptes | Réponses et temps identiques, que le compte existe ou non | Django |
| Refresh token volé | Rotation à chaque usage + **détection de réutilisation** | Django |
| Session impossible à couper (défaut classique du JWT) | Session serveur vérifiée à chaque requête : **révocation immédiate** | Django |
| Session oubliée sur un appareil prêté | **Mode appareil partagé** (sur mesure) | Django + Next |
| Session volée utilisée pour une action grave | **Confirmation renforcée** (sur mesure) | Django |
| Employé qui consulte le chiffre d'affaires | **Rôles par boutique** (sur mesure) | Django |
| Accès aux données d'une autre boutique (IDOR) | Requêtes toujours filtrées par boutique, `404` sinon | Django |
| Activité suspecte non vue | **Journal d'audit de la plateforme** + page « Sécurité » du marchand + alertes e-mail (sur mesure) | Django |
| Traces effacées ou retouchées après une intrusion | Journal **en ajout seul** (ORM + triggers SQLite) et **chaîné par HMAC** (sur mesure) | Django |
| Admin de la plateforme ouvert avec un mot de passe volé | **2FA obligatoire** pour entrer dans l'admin | Django |
| Prix modifié dans le panier | Prix et total recalculés côté serveur | Django |
| Double commande sur réseau mobile instable | **`Idempotency-Key`** au checkout (sur mesure) | Django + Next |
| Clé API qui fuit | Clé préfixée, hachée, avec scopes, révocable | Django |
| CSV piégé (formules Excel) | Limites d'import, neutralisation à l'export | Django |
| Fuite d'informations dans les erreurs | Format d'erreur unique, `DEBUG` coupé, `request_id` | Django |
| Bots sur le checkout | Limite par IP + champ piège | Django |

### 2.2 Mots de passe

- Hachage **Argon2id** (`argon2-cffi`). PBKDF2 reste en repli : un ancien hash est réécrit en Argon2 au login suivant.
- Règles, toutes vérifiées par Django (la jauge du front n'est qu'indicative) :
  - entre 10 et 128 caractères (la borne haute évite un déni de service par hachage de textes énormes) ;
  - absent de la liste des 20 000 mots de passe les plus courants ;
  - pas trop proche de l'e-mail, du nom ou du nom de boutique ;
  - pas uniquement numérique ;
  - **sur mesure** : pas construit sur un mot local évident (`akwaba`, `abidjan`, `babi`, `ivoire`, `cocody`, `yopougon`, `orange`, `wave`, `mtn`, `moov`, `225`…) suivi de chiffres.
- Pas de règles de composition forcées (majuscule + symbole) : on suit NIST SP 800-63B, la longueur compte plus que la complexité.

### 2.3 Tokens et sessions

| | Access | Refresh |
|---|---|---|
| Format | JWT HS256 | JWT HS256 |
| Clé de signature | `JWT_SIGNING_KEY` (distincte de `SECRET_KEY`) | idem |
| Durée | 5 min | 7 j (standard) · 8 h (appareil partagé) |
| Claims | `sub`, `sid`, `jti`, `iat`, `exp`, `iss=akwaba-api`, `aud=akwaba-bff` | idem + `token_type=refresh` |

**Session serveur.** Chaque connexion crée une ligne `UserSession` : appareil, IP, dates, mode partagé, `refresh_jti` courant. Chaque access token porte son `sid`. Django vérifie à chaque requête que la session est active, ce qui coûte une requête indexée. Conséquence : une déconnexion, « déconnecter partout » ou un changement de mot de passe coupent l'accès **immédiatement**, sans attendre l'expiration du token.

**Rotation et détection de vol.** Chaque `refresh` renvoie un nouveau refresh token, et l'ancien devient invalide. Si un refresh **déjà utilisé** revient, quelqu'un en a une copie. La session est alors révoquée, l'événement `refresh_reuse_detected` est journalisé et le marchand reçoit une alerte par e-mail.

- **Fenêtre de grâce de 10 s.** Deux requêtes parallèles du même navigateur peuvent rafraîchir en même temps. Dans les 10 s qui suivent une rotation, l'ancien refresh obtient seulement un nouvel access token (`refresh` absent de la réponse). Next ne touche alors pas au cookie refresh, qui reçoit la bonne valeur de la requête gagnante.

**Durée de vie.**
- Une session dure **30 jours au maximum**, même si elle est rafraîchie en continu. Au-delà, il faut se reconnecter.
- En mode appareil partagé, la session meurt après **15 min sans activité** : Django refuse le refresh si `last_seen_at` est trop ancien.

### 2.4 Anti brute-force et anti-énumération

| Règle | Clé | Effet |
|---|---|---|
| 5 échecs consécutifs | e-mail normalisé, **que le compte existe ou non** | `423 account_locked` pendant 15 min |
| 20 tentatives / 10 min | IP réelle | `429 too_many_requests` |
| Login complet (mot de passe, puis code si la 2FA est active) | e-mail | Remet le compteur à zéro |

- **Même réponse pour un e-mail inconnu et un mauvais mot de passe** : même statut, même code, même message. Le temps de réponse est égalisé, car Django hache un mot de passe factice quand le compte n'existe pas.
- Le verrou s'applique aussi aux e-mails inconnus, donc un `423` ne révèle pas qu'un compte existe.
- **Le verrou ne doit pas servir d'arme** contre un marchand. Quand un compte réel est verrouillé, son propriétaire reçoit un e-mail avec deux liens : « Débloquer mon compte », et « Ce n'était pas moi », qui mène au changement de mot de passe. L'e-mail ne part que si le compte existe, et l'API répond pareil dans tous les cas.
- `invalid_credentials` contient `attempts_remaining` quand il reste 3 essais ou moins, pour que le front prévienne avant le blocage.
- **Les codes 2FA faux comptent dans le même verrou**, et un mot de passe juste ne remet pas le compteur à zéro tant que la 2FA n'est pas passée. Sinon, connaître le mot de passe permettrait d'enchaîner les `mfa_token` pour deviner les codes à l'infini.
- La connexion à l'admin Django partage ce verrou et cette limite par IP.

### 2.5 Inscription : en une étape, ou en deux temps avec e-mail (sur mesure)

Le réglage `SIGNUP_EMAIL_VERIFICATION` de `backend/.env` choisit le mode. Le front le lit avec `GET /auth/signup` (`{ "email_verification": true|false }`) et affiche le bon formulaire : c'est Django seul qui décide.

**En une étape (`SIGNUP_EMAIL_VERIFICATION=0`, à activer seulement sans serveur d'e-mails).** Akwaba n'a pas encore de nom de domaine pour envoyer des e-mails qui arrivent vraiment.
1. `POST /auth/signup` avec l'e-mail, le nom, le nom de boutique **et le mot de passe**.
2. Le mot de passe est vérifié d'abord (règles du §2.2). Un mot de passe trop faible ne consomme pas d'essai.
3. Ensuite seulement viennent les limites : 5 inscriptions par heure et par IP, 3 par adresse.
4. Si l'adresse est libre : le compte et la boutique sont créés, la personne est connectée (`201 AuthResult`). Sinon : `409 email_taken`.

Ce que ce mode coûte, et comment c'est compensé :

| Risque | Pourquoi | Parade |
|---|---|---|
| Savoir si une adresse a un compte | Sans e-mail, on ne peut pas répondre pareil dans les deux cas | Les limites ci-dessus rendent le balayage lent. La connexion et « mot de passe oublié » restent muettes |
| Pré-détournement : un attaquant inscrit l'adresse d'une victime | Personne ne prouve qu'il contrôle la boîte mail | La victime récupère le compte par « Mot de passe oublié ». La réinitialisation ferme toutes les sessions, celles de l'attaquant comprises |

**En deux temps (`SIGNUP_EMAIL_VERIFICATION=1`, le réglage par défaut : aucune fuite d'existence de compte).**
1. `POST /auth/signup` avec l'e-mail, le nom et le nom de boutique. Réponse : **toujours `202`**, que l'e-mail soit libre ou non. Un mot de passe envoyé à cette étape est ignoré : il ne finit jamais dans le jeton du lien.
2. Un e-mail part avec un lien valable 24 h :
   - si l'adresse est libre, le lien permet de terminer l'inscription ;
   - si elle est déjà utilisée, l'e-mail propose plutôt de se connecter ou de réinitialiser le mot de passe.
3. `POST /auth/signup/complete` avec le jeton du lien et le mot de passe. Le compte et la boutique sont créés, et l'utilisateur est connecté.

Pourquoi ce mode est le plus sûr :
- L'inscription ne révèle pas quels e-mails ont un compte.
- Le mot de passe est choisi par la personne qui contrôle la boîte mail. Cela supprime le **pré-détournement de compte**.
- Aucun compte « fantôme » non vérifié n'est stocké : les données en attente vivent dans le jeton signé.

En développement, les e-mails s'affichent dans le terminal de Django.

### 2.6 Double authentification (2FA)

- **TOTP** (RFC 6238, `pyotp`) : codes de 6 chiffres sur 30 s, tolérance de ±1 pas. **Anti-rejeu** : le dernier pas utilisé est mémorisé, et le même code ne passe pas deux fois.
- Le secret TOTP est **chiffré au repos** (Fernet, clé `TOTP_ENCRYPTION_KEY`).
- 10 **codes de secours** au format `xxxx-xxxx`, à usage unique, insensibles à la casse et aux tirets. Seule leur empreinte HMAC est stockée, et ils sont affichés une seule fois. Utiliser un code de secours est journalisé et déclenche une alerte e-mail.
- Le `mfa_token` de l'étape 1 est signé, dure 5 min et sert une seule fois. Il accepte **3 essais** de code ; au-delà, l'utilisateur recommence depuis le mot de passe. Chaque code faux compte aussi dans le verrou du compte (§2.4).
- Activation : `setup`, qui renvoie l'URI `otpauth://`, le secret (pour une saisie à la main) et un QR en SVG, puis `confirm` avec un premier code valide. La 2FA n'est active qu'après cette confirmation.
- Désactiver la 2FA demande une confirmation renforcée, qui exige elle-même un code quand la 2FA est active.
- Un administrateur active sa 2FA depuis le serveur : `python manage.py setup_2fa <email>`, qui affiche le QR dans le terminal.

### 2.7 Confirmation renforcée (sur mesure)

Avant une action grave, Django exige une confirmation récente, avec la preuve la plus forte dont le compte dispose : le **code 2FA** si la 2FA est active, sinon le mot de passe. `POST /auth/reauth` ouvre une fenêtre de **10 min** sur la session courante. Chaque confirmation, réussie ou non, est journalisée. Sans cette fenêtre, la réponse est `403 reauth_required` et le front affiche la demande de confirmation, puis rejoue l'action.

Actions concernées :
- exporter les ventes ;
- créer une clé API ;
- désactiver la 2FA ;
- régénérer les codes de secours ;
- changer le mot de passe depuis le compte (le mot de passe actuel fait office de confirmation) ;
- changer de plan ;
- ajouter quelqu'un à l'équipe, changer son rôle, lui redonner un mot de passe provisoire ;
- supprimer la boutique (pas encore d'écran).

Pourquoi : un cookie volé ou un ordinateur laissé ouvert ne suffit pas pour vider les données de ventes ou ouvrir un accès permanent par clé API.

### 2.8 Rôles par boutique (sur mesure)

Les droits sont vérifiés par Django. Le front masque ce qui est interdit, mais c'est le serveur qui décide.

| Action | Propriétaire | Gérant | Vendeur |
|---|:-:|:-:|:-:|
| Voir le CA, les KPI et les graphiques | ✓ | ✓ | — |
| Voir et traiter les commandes | ✓ | ✓ | ✓ |
| Lire le catalogue | ✓ | ✓ | ✓ |
| Créer et modifier des produits, importer un CSV | ✓ | ✓ | — |
| Exporter les ventes | ✓ | ✓ | — |
| Écrire le mot du patron (consignes à l'équipe) | ✓ | ✓ | — |
| Lire ses consignes et confirmer « C'est noté » | ✓ | ✓ | ✓ |
| Voir l'équipe (sans les e-mails, sauf pour le propriétaire) | ✓ | ✓ | ✓ |
| Équipe, paramètres de la boutique, clés API, plan, données de démo | ✓ | — | — |

`GET /me/shops` renvoie le rôle **et** la liste `permissions` de chaque boutique. Le front s'en sert pour l'affichage, jamais comme garantie.

### 2.9 Isolation entre boutiques

- Toute route `/shops/{slug}/…` vérifie d'abord l'appartenance de l'utilisateur à la boutique.
- Un non-membre reçoit `404 not_found`, exactement comme pour une boutique inexistante. Il n'apprend pas qu'elle existe.
- Un membre sans le bon rôle reçoit `403 permission_denied`.
- Les requêtes sont **toujours** filtrées par boutique, via un manager `for_shop()` et jamais via un filtre écrit à la main dans chaque vue.
- Une commande ou un produit d'une autre boutique demandé par son `id` renvoie `404`. Des tests automatiques couvrent ces cas.
- Les identifiants publics sont des UUID, pas des entiers qui se suivent : ils ne laissent deviner ni les autres ressources ni le volume d'activité.

### 2.10 Journal d'audit de la plateforme et alertes (sur mesure)

**Ce qu'il contient.** Qui a fait quoi, quand et depuis où, en trois catégories :

| Catégorie | Événements |
|---|---|
| Sécurité | `login_succeeded` · `login_failed` · `account_locked` · `account_unlocked` · `new_device` · `refresh_reuse_detected` · `logged_out` · `session_revoked` · `password_changed` · `password_reset` · `mfa_enabled` · `mfa_disabled` · `mfa_failed` · `recovery_code_used` · `recovery_codes_regenerated` · `reauth_succeeded` · `reauth_failed` · `signup_completed` · `checkout_bot_blocked` · `member_added` · `member_role_changed` · `member_removed` · `member_password_reset` · `api_key_created` · `api_key_revoked` · `orders_exported` |
| Activité des boutiques | `shop_created` · `order_status_changed` (avec l'ancien et le nouveau statut) · `demo_data_generated` · `order_placed` · `products_imported` · `plan_changed` · `shop_updated` · `team_note_sent` |
| Administration | `admin_login_succeeded` · `admin_login_failed` · `audit_exported` · `audit_verified` |

Chaque événement porte une gravité (info, à surveiller, critique), le compte, la boutique, la cible (par exemple la référence de la commande), l'IP réelle, l'appareil et le `request_id`, qui permet de le retrouver dans les logs du serveur. Les tentatives sur des e-mails inconnus sont aussi gardées, avec l'adresse saisie : c'est ce qui rend visibles les attaques par listes d'identifiants.

**Qui le consulte.** L'exploitant de la plateforme, dans l'**admin Django** (Journal d'audit) :
- un bandeau « Dernières 24 h » (critiques, à surveiller, connexions échouées, codes 2FA refusés, comptes verrouillés), dont chaque chiffre filtre la liste ;
- des filtres par gravité, catégorie, événement, boutique et date, et une recherche par compte, IP, cible ou `request_id` ;
- un export CSV de la sélection, au format Excel français, avec les formules neutralisées ;
- un bouton « Vérifier l'intégrité ».

Entrer dans l'admin exige le mot de passe **et** un code 2FA. Exporter le journal ou vérifier son intégrité est lui-même journalisé. Le marchand, lui, voit seulement ses propres événements de sécurité des 90 derniers jours (`GET /me/security-events`).

**Le propriétaire, pour sa boutique** (la carte « Sécurité de la boutique » de sa vue d'ensemble, et Paramètres > Journal) :
- `GET /shops/{slug}/activity` : les événements de **sa** boutique sur 90 jours, toujours filtrés par `shop_id`. Avec `?type=sensible` (par défaut), seulement la catégorie Sécurité : équipe, clés, exports, robots. Avec `?type=tout`, aussi les commandes, le catalogue et les messages.
- Chaque ligne nomme l'auteur et son rôle actuel (`null` s'il a quitté la boutique), ainsi que la cible.
- Les détails sortent par **liste blanche**, type par type (`rows`, `previous_role`, `new_status`…). Rien d'autre que ces clés ne quitte le journal.
- L'IP et l'appareil ne sont montrés que pour les actions de l'équipe, jamais pour celles des clients ou des robots : le marchand n'en a pas besoin.
- `GET /shops/{slug}/security-overview` donne des faits, sans aucun secret. Le front en tire ses verdicts.
  - Qui a la 2FA dans l'équipe, et les mots de passe provisoires expirés.
  - Les clés API endormies : jamais utilisées après 7 jours, ou inutilisées depuis 30 jours. Et celles qui expirent sous 14 jours.
  - Les essais refusés sur les comptes de l'équipe en 7 jours (connexion, 2FA, confirmation, verrouillage, vol de session).
  - Le dernier export des ventes.
- Ces deux routes sont réservées au propriétaire (`shop.manage`) : `403` pour le gérant et le vendeur.

**Pourquoi on peut s'y fier.**
- **En ajout seul, à deux niveaux.** L'ORM refuse toute modification ou suppression, et des triggers SQLite refusent `UPDATE` et `DELETE` même en SQL brut. Personne, pas même un superutilisateur, ne peut retoucher l'historique depuis l'application.
- **Chaîné par HMAC.** Chaque ligne contient l'empreinte de la précédente, signée avec `AUDIT_HMAC_KEY`, une clé qui n'est pas dans la base. Si quelqu'un modifie ou supprime une ligne directement dans le fichier, « Vérifier l'intégrité » indique la première ligne touchée.
- **Pas de clé étrangère.** Supprimer un compte ou une boutique ne réécrit jamais l'historique : l'e-mail et la boutique sont copiés dans l'événement.

**Alertes e-mail au titulaire du compte** : `new_device` · `account_locked` (avec le lien de déblocage) · `refresh_reuse_detected` · `password_changed` · `password_reset` · `mfa_disabled` · `recovery_code_used` · `api_key_created`.

**Nouvel appareil.**
- Next envoie l'identifiant de son cookie appareil dans `X-Device-Id`, et Django n'en garde qu'une empreinte.
- Une connexion depuis un appareil inconnu déclenche l'alerte, sauf pour la toute première connexion du compte.
- En mode appareil partagé, rien n'est mémorisé : chaque connexion compte comme nouvelle.

### 2.11 Mode appareil partagé (sur mesure)

Pensé pour le cybercafé, le téléphone prêté et la tablette du comptoir. Il est choisi par une case au login.
- Le refresh token dure 8 h et vit dans un **cookie de session** : fermer le navigateur déconnecte.
- La session expire après 15 min d'inactivité (contrôle côté Django).
- L'appareil n'est pas mémorisé : pas de cookie `akw_dev`.
- Le front ne préremplit pas l'e-mail.
- La session est marquée « partagée » dans la liste des sessions.

### 2.12 Clés API (API publique)

- Format : `akw_live_<identifiant 8 car.>_<secret 32 car.>`. Le préfixe est reconnaissable par les outils de détection de secrets.
- Stockage : l'identifiant en clair (pour la recherche) et le **SHA-256 du secret**. La clé complète n'est **jamais** stockée et s'affiche une seule fois. Le secret étant très aléatoire, un hachage rapide suffit, et la comparaison se fait à temps constant.
- Chaque clé a ses scopes (`catalog:read`, `orders:read`) et une expiration facultative. Sa dernière utilisation (date et IP) est enregistrée, et la révocation est immédiate.
- Création : propriétaire, plan Pro ou supérieur, après confirmation renforcée.
- Limite : 120 requêtes/min par clé.
- La clé est réservée aux appels de serveur à serveur. Elle ne doit jamais apparaître dans un navigateur, et CORS est fermé.

### 2.13 Données entrantes

- **Montants** : entiers en FCFA (`XOF`, sans centimes). Jamais de flottants.
- **Checkout** :
  - le prix et le total sont recalculés côté serveur, et le prix envoyé par le client est ignoré ;
  - le client peut envoyer `expected_total` : s'il diffère du total serveur, la réponse est `409 price_changed`, pour que l'acheteur ne paie pas une surprise ;
  - le stock est décrémenté dans une transaction SQLite `IMMEDIATE` (déjà configurée), donc deux commandes simultanées ne peuvent pas rendre le stock négatif ;
  - quantité entre 1 et 99 par ligne.
- **Idempotence** :
  - `POST /storefront/{slug}/orders` exige `Idempotency-Key` (UUID), conservée 24 h ;
  - la même clé avec le même contenu renvoie la même commande, sans en créer une deuxième ;
  - la même clé avec un autre contenu renvoie `409 idempotency_conflict`.
- **Téléphone** : format ivoirien à 10 chiffres, normalisé en `+225XXXXXXXXXX`. Les préfixes acceptés sont 01, 05 et 07 (mobiles), ainsi que 21, 25 et 27 (fixes).
- **Textes** : texte brut uniquement, sans HTML (pas de XSS stocké). Longueurs bornées.
- **Import CSV** :
  - 2 Mo et 2 000 lignes au maximum ;
  - UTF-8 (avec ou sans BOM) ;
  - séparateur `,` ou `;`, car Excel en français exporte en `;` ;
  - mode `dry_run`, et import **tout ou rien** ;
  - rapport d'erreurs par ligne.
- **Export CSV** : toute cellule qui commence par `=`, `+`, `-`, `@`, une tabulation ou un retour chariot est préfixée par `'`. Cela empêche l'injection de formules dans Excel.
- **Champ piège** : le checkout contient un champ `website` invisible pour les humains. S'il est rempli, la requête renvoie `201` mais aucune commande n'est créée.

### 2.14 Réglages de production

- Django :
  - `DEBUG=0` ;
  - `SECURE_SSL_REDIRECT`, HSTS sur 1 an et `SECURE_PROXY_SSL_HEADER` ;
  - cookies admin `Secure` ;
  - `X_FRAME_OPTIONS=DENY`, `nosniff`, `Referrer-Policy: same-origin` ;
  - URL de l'admin définie dans `.env`.
- Next :
  - CSP avec nonce, `frame-ancestors 'none'`, `Permissions-Policy` minimale ;
  - la page de réinitialisation du mot de passe retire le jeton de l'URL dès l'arrivée et envoie `Referrer-Policy: no-referrer`.
- Secrets : uniquement dans `.env`, qui n'est jamais commité. Liste : `DJANGO_SECRET_KEY`, `JWT_SIGNING_KEY`, `BFF_SHARED_SECRET`, `TOTP_ENCRYPTION_KEY`, `AUDIT_HMAC_KEY`.
- Sessions de l'admin : cookie `akwaba_admin`, 2 h au maximum, `SameSite=Strict`, supprimé à la fermeture du navigateur.
- Les compteurs de limitation vivent dans un cache Django **en base** (`createcachetable`), partagé entre les processus. Avec `LocMemCache`, chaque processus aurait ses propres compteurs, et la limite serait contournée.

### 2.15 Comptes créés par le propriétaire (sur mesure)

Le propriétaire ajoute un gérant ou un vendeur depuis Paramètres > Équipe :
- c'est une action grave (accès aux commandes et aux téléphones des clients) : confirmation renforcée, journal (`member_added`), 20 créations par heure et par boutique au plus ;
- le serveur génère un **mot de passe provisoire** (3 blocs de 4 caractères sans 0/O ni 1/I/L, ≈ 59 bits), affiché **une seule fois** au propriétaire, stocké haché comme tout mot de passe ;
- il **expire après 72 h** : passé ce délai, le login renvoie `401 temporary_password_expired` et le propriétaire en régénère un (`member_password_reset`, sessions de la personne fermées) ;
- tant qu'il n'est pas remplacé, le compte ne peut **rien faire d'autre** que lire son profil et choisir son mot de passe : toute autre route répond `403 password_change_required` (permission DRF globale `PasswordChosen`), et le front redirige vers `/premiere-connexion` ;
- une adresse qui a déjà un compte est refusée (`409 account_exists`) : on n'ajoute jamais un compte existant à une boutique sans son accord ;
- retirer quelqu'un coupe son accès tout de suite (l'appartenance est revérifiée à chaque requête). S'il n'a plus aucune boutique, son compte est désactivé et ses sessions fermées.

Limites du plan (`shops/plans.py`) : Gratuit 25 produits et 1 personne ; Pro 500 produits, 5 personnes, import CSV, clés API, couleur de vitrine ; Business sans limite de produits, 20 personnes. Les commandes des clients ne sont jamais refusées pour une raison de plan.

### 2.16 Comptes de démo

Ils sont créés par `python manage.py seed_demo` et listés dans le README.
- **Maison Adjoua** (plan Pro) : une propriétaire, une gérante et un vendeur, pour voir les trois rôles.
- **Comptoir Fofana** : un propriétaire, pour vérifier qu'aucun compte ne voit la boutique d'un autre.
- Le propriétaire de Comptoir Fofana a la **2FA active**. Son secret TOTP est dans le README, pour qu'on puisse tester le login en deux étapes.
- **Un administrateur de la plateforme**, avec 2FA, pour consulter le journal dans l'admin Django.

Ils sont marqués `is_demo`. Ils ne peuvent pas changer leur e-mail ou leur mot de passe, activer ou désactiver la 2FA, ni créer de clé API : la réponse est `403 demo_restricted`. Comme leurs secrets sont publics, `seed_demo` refuse de tourner hors développement.

---

## 3. Conventions

- **Base** : `/api/v1/` pour le front (via le BFF) et `/api/public/v1/` pour les intégrations.
- **JSON** UTF-8, clés en `snake_case`, aussi dans les types TypeScript (aucune conversion).
- **Dates** : ISO 8601 en UTC (`2026-10-20T14:05:00Z`). Abidjan étant à UTC+0, l'heure affichée est la même.
- **Identifiants** : UUID v4. Les commandes ont aussi une `reference` lisible et aléatoire (`K7F-92Q`).
- **Pagination** : `?page=1&page_size=20` (100 au maximum), réponse `{ results, count, page, pages }`.

### 3.1 Format d'erreur unique

Les erreurs sont inspirées de la RFC 9457 et envoyées avec `Content-Type: application/problem+json`.

```json
{
  "status": 423,
  "code": "account_locked",
  "detail": "Trop de tentatives. Réessayez dans 15 min.",
  "retry_after": 900,
  "request_id": "req_8fK2mQ9xLwT4vB7nZ1cD"
}
```

- `code` est stable : le front choisit son propre texte selon le code. `detail` n'est qu'un texte de secours en français.
- `errors` (facultatif) contient les erreurs par champ : `{ "password": [{ "code": "password_too_common", "message": "…" }] }`.
- `retry_after` (facultatif) est en secondes, et doublé par l'en-tête `Retry-After`.
- `attempts_remaining` (facultatif) apparaît sur `invalid_credentials` et `mfa_invalid_code`.
- Une erreur 500 ne contient que le code et le `request_id` : jamais de trace ni de détail interne.

### 3.2 Catalogue des codes

| HTTP | `code` | Réaction attendue du front |
|---|---|---|
| 400 | `validation_error` | Erreurs sous les champs (`errors`) |
| 400 | `token_invalid_or_expired` | Lien d'e-mail mort : proposer d'en redemander un |
| 401 | `invalid_credentials` | Message global, avertissement si `attempts_remaining` ≤ 3 |
| 401 | `mfa_invalid_code` | Erreur sous la saisie du code |
| 401 | `mfa_token_expired` | Retour à l'étape mot de passe |
| 401 | `not_authenticated` | Redirection `/login` |
| 401 | `token_expired` | Le BFF rafraîchit puis rejoue, sans rien montrer |
| 401 | `token_invalid` | Token illisible, falsifié ou du mauvais type : effacer les cookies, `/login` |
| 401 | `session_revoked` · `session_expired` | Effacer les cookies, `/login?raison=…` |
| 403 | `reauth_required` | Fenêtre de confirmation, puis rejouer l'action |
| 403 | `permission_denied` | Le rôle ne permet pas l'action |
| 401 | `temporary_password_expired` | Mot de passe provisoire périmé : en demander un nouveau au propriétaire |
| 401 | `api_key_invalid` | Clé API inconnue, falsifiée, expirée ou révoquée (API publique) |
| 403 | `plan_limit_reached` | Proposer le plan supérieur (`limit` ou `feature` fourni) |
| 403 | `password_change_required` | Compte sur mot de passe provisoire : `/premiere-connexion` |
| 403 | `scope_missing` | La clé API n'a pas ce droit (API publique) |
| 403 | `demo_restricted` | Expliquer que c'est un compte de démo |
| 403 | `bff_required` | Ne doit jamais arriver depuis le front |
| 404 | `not_found` | Page introuvable |
| 409 | `mfa_already_enabled` · `mfa_not_enabled` · `mfa_setup_required` | État de la 2FA incompatible avec l'action : recharger la page Sécurité |
| 409 | `invalid_transition` | Statut de commande impossible |
| 409 | `shop_not_empty` | Données de démo refusées : la boutique a déjà de vraies commandes |
| 409 | `out_of_stock` | Lignes concernées dans `errors` |
| 409 | `price_changed` | Afficher le nouveau total, redemander la confirmation |
| 409 | `idempotency_conflict` | Ne doit jamais arriver depuis le front |
| 409 | `account_exists` | Adresse déjà utilisée par un compte Akwaba : en choisir une autre |
| 409 | `email_taken` | Inscription en une étape : l'adresse a déjà un compte, proposer de se connecter ou « Mot de passe oublié » |
| 409 | `password_already_chosen` | La personne a déjà son mot de passe : elle passe par « Mot de passe oublié » |
| 409 | `plan_too_small` | Passage à un plan inférieur impossible (produits, équipe ou clés en trop, détail fourni) |
| 409 | `too_many_api_keys` | 10 clés actives au maximum |
| 409 | `shop_on_vacation` | Vitrine en congé : la commande n'est pas prise |
| 413 | `file_too_large` | Import CSV refusé |
| 415 | `unsupported_file` | Import CSV refusé |
| 423 | `account_locked` | Compte à rebours depuis `retry_after` |
| 429 | `too_many_requests` | Compte à rebours depuis `retry_after` |
| 500 | `server_error` | Message neutre + `request_id` |

Les codes de mot de passe dans `errors.password` sont : `password_too_short` · `password_too_long` · `password_too_common` · `password_too_similar` · `password_entirely_numeric` · `password_local_pattern`.

### 3.3 Limites de débit

| Route | Limite | Clé |
|---|---|---|
| `POST /auth/login` | 5 échecs → verrou 15 min · 20 / 10 min | e-mail · IP |
| `POST /auth/login/2fa` | 3 essais par `mfa_token` · verrou commun avec le login · 20 / 10 min | jeton · e-mail · IP |
| `POST /auth/signup` | 3 / h · 5 / h (en une étape : comptés une fois le mot de passe accepté) | e-mail · IP |
| `POST /auth/password/forgot` | 3 / h · 10 / h | e-mail · IP |
| `POST /auth/reauth` | 5 / 15 min | session |
| `POST /me/2fa/confirm` | 5 / 15 min | session |
| `POST /auth/unlock` | 10 / h | IP |
| `POST /auth/token/refresh` | 30 / min | session |
| `POST /storefront/{slug}/orders` | 10 / h | IP |
| `POST /storefront/{slug}/track` | 20 / h · 5 / h | IP · référence |
| `POST /shops/{slug}/members` | 20 / h | boutique |
| `POST /shops/{slug}/notes` | 30 / h | auteur |
| `POST /shops/{slug}/orders/{id}/notes` | 60 / h | auteur |
| `GET /shops/{slug}/settings/summary` | 120 / min | membre |
| `/api/public/v1/*` | 120 / min | clé API |
| Reste de `/api/v1/` | 300 / min | utilisateur |

---

## 4. Endpoints

Priorité : **P1** = indispensable pour la note · **P2** = protections sur mesure · **P3** = reste du produit.

### 4.1 Authentification — `/api/v1/auth/`

| | Méthode et route | Corps | Succès |
|---|---|---|---|
| P1 | `GET /signup` | — | `200 { email_verification }` : le mode d'inscription (§2.5) |
| P1 | `POST /signup` | `{ email, first_name, last_name, shop_name }`, plus `password` en une étape | Avec e-mail : `202` toujours. En une étape : `201` `AuthResult`, ou `409 email_taken` |
| P1 | `POST /signup/complete` | `{ token, password }` | `201` `AuthResult` |
| P1 | `POST /login` | `{ email, password, shared_device }` | `200` `AuthResult` ou `MfaChallenge` |
| P2 | `POST /login/2fa` | `{ mfa_token, code }` (TOTP ou code de secours) | `200` `AuthResult` |
| P1 | `POST /token/refresh` | `{ refresh }` | `200` `TokenPair` |
| P1 | `POST /logout` | `{ refresh }` facultatif, utile si l'access a expiré | `204` toujours (session révoquée) |
| P1 | `POST /password/forgot` | `{ email }` | `202` toujours |
| P1 | `POST /password/reset` | `{ uid, token, password }` | `204` + **toutes** les sessions révoquées |
| P2 | `POST /unlock` | `{ token }` (lien de l'e-mail de verrou) | `204` |
| P2 | `POST /reauth` | `{ code }` si la 2FA est active, sinon `{ password }` | `200` `{ reauth_until }` |

Le lien de réinitialisation du mot de passe est valable 30 min et sert une seule fois : le jeton est lié au hash actuel du mot de passe.

```ts
type AuthResult = {
  status: "authenticated";
  access: string;
  refresh: string;
  access_expires_in: number;   // secondes
  refresh_expires_in: number;
  user: Me;
  shops: ShopMembership[];
};

type MfaChallenge = {
  status: "mfa_required";
  mfa_token: string;
  methods: ("totp" | "recovery_code")[];
  expires_in: number;
};

type TokenPair = {
  access: string;
  access_expires_in: number;
  refresh?: string;            // absent pendant la fenêtre de grâce : ne pas toucher au cookie
  refresh_expires_in?: number;
};
```

### 4.2 Compte — `/api/v1/me/`

| | Méthode et route | Rôle |
|---|---|---|
| P1 | `GET /me` | Profil (`Me`) |
| P1 | `PATCH /me` | `{ first_name, last_name }` |
| P1 | `GET /me/shops` | `ShopMembership[]` |
| P1 | `POST /me/password` | `{ current_password, password }` → `204`, les **autres** sessions sont révoquées |
| P2 | `GET /me/sessions` | `Session[]` |
| P2 | `DELETE /me/sessions/{id}` | `204`, révocation immédiate |
| P2 | `POST /me/sessions/revoke-others` | `204`, « déconnecter partout ailleurs » |
| P2 | `GET /me/security-events` | `SecurityEvent[]`, paginé |
| P2 | `POST /me/2fa/setup` | `{ otpauth_uri, secret, qr_svg }` · `409 mfa_already_enabled` si déjà active |
| P2 | `POST /me/2fa/confirm` | `{ code }` → `{ recovery_codes: string[] }` affichés une fois · `409 mfa_setup_required` sans `setup` préalable |
| P2 | `POST /me/2fa/disable` | Confirmation renforcée (avec code) → `204` + alerte e-mail |
| P2 | `POST /me/2fa/recovery-codes` | Confirmation renforcée → nouveaux codes, les anciens deviennent invalides |

```ts
type Me = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  mfa_enabled: boolean;
  is_demo: boolean;
  date_joined: string;
};

type Role = "owner" | "manager" | "seller";

type ShopMembership = {
  slug: string;
  name: string;
  role: Role;
  plan: "free" | "pro" | "business";
  permissions: string[];       // ex. "dashboard.view", "orders.manage", "products.write"
};

type Session = {
  id: string;
  device_label: string;        // ex. "Chrome · Android"
  ip: string;
  shared_device: boolean;
  current: boolean;
  created_at: string;
  last_seen_at: string;
};

type SecurityEvent = {
  id: string;
  type: string;                // voir §2.10, catégorie Sécurité uniquement
  label: string;               // ex. "Connexion réussie"
  severity: "info" | "warning" | "critical";
  ip: string;
  device_label: string;
  created_at: string;
};
```

### 4.3 Boutique (espace marchand) — `/api/v1/shops/{slug}/`

| | Méthode et route | Rôles | Rôle de la route |
|---|---|---|---|
| P1 | `GET /dashboard?period=7d\|30d\|90d` | propriétaire, gérant | `DashboardSummary` |
| P1 | `GET /orders?status=&q=&page=` | tous | `Order[]` paginé |
| P1 | `GET /orders/counts` | tous | `Record<OrderStatus, number>` : nombre de commandes par statut, toutes dates confondues (onglets de la liste) |
| P1 | `GET /orders/{id}` | tous | `Order` |
| P1 | `PATCH /orders/{id}` | tous | `{ status }`, transitions contrôlées |
| P1 | `POST /demo-data` | propriétaire | Génère 180 jours de données (deux fois 90 j, pour que le filtre 90d ait une période de comparaison). Relancer remplace les données de démo sans les empiler · `409 shop_not_empty` si la boutique a déjà des commandes réelles |
| ✓ | `GET /orders/{id}` · `POST /orders/{id}/notes` | lecture : tous · note : tous | La fiche renvoie `OrderDetail` (avec `notes`) ; une note interne n'est jamais visible du client |
| ✓ | `GET /products?q=&category=&stock=low\|out&page=` · `POST /products` | lecture : tous · écriture : propriétaire, gérant | Catalogue ; `403 plan_limit_reached` au-delà du plan |
| ✓ | `GET /products/overview` | tous | `{ count, active, limit, low_stock, out_of_stock, categories, csv_import }` |
| ✓ | `GET` · `PATCH` · `DELETE /products/{id}` | idem | Supprimer un produit ne change pas les commandes passées (nom et prix copiés) |
| ✓ | `POST /products/import` | propriétaire, gérant (plan Pro+) | multipart `file` + `dry_run` → `ImportReport`. CSV Excel (`;` ou `,`, UTF-8 ou Windows-1252), 512 Ko et 1 000 lignes au plus, **tout ou rien** |
| ✓ | `GET /orders/export?from=&to=` | propriétaire, gérant + confirmation renforcée | CSV `;` avec BOM, formules neutralisées, un an au plus, journalisé (`orders_exported`) |
| ✓ | `GET /plans` · `POST /plan` | propriétaire (+ confirmation renforcée pour changer) | `{ current, plans, usage }` ; `409 plan_too_small` si l'usage dépasse le plan visé |
| ✓ | `GET` · `POST /api-keys` · `DELETE /api-keys/{id}` | propriétaire (+ confirmation renforcée et plan Pro+ pour créer) | La clé complète n'apparaît que dans la réponse du `POST` ; alerte e-mail à la création |
| ✓ | `GET /activity?type=sensible\|tout&page=` | propriétaire | Journal de la boutique, 90 jours, paginé (§2.10) |
| ✓ | `GET /security-overview` | propriétaire | Faits de sécurité : 2FA de l'équipe, clés endormies, essais refusés, dernier export (§2.10) |
| ✓ | `GET` · `PATCH /settings` | propriétaire | Profil de la vitrine, couleur (Pro+), secteur (`sector`, liste fermée de 8 : `restaurant`, `mode`, `tech`, `beaute`, `epicerie`, `maison`, `artisanat`, `autre` ; jamais public), mode vacances (`vacation_active`, `vacation_message`, `vacation_until`) |
| ✓ | `GET /settings/summary` | tous | La liste des Paramètres : `{ entries: [{ id, scope?, state: { text, tone } }] }`, seulement les rubriques permises et prêtes, texte fabriqué par le serveur, aucune donnée de vente ni de client · 120 / min et par membre |
| ✓ | `GET /permissions` | tous (vendeur compris) | « Qui peut faire quoi » : `{ roles, you, permissions: [{ code, owner, manager, seller, grantable, yours }] }`, généré depuis `ROLE_PERMISSIONS` et `GRANTABLE` ; rien des droits accordés aux autres |
| ✓ | `GET /plan/history` | propriétaire | Changements de plan des 12 derniers mois (24 au plus), lus dans le journal : `{ results: [{ id, at, previous_plan, new_plan, actor: { name, is_you } }] }` |
| ✓ | `GET` · `POST /members` · `PATCH` · `DELETE /members/{user_id}` · `POST /members/{user_id}/temporary-password` | voir : tous · gérer : propriétaire (+ confirmation renforcée) | §2.15 |
| ✓ | `GET /notes?unread=1` · `POST /notes` · `POST /notes/{id}/read` · `DELETE /notes/{id}` | lire : tous · écrire : propriétaire, gérant | Le mot du patron ; `DELETE` retire la note (auteur ou propriétaire) sans l'effacer de l'historique |

Transitions autorisées pour une commande : `pending → confirmed → shipped → delivered`, et `pending` ou `confirmed → cancelled`. Toute autre transition renvoie `409 invalid_transition`.

```ts
type TeamNote = {
  id: string;
  body: string;                // texte brut, 1 000 caractères au plus
  urgent: boolean;
  author: { name: string; role: Role; is_you: boolean };
  audience: { type: "all" | "managers" | "sellers" | "member"; label: string };
  created_at: string;
  withdrawn: boolean;
  for_you: boolean;            // la note m'est adressée
  read_at: string | null;      // mon accusé de lecture
  receipts?: { name: string; read_at: string | null }[];   // propriétaire et gérants seulement
};

type Kpi = { value: number; previous: number };   // la variation se calcule côté front

type DashboardSummary = {
  period: { from: string; to: string; label: "7d" | "30d" | "90d" };
  currency: "XOF";
  kpis: { revenue: Kpi; orders: Kpi; average_basket: Kpi; customers: Kpi };
  revenue_series: { date: string; revenue: number; orders: number }[];
  previous_series: { date: string; revenue: number; orders: number }[];  // même longueur : le jour i de la période précédente
  top_products: { id: string; name: string; units: number; revenue: number }[];
  recent_orders: Order[];      // 5 dernières
  to_process: { pending: number; confirmed: number; shipped: number };  // commandes ouvertes, toutes dates confondues
  statuses: Record<OrderStatus, number>;   // commandes passées sur la période, annulées comprises
  payment_methods: { method: PaymentMethod; orders: number; revenue: number }[];
  places: { city: string; commune: string; orders: number; revenue: number }[];
  order_hours: number[][];     // 7 lignes (lundi d'abord) × 24 heures, heure d'Abidjan
  customers: { new: number; returning: number };   // client reconnu à son téléphone ; « returning » = déjà venu avant la période
  top_customers: { name: string; city: string; commune: string; orders: number; revenue: number }[];  // 5 premiers, sans téléphone
};

type OrderStatus = "pending" | "confirmed" | "shipped" | "delivered" | "cancelled";
type PaymentMethod = "cash_on_delivery" | "orange_money" | "mtn_momo" | "moov_money" | "wave"; // simulés

type Order = {
  id: string;
  reference: string;
  status: OrderStatus;
  payment_method: PaymentMethod;
  customer: { name: string; phone: string; city: string; commune: string; landmark: string };
  items: { product_id: string; name: string; unit_price: number; quantity: number; line_total: number }[];
  subtotal: number;
  delivery_fee: number;
  total: number;
  created_at: string;
};

type Product = {
  id: string;
  slug: string;
  sku: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  is_active: boolean;
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

type ImportReport = {
  dry_run: boolean;
  created: number;
  updated: number;
  errors: { line: number; field: string; code: string; message: string }[];
};
```

### 4.4 Boutique publique — `/api/v1/storefront/{slug}/` (sans compte) · **implémentée**

Ces routes n'acceptent aucun token (un visiteur connecté ou non voit la même vitrine), mais passent quand même par le BFF : sans `X-Akwaba-Bff`, la réponse est `403 bff_required`.

| | Méthode et route | Rôle |
|---|---|---|
| ✓ | `GET /storefront/{slug}` | `Storefront` : nom, description, ville, couleur d'accent, zones de livraison, moyens de paiement |
| ✓ | `GET /storefront/{slug}/products` · `GET /storefront/{slug}/products/{product_slug}` | `PublicProduct[]`, produits actifs uniquement, triés par rayon puis par nom |
| ✓ | `POST /storefront/{slug}/orders` | En-tête `Idempotency-Key` (UUID) obligatoire → `201 { reference, total, status }` · `409 shop_on_vacation` en congé |
| ✓ | `POST /storefront/{slug}/track` | `{ reference, phone_last4 }` → statut, date, total, articles, commune. Ni adresse ni téléphone en retour ; même `404` pour une référence inconnue et un numéro faux ; 5 essais par heure et par référence |

```ts
type Accent = "orange" | "indigo" | "ocre" | "lagune" | "corail"; // liste fermée : jamais de code couleur libre

type Storefront = {
  slug: string;
  name: string;
  description: string;
  city: string;
  accent: Accent;
  currency: "XOF";
  product_count: number;
  delivery_zones: { id: string; city: string; commune: string; label: string; fee: number }[];
  payment_methods: { id: PaymentMethod; label: string }[];
};

type PublicProduct = {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  price: number;
  image_url: string | null;
  in_stock: boolean;
  low_stock: boolean;     // 5 pièces ou moins
  max_quantity: number;   // min(stock, 99) : le stock exact n'est pas publié
};
```

Corps de `POST /orders` :

```json
{
  "items": [{ "product_id": "…", "quantity": 2 }],
  "customer": { "name": "…", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody", "landmark": "…" },
  "payment_method": "wave",
  "expected_total": 27000,
  "website": ""
}
```

- Le panier vit côté client. Le serveur ne le croit pas : il revalide tout au checkout.
- `city` + `commune` doivent correspondre à une zone de `delivery_zones`, sinon `400` avec `customer.city: delivery_unavailable`. Les frais viennent de la zone, jamais du client.
- Article masqué, inconnu ou d'une autre boutique : `400` avec `items.N.product_id: product_unavailable`.
- Stock insuffisant : `409 out_of_stock`, avec `items.N.quantity: [{ code, message, available }]`.
- Total différent de `expected_total` : `409 price_changed`, avec `subtotal`, `delivery_fee` et `total` recalculés.
- Chaque commande est journalisée (`order_placed`) ; un champ piège rempli est journalisé (`checkout_bot_blocked`).

### 4.5 API publique — `/api/public/v1/` (clé API)

En-tête `Authorization: Bearer akw_live_…`. La clé désigne la boutique : pas de `slug` dans l'URL.

| | Méthode et route | Scope |
|---|---|---|
| ✓ | `GET /products` | `catalog:read` |
| ✓ | `GET /orders?status=` | `orders:read` |

La clé est vérifiée à temps constant (une empreinte factice est comparée quand l'identifiant n'existe pas). Une session marchand (JWT) n'ouvre pas cette API, et une clé n'ouvre pas `/api/v1/`.

---

## 5. Preuves (tests automatiques)

Chaque protection a un test qui la démontre. Les cases cochées sont couvertes par `python manage.py test` (P1) ; les autres viendront avec le P2 et le P3.

- [x] Un e-mail inconnu et un mauvais mot de passe donnent une réponse identique (statut, corps).
- [x] Le 5e échec renvoie `423`, ainsi que les essais suivants, aussi pour un e-mail inconnu. Un login réussi remet le compteur à zéro.
- [x] Le refresh fait tourner les tokens. Réutiliser un ancien refresh hors fenêtre de grâce révoque la session.
- [x] L'access token d'une session révoquée est refusé **immédiatement**, avant son expiration.
- [x] En mode appareil partagé, le refresh est refusé après 15 min d'inactivité.
- [x] Une réinitialisation du mot de passe révoque toutes les sessions. Le lien ne sert qu'une fois.
- [x] Un code TOTP ne passe pas deux fois. Un code de secours ne sert qu'une fois.
- [x] Un vendeur reçoit `403` sur le dashboard. Une ressource d'une autre boutique renvoie `404`.
- [x] Désactiver la 2FA sans confirmation renforcée renvoie `403 reauth_required` (même mécanisme que pour les clés API du P3).
- [x] Créer une clé API sans confirmation renforcée renvoie `403 reauth_required`. Une clé révoquée ou falsifiée renvoie `401`, une clé sans le bon droit `403 scope_missing`.
- [x] La base ne contient aucun secret TOTP ni code de secours en clair.
- [x] La base ne contient aucune clé API en clair.
- [x] Un prix envoyé par le client est ignoré. La même `Idempotency-Key` ne crée qu'une commande.
- [ ] Deux commandes simultanées sur le dernier article : une seule passe.
- [x] Une cellule `=CMD()` sort neutralisée dans l'export CSV ; l'export exige une confirmation renforcée et il est journalisé.
- [x] Un compte sur mot de passe provisoire ne peut que choisir son mot de passe (`403 password_change_required` partout ailleurs) ; le provisoire expire après 72 h.
- [x] Ajouter quelqu'un à l'équipe exige une confirmation renforcée ; un gérant ne peut pas le faire ; le propriétaire ne peut être ni modifié ni retiré.
- [x] Mot du patron : un vendeur ne peut ni écrire ni accuser réception d'une note qui ne lui est pas adressée.
- [x] Suivi client : même réponse pour une référence inconnue et un numéro faux, et 5 essais par heure et par référence.
- [x] Import CSV : une ligne fausse et rien n'est importé ; mauvais type `415`, fichier trop lourd `413`, plan Gratuit `403`.
- [x] Les mots de passe `abidjan2026` et `akwaba123` sont refusés.
- [x] Inscription en une étape : le compte, la boutique et la session sont créés sans e-mail ; une adresse prise renvoie `409 email_taken` ; un mot de passe faible ne consomme pas d'essai ; la 6e inscription de l'heure depuis une IP renvoie `429`.
- [x] Inscription avec e-mail : un mot de passe envoyé à l'étape 1 n'est jamais gardé dans le jeton du lien.
- [x] Journal de la boutique : le propriétaire ne voit que sa boutique ; le gérant et le vendeur reçoivent `403` ; les détails passent par liste blanche ; l'IP d'un client n'est jamais montrée ; rien au-delà de 90 jours.
- [x] Santé de la sécurité : la 2FA de l'équipe, les clés endormies ou bientôt expirées, les essais refusés sur les comptes de l'équipe (et pas ceux d'une autre boutique) et le dernier export sont justes.
- [x] Avec `DEBUG=0`, une erreur 500 ne contient ni trace ni détail interne.
- [x] `/api/v1/` sans secret BFF renvoie `403`.
- [x] Codes 2FA : un `mfa_token` meurt après 3 codes faux, et un mot de passe connu ne permet pas de deviner les codes à l'infini (verrou commun).
- [x] Journal d'audit : l'ORM et le SQL brut refusent toute modification ou suppression ; une ligne retouchée ou supprimée dans le fichier est détectée par la vérification de la chaîne.
- [x] Admin : le mot de passe seul ne suffit pas, un compte staff sans 2FA est refusé, un marchand n'entre pas, et le journal reste en lecture seule même pour un superutilisateur.
- [x] Export du journal : une cellule `=HYPERLINK(…)` sort neutralisée.
- [x] Sessions : en fermer une la coupe immédiatement ; « déconnecter partout ailleurs » garde la session courante ; impossible de fermer la session d'un autre compte.
- [x] Nouvel appareil, vol de session, changement de mot de passe et désactivation de la 2FA envoient une alerte e-mail.

---

## 6. Dépendances à ajouter

| Paquet | Pour |
|---|---|
| `argon2-cffi` | Hachage Argon2id |
| `pyotp` | 2FA TOTP |
| `cryptography` | Chiffrement Fernet des secrets TOTP |
| `segno` | QR code SVG de la 2FA, en pur Python |

`argon2-cffi` est installé depuis le P1, et `pyotp`, `cryptography` et `segno` depuis le P2. `django-cors-headers` a été retiré : avec CORS fermé, il ne servait à rien.
