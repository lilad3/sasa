# Chantier A2 · Fondations techniques (P02)

Base : `main` (`461d6fa`). Branche `claude/a2-fondations` (Koffi), puis `claude/a2-fondations-front` (Marc) et `claude/a2-fondations-securite` (Alice). Ce fichier est le contrat. **Rien n'est codé** avant le feu vert de l'utilisateur, relayé par Kavin.

Objectif : rendre Akwaba **récupérable, tolérant aux lenteurs, surveillé et prêt pour PostgreSQL**, sans rien changer pour les utilisateurs.

| Partie | Qui | État |
|---|---|---|
| A. Sauvegardes chiffrées | Koffi | plan |
| B. Le BFF tient les lenteurs | Marc (proposition de Koffi, §3, à reprendre) | plan |
| C. Sentry | Koffi (Django), Marc (Next) | plan |
| D. Prêt pour PostgreSQL | Koffi | plan, inventaire fait (§5.2) |
| E. `docs/exploitation.md` | Koffi, section « Sécurité en production » par Alice | plan (§6) |

Rappels communs (`akwaba-2.0/01-regles-communes.md`) : nouvelles migrations seulement (audit `0010…`), `makemigrations --check`, tout se décide côté serveur, rien de personnel dans un log, code valable sur SQLite **et** PostgreSQL.

---

## 1. Constat

- Toute la production tient dans `backend/db.sqlite3` : comptes, boutiques, commandes, clients, journal d'audit, et **les images** (`BinaryField` de `ShopLogo` et `ProductPhoto`). Il n'y a aucune sauvegarde.
- `TOTP_ENCRYPTION_KEY` et `AUDIT_HMAC_KEY` n'existent que dans le `.env` de PythonAnywhere. Sans la première, les secrets 2FA deviennent illisibles ; sans la seconde, on ne peut plus vérifier la chaîne du journal.
- SQLite tourne avec `transaction_mode: IMMEDIATE` et `timeout: 5`. Toute transaction prend le verrou d'écriture global dès son début. **C'est ce verrou qui protège aujourd'hui** la chaîne du journal, le checkout et les changements de statut (§5.2). PostgreSQL ne fait pas ça : chaque endroit doit avoir sa propre protection.
- Le BFF abandonne après 10 s (`AbortSignal.timeout(10_000)`) et ne fait qu'une tentative.
- Aucune alerte n'existe, ni pour une erreur ni pour une panne.

---

## 2. A · Sauvegardes (Koffi)

Le code se trouve dans `core/backup.py`, avec deux moteurs choisis selon `connection.vendor`, et les commandes `core/management/commands/backup_db.py` et `restore_db.py`.

### 2.1 `python manage.py backup_db`

| Étape | SQLite (aujourd'hui) | PostgreSQL (après la bascule) |
|---|---|---|
| Copie cohérente | `sqlite3.connect(NAME).backup(mem)` vers une base **en mémoire**, d'un seul tenant (`pages=-1`). En WAL, c'est un instantané cohérent qui ne bloque pas les écritures et ne recommence pas si la base bouge. | `pg_dump --format=custom` lancé en sous-processus. Le mot de passe passe par `PGPASSWORD` dans l'environnement du processus, **jamais dans la ligne de commande** (visible par `ps`). |
| Vérification | `PRAGMA integrity_check` sur la copie en mémoire. Elle doit répondre `ok`. | `pg_restore --list` sur l'archive : elle doit être lisible et contenir les tables attendues. |
| Mise à plat | `mem.serialize()` donne des octets. **Aucune copie en clair n'est écrite sur le disque.** | sortie de `pg_dump` lue en mémoire |
| Compression | `gzip` niveau 6 | déjà compressé par `pg_dump`, pas de gzip en plus |
| Chiffrement | Fernet avec `BACKUP_ENCRYPTION_KEY`, une clé distincte des autres. Fernet authentifie aussi le contenu : un fichier modifié ne se déchiffre pas. | idem |
| Écriture | `BACKUP_DIR/akwaba-AAAAMMJJ-HHMMSS.sqlite.gz.fernet`, écrit d'abord en `.part` puis renommé (pas de fichier à moitié écrit), en mode `0600` | `….pgdump.fernet` |
| Rétention | on garde **tout ce qui a moins de 7 jours** et **la dernière sauvegarde de chacun des 4 derniers dimanches** (heure d'Abidjan). Le reste est supprimé. Seuls les fichiers qui suivent ce motif de nom sont touchés. | idem |
| Résultat | une ligne : `OK akwaba-…fernet 12,4 Mo en 3,1 s sha256=…`, où l'empreinte est celle du **fichier chiffré**, pour vérifier une copie téléchargée | idem |
| Échec | message clair sur stderr et code de sortie 1 ; si Sentry est configuré, un `capture_message` sans détail personnel | idem |

Une clé absente ou invalide arrête la commande **avant** de lire la base. `BACKUP_DIR` doit être hors du dépôt (le défaut est `~/akwaba-backups`). La commande refuse un dossier situé dans `BASE_DIR` ou dans `STATIC_ROOT`.

La sauvegarde en mémoire suppose une base de quelques centaines de Mo au plus. Le fichier chiffré pèse environ 1,33 fois la base compressée, à cause du base64 de Fernet. Voir la décision 2 et la question Q1.

### 2.2 `python manage.py restore_db <fichier> [--output CHEMIN] [--force]`

1. Déchiffre le fichier (une clé fausse ou un fichier abîmé donne une erreur nette), décompresse, recharge la copie en mémoire (`deserialize`) et lance `integrity_check`.
2. **Par défaut**, écrit vers `--output`, ou `BACKUP_DIR/restauration-AAAAMMJJ-HHMMSS.sqlite3` sans `--output`. La base en service n'est jamais touchée.
3. Affiche le **nombre de lignes de chaque table** de la copie restaurée, puis **vérifie la chaîne du journal** sur cette copie. Elle passe par un alias de base temporaire, avec `verify_chain(using=…)` : `audit/services.py` prend un paramètre `using`.
4. `--force` remplace la base en service. Avant d'écrire quoi que ce soit, la commande fait une sauvegarde de l'état actuel. Ensuite, elle passe par l'API `backup` de SQLite vers le fichier en service plutôt que par une copie de fichier, ce qui respecte le WAL. Le runbook dit d'arrêter l'application web avant (« Disable » sur PythonAnywhere).
5. Sur PostgreSQL, `pg_restore` vise une base séparée (`--target-database-url`). `--force` exige la même sauvegarde préalable.

### 2.3 Copie hors du serveur

Une sauvegarde qui reste sur la même machine disparaît avec elle. Or le compte gratuit de PythonAnywhere ne laisse sortir que vers une liste blanche de domaines.

| Option | Pour | Contre |
|---|---|---|
| a. **Téléchargement manuel chaque semaine** de la sauvegarde du dimanche (page *Files* de PythonAnywhere), rangée sur l'ordinateur de l'utilisateur et dans un dossier en ligne personnel | rien à coder, aucun jeton sur le serveur, le fichier est déjà chiffré | dépend d'une habitude : jusqu'à 7 jours de perte possible |
| b. Envoi automatique vers un stockage d'un domaine autorisé (Dropbox, Google Drive…) | automatique | il faut un jeton d'écriture sur le serveur : quelqu'un qui le prend peut effacer les copies. Un service tiers à décider. |
| c. Attendre la migration (§6.4) : sauvegardes du fournisseur + nos `pg_dump` chiffrés vers un stockage objet | propre et automatique | pas avant la décision d'hébergement |

**Recommandation : (a) maintenant, (c) après la migration.** Rien n'est codé pour (b).

### 2.4 Tests prévus (`core/tests/test_backup.py`)

- La sauvegarde produit un fichier qui se déchiffre avec la clé et ne se lit pas sans elle : ni gzip ni SQLite lisibles, et une autre clé donne une erreur.
- Avec la mauvaise clé, `restore_db` échoue proprement (code 1, message, aucun fichier créé).
- Après une restauration, chaque table a les mêmes nombres de lignes que la base source et `verify_chain` est OK.
- Rétention : sur des fichiers datés artificiellement (14 jours, 5 dimanches), on garde les bons, et un fichier hors motif n'est jamais touché.
- Une clé absente arrête la commande avant toute lecture. `BACKUP_DIR` dans le dépôt est refusé.
- `restore_db` sans `--force` ne modifie jamais la base en service.
- PostgreSQL : on teste la construction de la commande `pg_dump` (pas de mot de passe dans les arguments). Le vrai `pg_dump` se vérifie à la main dans le conteneur (§5.5).

---

## 3. B · Le BFF tient les lenteurs (Marc, proposition de Koffi)

Marc reprend et complète cette partie. Les règles viennent du prompt. Les chiffres marqués « proposé » sont à trancher.

| Appel | Délai | Relance automatique |
|---|---|---|
| `GET` (pages marchandes, vitrine publique, `fetchPublicImage`) | **20 s** | une seule, après 1 s, sur erreur réseau ou 502/503/504, **seulement si la première tentative a échoué en moins de 5 s** (proposé) |
| `POST auth/token/refresh` | 20 s (proposé) | même règle, voir ci-dessous |
| Toute autre écriture (`POST`, `PUT`, `PATCH`, `DELETE`, commande, multipart) | 20 s (proposé ; 10 s aujourd'hui) | **jamais** |

Pourquoi la limite des 5 s pour le refresh :
- La fenêtre de grâce du refresh dure **10 s** (`accounts/policy.py`, `REFRESH_GRACE_PERIOD`).
- Si la première tentative expire au bout de 20 s, Django a peut-être déjà fait tourner le refresh.
- Une relance arriverait alors **après** la fenêtre de grâce. Django y verrait un vol : session coupée et e-mail « refresh réutilisé, vol probable ».
- Une relance n'est donc sûre que si l'échec a été rapide (connexion refusée ou coupée, 502/503).

Pour les GET, la même limite évite d'attendre 41 s au pire. Marc vérifie aussi le délai maximal d'une fonction sur l'offre Vercel actuelle (`maxDuration`).

Inchangé :
- `sessionIsOver` : une panne passagère ne déconnecte jamais.
- La clé d'idempotence des commandes de la vitrine.
- L'écran « Akwaba ne répond pas » : il reste pour les vraies pannes.

Tests (Marc) : un GET qui répond en 15 s passe ; un GET en 502 rapide est relancé une fois ; un POST de commande n'est **jamais** envoyé deux fois ; le refresh n'est pas relancé après un échec de plus de 5 s.

---

## 4. C · Surveillance des erreurs avec Sentry

### 4.1 Django (Koffi), `core/sentry.py` appelé depuis `settings.py`

- Si `SENTRY_DSN` est vide (en local et dans les tests), `sentry_sdk.init` n'est jamais appelé.
- `send_default_pii=False`, `include_local_variables=False` (les variables locales contiennent des mots de passe et des téléphones), `traces_sample_rate=0` (pas de suivi de performance), `max_request_body_size="never"`.
- `before_send` et `before_breadcrumb` (`core/sentry.py`) retirent ce qui reste :
  - corps de la requête, cookies, chaîne de requête ;
  - en-têtes `Authorization`, `Cookie`, `X-Akwaba-Bff`, `X-Client-IP`, `X-Client-UA`, `X-Device-Id`, `Idempotency-Key` ;
  - `user` (aucun identifiant de compte) ;
  - IP du serveur Next ;
  - le **texte des exceptions de base de données**, car sur PostgreSQL une `IntegrityError` contient la valeur en double, par exemple `Key (email)=(adjoua@…)` ;
  - les fils d'Ariane SQL et ceux de journalisation.
- Garde-fou final : toute chaîne restante qui ressemble à un e-mail ou à un numéro `+225…` est remplacée par `[retiré]`.
- Étiquette `request_id` (posée par `RequestIdMiddleware`) pour relier une erreur Sentry à une ligne de log. Étiquette `environment` = `SENTRY_ENVIRONMENT`.
- `sentry-sdk` en version exacte dans `requirements.txt`.

### 4.2 Next (Marc)

Proposition : **côté serveur seulement** (Node et proxy, via `instrumentation.ts` et `onRequestError`), sans SDK dans le navigateur pour l'instant. Deux raisons :
- les URL des pages portent des jetons (`?token=` sur `/inscription/terminer`, `/nouveau-mot-de-passe`, `/deverrouiller`) ;
- un SDK navigateur demande d'ouvrir la CSP, que P24 est en train de resserrer.

Mêmes filtres qu'en 4.1, dont la suppression des chaînes de requête. Marc vérifie si `withSentryConfig` touche au build et lit le guide de Next 16. Pas d'envoi des source maps pour l'instant, donc pas de `SENTRY_AUTH_TOKEN`.

### 4.3 Tests

- **Django** (`core/tests/test_sentry.py`) : un événement fabriqué, avec cookies, en-têtes BFF, corps JSON contenant un téléphone, `IntegrityError` contenant un e-mail et variables locales, sort de `before_send` sans aucune de ces valeurs, et le `request_id` est présent.
- **Sans DSN** : `sentry_sdk` n'a pas de client actif.
- **Vérification manuelle** avec un DSN de test : une erreur volontaire arrive vide de données personnelles (capture dans le rapport).

### 4.4 Être prévenu d'une panne (complément proposé)

Sentry ne voit que les erreurs, pas un serveur éteint. Je propose deux ajouts, dans la décision 8 :
- Une route `GET /healthz`, hors de `/api/v1/` pour qu'un service de surveillance puisse l'appeler sans le secret BFF. Elle fait un `SELECT 1`, répond `{"ok": true}` ou un 503 sans détail, et elle est limitée en débit par IP.
- Un service gratuit de surveillance de disponibilité qui l'appelle toutes les 5 minutes et envoie un e-mail. Il se règle dans le runbook, sans code.

Sentry « Crons » (si l'offre gratuite le permet) préviendrait aussi quand la sauvegarde du jour n'a pas tourné.

---

## 5. D · Prêt pour PostgreSQL (Koffi)

### 5.1 Réglages

- Si `DATABASE_URL` est définie, `DATABASES["default"]` vient de `dj_database_url.parse(DATABASE_URL, conn_max_age=60, conn_health_checks=True)`, avec `sslmode=require` quand l'hôte n'est pas local.
- Sinon, la configuration SQLite actuelle reste **exactement** telle quelle (WAL, `IMMEDIATE`, `timeout`).
- `requirements.txt` : `psycopg[binary]` et `dj-database-url`, en versions exactes.
- Le niveau d'isolation reste `READ COMMITTED`, celui par défaut. Les protections ci-dessous sont écrites pour lui.

### 5.2 Inventaire de ce qui dépend de SQLite

| # | Endroit | Aujourd'hui sur SQLite | Sur PostgreSQL tel quel | À faire |
|---|---|---|---|---|
| 1 | `audit/migrations/0002_append_only_triggers.py` | triggers en syntaxe SQLite | **`migrate` plante** (erreur de syntaxe) : impossible de créer la base | rendre 0002 sans effet hors SQLite, puis nouvelle migration `audit 0010` pour PostgreSQL (§5.3, décision 1) |
| 2 | Chaîne du journal, `audit/services.py` `record()` | `IMMEDIATE` : deux événements s'écrivent l'un après l'autre | deux événements simultanés lisent le même dernier maillon. La chaîne **bifurque** et `verify_chain` la déclare rompue. | `pg_advisory_xact_lock` (une clé fixe) avant de lire le dernier maillon. Lecture et écriture se font sous ce verrou, donc l'ordre des `id` suit celui de la chaîne. |
| 3 | Checkout, `shops/checkout.py` `place_order()` | `IMMEDIATE` sérialise toutes les commandes | stock et utilisations de réduction : **sûrs**, car ce sont des mises à jour conditionnelles (verrou de ligne et revérification). **Idempotence** : deux envois de la même clé passent la lecture, le second bute sur la contrainte unique et répond **500** au lieu de la réponse déjà donnée. `_free_reference` : même course (rare). | au début de la transaction, verrouiller la ligne de la boutique (`Shop.objects.select_for_update().get(pk=…)`). Les commandes d'une même boutique passent l'une après l'autre, comme aujourd'hui. Les autres boutiques ne sont pas bloquées. |
| 4 | Statut d'une commande, `shops/views.py` `OrderDetailView.patch` | `IMMEDIATE` : la transition est lue puis écrite sans course | deux changements simultanés partent du même ancien statut. « Livrée » et « Annulée » peuvent être acceptées toutes les deux, et le journal montre deux transitions incompatibles. | `select_for_update()` sur la commande dans la transaction (`shop_order(…, lock=True)`) |
| 5 | Limites des plans, `plans.ensure_room` (`catalog.py`, `team.py`) | **course déjà présente**, car le comptage est hors transaction | même course | verrou de la boutique, comptage et création dans une seule transaction (décision 5) |
| 6 | Photos (`photos.py` : suppression, choix de la principale) | `IMMEDIATE` | deux réordonnancements simultanés butent sur `unique_photo_position`, d'où un **500** (pas de donnée abîmée) | `select_for_update()` sur le produit |
| 7 | Compteurs `core/ratelimit.incr` (`INSERT … ON CONFLICT … RETURNING`) | atomique | atomique aussi (syntaxe PostgreSQL ≥ 9.5, `excluded` accepté) | rien ; le test de rafale devient possible (§5.5) |
| 8 | Cache en base (`DatabaseCache` : verrouillage de compte, jetons à usage unique `cache.add`) | sérialisé | `add` : une seule insertion gagne, l'autre prend une `IntegrityError`, que Django rattrape et transforme en `False` | rien ; `createcachetable` à lancer sur la nouvelle base |
| 9 | Mises à jour conditionnelles : rotation du refresh, pas TOTP, codes de secours, réductions, stock, une, publication de la vitrine | sûres | **sûres** (une ligne verrouillée par `UPDATE` est revérifiée) | rien |
| 10 | Contraintes uniques + nouvelle tentative : brouillon de vitrine, codes de réduction, une, inscription, `update_or_create` | sûres | sûres (`IntegrityError` dans un `atomic` interne) | rien |
| 11 | `BinaryField` (logo, photos) | `bytes` | `memoryview` | rien : les deux lectures passent déjà par `bytes(…)` (`logo.py:66`, `photos.py:153`) ; tests sur PostgreSQL pour le confirmer |
| 12 | Longueurs `max_length` | **non appliquées** par SQLite | appliquées : une valeur trop longue fait **échouer** l'écriture | la copie des données (§5.6) contrôle les longueurs avant d'écrire |
| 13 | Recherche `icontains` (produits, commandes) | insensible à la casse pour l'ASCII seulement | `UPPER(…) LIKE`, qui marche aussi avec les accents | changement invisible, voire meilleur ; on le note |
| 14 | Ordre des `NULL` dans les tris | `NULL` en premier | `NULL` en dernier | à repérer quand la suite tournera sur PostgreSQL (42 `order_by` dans le code) |
| 15 | Caractère NUL (`\x00`) dans un texte ou un JSON | accepté | refusé | `plain_text` le bloque déjà à la saisie ; la copie (§5.6) le contrôle |

### 5.3 Triggers du journal sur PostgreSQL (`audit/migrations/0010_triggers_postgresql.py`)

- Une fonction `audit_append_only()` qui lève une exception, et des triggers `BEFORE UPDATE OR DELETE … FOR EACH ROW` sur `audit_auditevent`.
- Le choix se fait selon `schema_editor.connection.vendor`. Sur SQLite, la migration ne fait rien.
- `0002` passe de `RunSQL` à `RunPython` avec la même condition. Les bases SQLite existantes l'ont déjà appliquée : rien ne change pour elles.
- `TRUNCATE` : voir la décision 6.

### 5.4 Contrôles

- `python manage.py makemigrations --check` sur les deux moteurs.
- Un test qui tente `UPDATE` et `DELETE` en SQL brut sur `audit_auditevent` et attend un refus, sur chaque moteur.

### 5.5 Toute la suite sur PostgreSQL

- Docker est installé sur cette machine (29.7.2). Je lance `postgres:17` en local et la suite `manage.py test` avec `DATABASE_URL=postgres://…`, et je note le résultat dans le rapport.
- Sur PostgreSQL seulement, j'ajoute des tests de **vraie concurrence**, avec des fils d'exécution dans une `TransactionTestCase` : deux commandes pour le dernier article, deux événements d'audit simultanés, deux transitions de statut. Sur SQLite en mémoire, les écritures parallèles sont impossibles : ces tests sont sautés.
- Le runbook (§6) dit comment les relancer.

### 5.6 Migration des données SQLite → PostgreSQL : `python manage.py copy_to_postgres --source CHEMIN_SQLITE`

`dumpdata`/`loaddata` est **exclu**. Le JSON de Django coupe les dates à la milliseconde. Or `created_at` entre dans l'empreinte HMAC des événements : **toute la chaîne du journal deviendrait invérifiable**.

À la place, la commande :
1. Déclare la base SQLite comme un second alias, en lecture seule.
2. Vérifie que la base cible est vide et migrée.
3. Copie modèle par modèle, dans l'ordre des dépendances (`bulk_create` par lots de 500, clés primaires gardées, dates intactes, images comprises), dans une seule transaction. Elle commence par contrôler les longueurs et les caractères NUL (§5.2, lignes 12 et 15) et s'arrête avant d'écrire si une ligne ne passe pas.
4. Remet les séquences d'identifiants à jour (`sqlsequencereset`).
5. Affiche les **nombres de lignes table par table**, source contre cible, et s'arrête en erreur au premier écart.
6. Lance `verify_chain()` sur la cible.

Les triggers du journal n'empêchent pas la copie : ils bloquent `UPDATE` et `DELETE`, pas `INSERT`. Les étapes autour (fenêtre de maintenance, retour arrière) sont dans le runbook (§6.4).

---

## 6. E · Plan de `docs/exploitation.md`

Ce document est écrit pour l'utilisateur, pas pour un développeur. Chaque geste y figure avec l'écran PythonAnywhere à ouvrir et la commande à copier.

1. **Mettre les clés à l'abri, aujourd'hui.**
   - Le tableau des variables du `.env` de production, avec pour chacune ce qu'on perd sans elle : `TOTP_ENCRYPTION_KEY` et `AUDIT_HMAC_KEY` sont irremplaçables ; `BACKUP_ENCRYPTION_KEY` est indispensable pour relire une sauvegarde ; `JWT_SIGNING_KEY`, `DJANGO_SECRET_KEY` et `BFF_SHARED_SECRET` se remplacent, au prix d'une déconnexion générale.
   - Comment les relire sur PythonAnywhere (console Bash, `cat ~/…/backend/.env`) et les ranger dans un gestionnaire de mots de passe.
   - Les règles : ne jamais les envoyer par message, ne jamais changer `AUDIT_HMAC_KEY`.
2. **Sauvegardes** : créer la tâche planifiée quotidienne (le compte gratuit en permet une), lire son résultat, télécharger la sauvegarde du dimanche chaque semaine, tester une restauration une fois par mois avec `restore_db` sans `--force`, et dire à quoi ressemble un résultat bon.
3. **Déployer une nouvelle version** : Vercel se redéploie tout seul. Sur PythonAnywhere : sauvegarde d'abord, puis `git pull`, `pip install -r requirements.txt`, `migrate`, `createcachetable`, `collectstatic`, puis « Reload ». L'ordre dépend des cas : avec une migration, on déploie Django **avant** le front.
4. **Migration vers un hébergement payant et PostgreSQL**
   - Comparaison de 3 options : PythonAnywhere payant, Render, Railway. Pour chacune : prix mensuel indicatif, accès internet sortant, PostgreSQL et sauvegardes incluses. Les prix sont relevés **sur les pages officielles au moment de l'étape 2**, avec la date. Je recommande une option.
   - Les étapes : fenêtre de maintenance annoncée, dernière sauvegarde, `copy_to_postgres`, contrôle des nombres de lignes et de la chaîne, bascule de `DATABASE_URL`, vérification.
   - Le **retour arrière** : la base SQLite n'est jamais supprimée, on remet l'ancienne valeur de `DATABASE_URL`.
5. **En cas de panne** : où regarder (journaux d'erreurs et serveur de PythonAnywhere, Sentry, journaux de Vercel, surveillance de disponibilité), les gestes simples (Reload, vérifier le quota disque, restaurer) et quand s'inquiéter.
6. **Sécurité en production** : section écrite par Alice.

---

## 7. Variables d'environnement nouvelles

Aucune n'est obligatoire au démarrage. Déployer cette branche sans les définir ne change rien à la production.

| Variable | Où | Rôle | Sans elle |
|---|---|---|---|
| `BACKUP_ENCRYPTION_KEY` | Django | clé Fernet des sauvegardes | `backup_db` et `restore_db` refusent de tourner |
| `BACKUP_DIR` | Django | dossier des sauvegardes, hors du dépôt | `~/akwaba-backups` |
| `DATABASE_URL` | Django | PostgreSQL | SQLite, comme aujourd'hui |
| `SENTRY_DSN` | Django et Next (serveur) | envoi des erreurs | Sentry éteint |
| `SENTRY_ENVIRONMENT` | Django et Next | `production`, `preview`… | `production` |

## 8. Journal d'audit

Pas de nouvelle action. Une sauvegarde est une opération d'exploitation : son résultat va dans la sortie de la tâche planifiée et, en cas d'échec, dans Sentry. Une restauration `--force` remplace le journal lui-même, donc elle ne peut pas y être consignée de façon utile. C'est la sauvegarde préalable automatique qui garde la trace de l'état d'avant (décision 4).

## 9. Fichiers touchés et conflits

- **Backend** :
  - `config/settings.py`, `requirements.txt`, `.env.example`, `backend/README.md` ;
  - nouveaux : `core/backup.py`, `core/sentry.py`, `core/management/commands/{backup_db,restore_db,copy_to_postgres}.py` ;
  - `core/views.py`, `config/urls.py` (`/healthz`, si décidé) ;
  - `audit/services.py`, `audit/migrations/0002…` et `0010…` ;
  - `shops/checkout.py`, `shops/views.py`, `shops/plans.py`, `shops/catalog.py`, `shops/team.py`, `shops/photos.py`.
- **Docs** : `docs/exploitation.md`, `docs/contrat-api.md` (`/healthz`, protections PostgreSQL).
- **Conflits possibles** :
  - `shops/checkout.py` : aucun autre chantier de la vague 1 ne le touche, mais P05 et P07 le toucheront ensuite ;
  - `audit/migrations/0010` : à renuméroter si un autre chantier de la vague 1 ajoute une migration audit ;
  - `shops/photos.py` : P01 (Marc), s'il touche au backend des photos ;
  - côté Marc, `next.config.*`, `instrumentation.ts` et `proxy.ts` : P24 (CSP) et P03.

## 10. Décisions à valider

| # | Décision | Ma recommandation |
|---|---|---|
| 1 | Modifier `audit/migrations/0002` (déjà appliquée) pour qu'elle ne fasse rien hors SQLite. C'est un écart à « nouvelles migrations seulement », mais sans ça la base PostgreSQL ne peut pas être créée. | **Oui.** Aucun effet sur les bases SQLite existantes. |
| 2 | Sauvegarde entièrement en mémoire (aucune copie en clair sur le disque), limitée à une base de quelques centaines de Mo | **Oui.** À revoir si la base dépasse ~200 Mo (Q1). |
| 3 | Copie hors du serveur | **Téléchargement manuel du dimanche** jusqu'à la migration, puis stockage objet (§2.3) |
| 4 | `restore_db --force` autorisé en production, avec une sauvegarde automatique juste avant | **Oui** : c'est le geste du jour de la panne |
| 5 | Corriger dans P02 les courses PostgreSQL (§5.2, lignes 2 à 6), dont la limite des plans, qui fuit déjà sur SQLite | **Oui, les cinq.** Sans les lignes 2 à 4, basculer abîmerait le journal ou les commandes. |
| 6 | Bloquer aussi `TRUNCATE` sur le journal (PostgreSQL). Effet de bord : une `TransactionTestCase` sur PostgreSQL ne peut plus vider la base (P24 et mes tests de concurrence). | **Avis d'Alice.** Je propose de le bloquer, de ne lancer les tests de concurrence que sur une base dédiée, et de donner à l'application un rôle PostgreSQL sans droit `TRUNCATE` ni `ALTER` le jour de la migration. |
| 7 | Sentry : serveur seulement côté Next, région UE, aucune trace de performance, aucun identifiant de compte | **Oui** |
| 8 | Route `/healthz` + surveillance de disponibilité gratuite, réglée dans le runbook | **Oui** : c'est la seule réponse à « personne n'est prévenu d'une panne » |
| 9 | Relance du BFF seulement si le premier échec a pris moins de 5 s ; écritures portées à 20 s sans relance | **Oui** (Marc et Alice à confirmer) |
| 10 | Fernet comme le prompt, avec un fichier ~33 % plus gros (base64), plutôt qu'AES-GCM en binaire | **Fernet**, sauf si Q1 montre un quota serré |

### Questions pour l'utilisateur (par Kavin)

- **Q1.** Quelle est la taille de `db.sqlite3` en production, et combien du quota disque de PythonAnywhere est déjà utilisé (le compte gratuit en a 512 Mo) ? Avec la rétention prévue, jusqu'à 11 sauvegardes coexistent.
- **Q2.** Le domaine d'envoi de Sentry est-il sur la liste blanche du compte gratuit de PythonAnywhere ? Je le vérifie sur leur page officielle à l'étape 2. S'il n'y est pas, le Sentry de Django ne marchera qu'après la migration.

---

## 10 bis. Écarts (réalisation backend, Koffi)

- Tests rangés dans `core/test_backup.py`, `test_sentry.py`, `test_healthz.py`, `test_copy_to_postgres.py` et `shops/tests/test_concurrency.py` (et non `core/tests/…` : `core/tests.py` existe déjà).
- PostgreSQL local de test : PostgreSQL **16** (Docker n'est pas disponible dans le bac à sable), pas 17.
- Les sauvegardes SQLite remettent les octets 18-19 de l'en-tête à 1 : une base en WAL ne se rouvre pas autrement une fois sérialisée. Aucun effet sur la base en service.
- `backup_db` refuse de tourner dans une transaction ouverte (l'API `backup` de SQLite y attend sans fin) ; sans effet en production.
- Verrous : `FOR NO KEY UPDATE` plutôt que `FOR UPDATE` (ne bloque pas les insertions qui pointent vers la boutique ou le produit). L'import CSV prend aussi le verrou de la boutique, pour que son comptage de la limite du plan soit juste.
- Le journal prend un verrou consultatif jusqu'à la fin de la transaction qui l'appelle : une `record()` suivie, dans la même transaction, du verrou d'une ligne déjà tenue par une autre peut produire un interblocage (PostgreSQL en annule un). Aucun parcours actuel ne le fait (`record()` vient en dernier).
- Décision 6 : `TRUNCATE` est bloqué (migration audit 0010). Les tests de concurrence lèvent les triggers le temps du nettoyage ; à ne lancer que sur une base de test dédiée.
- `copy_to_postgres` ne copie ni les sessions Django de l'admin, ni la table de cache, ni les permissions et groupes (régénérés par `migrate`) ; il refuse la copie si la source en utilise (jamais le cas aujourd'hui). Option ajoutée : `--check-only`.
- Prix d'hébergement : non relevés (pas d'accès réseau), voir `docs/exploitation.md` §6.1. Le choix reste à l'utilisateur.
- Q2 (domaine Sentry sur la liste blanche de PythonAnywhere) : non vérifiée, même raison.
- Le BFF (partie B) et Sentry côté Next (4.2) ne sont pas faits : à Marc.

## 11. Revue sécurité (Alice)

*À compléter par Alice : ce qui va, ce qui doit changer (bloquant), ce qu'elle testera.*
