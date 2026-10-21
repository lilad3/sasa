# Akwaba

La boutique en ligne des commerçants ivoiriens : une vitrine où l'on commande sans compte, le paiement à la livraison ou par Mobile Money, et un espace marchand pour suivre ses ventes en FCFA avec son équipe.

Ce dépôt est un test technique dont le critère principal est la **sécurité**. Chaque protection est décrite dans [`docs/contrat-api.md`](docs/contrat-api.md) (§2) et prouvée par un test automatique (§5).

| Dossier | Contenu | Détails |
|---|---|---|
| `backend/` | API Django + Django REST Framework : comptes, sessions, boutiques, commandes, journal d'audit | [`backend/README.md`](backend/README.md) |
| `frontend/` | Next.js 16 : landing, vitrine publique, espace marchand. Sert aussi de BFF (voir plus bas) | [`frontend/README.md`](frontend/README.md) |
| `docs/` | Le contrat d'API : architecture de confiance, protections, codes d'erreur, routes | [`docs/contrat-api.md`](docs/contrat-api.md) |

## Lancer le projet

Prérequis : Python 3.13 avec [uv](https://docs.astral.sh/uv/), et Node 20 ou plus. Deux terminaux.

**Terminal 1, l'API** (sous macOS ou Linux, remplacez `.venv/Scripts/python` par `.venv/bin/python`) :

```bash
cd backend
uv venv .venv --python 3.13
uv pip install -r requirements.txt
cp .env.example .env            # remplir les secrets : chaque ligne dit comment en générer un
.venv/Scripts/python manage.py migrate
.venv/Scripts/python manage.py createcachetable
.venv/Scripts/python manage.py seed_demo
.venv/Scripts/python manage.py runserver        # http://127.0.0.1:8000
```

**Terminal 2, le site** :

```bash
cd frontend
npm install
cp .env.example .env.local      # BFF_SHARED_SECRET = la même valeur que dans backend/.env
npm run dev                     # http://localhost:3000
```

L'inscription se fait en une étape, sans e-mail de confirmation (réglage `SIGNUP_EMAIL_VERIFICATION=0` dans `backend/.env`, voir plus bas). Les autres e-mails (mot de passe oublié, déblocage du compte, alertes de sécurité) s'affichent dans le terminal de Django en développement.

## Comptes de démo

Mot de passe commun : `Demo-Vitrine-2026`. Les secrets 2FA sont dans [`backend/README.md`](backend/README.md#comptes-de-démo).

| E-mail | Rôle | Pour voir |
|---|---|---|
| `adjoua@akwaba.test` | Propriétaire de Maison Adjoua (plan Pro) | Tout l'espace marchand, dont Paramètres |
| `fatou@akwaba.test` | Gérante | Les ventes et l'équipe, sans les paramètres |
| `koffi@akwaba.test` | Vendeur | Les commandes, sans le chiffre d'affaires |
| `ibrahim@akwaba.test` | Propriétaire de Comptoir Fofana, **2FA active** | La connexion en deux étapes, et l'isolation entre boutiques |
| `admin@akwaba.test` | Exploitant de la plateforme, **2FA active** | Le journal d'audit dans l'admin Django (`/admin/`) |

Les comptes de démo ont un mot de passe public : ils ne peuvent ni changer de mot de passe, ni toucher à la 2FA, ni créer de clé API (`403 demo_restricted`). Pour tester ces actions, créez votre propre boutique sur `/inscription` ; une nouvelle boutique démarre au plan Gratuit, et le plan se change dans Paramètres > Plan (paiement simulé).

## Parcours d'évaluation conseillé

| Ce que vous essayez | Où | Ce qui doit se passer |
|---|---|---|
| Créer une boutique | `/inscription` | Un mot de passe faible (`abidjan2026`) est refusé sans vider le formulaire ; une adresse déjà prise est signalée ; sinon, la boutique est créée et vous êtes connecté |
| Un mauvais mot de passe, puis un e-mail qui n'existe pas | `/connexion` | Le même message, le même statut : impossible de savoir si le compte existe. Au 5e échec, le compte est verrouillé et un lien de déblocage part par e-mail |
| La 2FA | `/connexion` avec `ibrahim@akwaba.test` | Un code est demandé après le mot de passe ; le même code ne passe pas deux fois |
| Un vendeur qui cherche le chiffre d'affaires | `koffi@akwaba.test`, puis `/app/maison-adjoua` | Django refuse (403) : la page explique que le chiffre d'affaires est réservé, et le menu ne la propose pas |
| Une boutique qui n'est pas la vôtre | `ibrahim@akwaba.test`, puis `/app/maison-adjoua` | 404 : on n'apprend même pas qu'elle existe |
| Ajouter une personne à l'équipe | Paramètres > Équipe | Confirmation du mot de passe (ou du code 2FA), puis un mot de passe provisoire montré une seule fois, valable 72 h |
| Se connecter avec ce mot de passe provisoire | `/connexion` | Seule la page « choisir son mot de passe » est accessible tant qu'il n'est pas remplacé |
| Une clé API (avec votre propre compte) | Paramètres > Clés API | La clé complète n'apparaît qu'une fois ; une fois révoquée, `/api/public/v1/products` répond 401 |
| Exporter les ventes | Commandes > Exporter | Confirmation renforcée ; l'export est noté dans le journal |
| Commander deux fois en coupant le réseau | `/boutique/maison-adjoua` | Une seule commande : la même `Idempotency-Key` renvoie la commande déjà créée. Le prix envoyé par le navigateur est ignoré |
| Suivre sa commande | Lien « Suivre ma commande » après l'achat | Référence + 4 derniers chiffres du téléphone ; la page n'affiche ni adresse ni numéro, et 5 essais par heure et par référence au plus |
| Mettre la boutique en congé | Paramètres > Boutique | La vitrine affiche le message du marchand et Django refuse les commandes (`409 shop_on_vacation`) |
| Fermer une session à distance | Sécurité > Appareils connectés | L'appareil est coupé tout de suite, sans attendre l'expiration du token |
| La sécurité de la boutique | Vue d'ensemble (et Paramètres > Journal) avec `adjoua@akwaba.test` | Une carte dit ce qui est en ordre et ce qui ne l'est pas : 2FA de chacun, clés API endormies, essais refusés sur les comptes de l'équipe, dernier export |
| Qui a fait quoi | Exportez les ventes avec `fatou@akwaba.test`, puis Paramètres > Journal avec `adjoua@akwaba.test` | « Fatou Diabaté a exporté 121 commandes… », avec l'appareil et l'heure. Le journal ne se modifie pas, et ne montre jamais l'IP d'un client |
| Une commande pendant qu'on regarde | Espace marchand ouvert, et une commande passée en vitrine depuis un autre navigateur | Un bandeau apparaît en moins de 30 s, avec « (1) » dans le titre de l'onglet ; le son est facultatif |
| Le journal d'audit | `http://127.0.0.1:8000/admin/` avec `admin@akwaba.test` et un code 2FA | Lecture seule, même pour un superutilisateur ; « Vérifier l'intégrité » détecte une ligne retouchée dans la base |

## Comment c'est protégé

```
Navigateur ──cookies HttpOnly──▶ Next.js (BFF) ──secret partagé + jeton──▶ Django (API)
           ◀──── HTML ─────────                ◀──────── JSON ───────────
```

Le navigateur ne parle jamais à Django. Les jetons vivent dans des cookies `HttpOnly` que le JavaScript ne peut pas lire ; Next les présente à Django de serveur à serveur, avec un secret qui prouve que l'appel vient bien de lui (`/api/v1/` sans ce secret répond 403). Django revérifie tout à chaque requête : la session, le rôle, la boutique.

| Menace | Parade |
|---|---|
| Mot de passe deviné, credential stuffing | Argon2id, verrou par e-mail, limite par IP réelle, liste noire locale (`abidjan2026`, `akwaba123`…) |
| Énumération des comptes | À la connexion et pour le mot de passe oublié : réponses et temps identiques, que le compte existe ou non. L'inscription en une étape, elle, le dit : voir les limites connues |
| Vol de jeton | Cookies `HttpOnly`, refresh qui tourne à chaque usage, réutilisation détectée et session coupée |
| Session impossible à couper (défaut classique du JWT) | Session serveur vérifiée à chaque requête : révocation immédiate |
| Session volée utilisée pour une action grave | Confirmation renforcée de 10 min : équipe, plan, clés API, export, 2FA |
| Employé trop curieux, autre boutique (IDOR) | Rôles par boutique et requêtes toujours filtrées par boutique |
| Traces effacées après une intrusion | Journal d'audit en ajout seul (ORM et triggers SQL) et chaîné par HMAC |
| Prix modifié, double commande, robots | Total recalculé par le serveur, `Idempotency-Key`, limite par IP et champ piège |
| Secrets en base | Mots de passe hachés, secrets 2FA chiffrés, clés API et mots de passe provisoires gardés en empreinte seulement |
| CSV piégé | Formules neutralisées à l'export, import tout ou rien et limité |

La liste complète, avec le test qui prouve chaque point : [`docs/contrat-api.md`](docs/contrat-api.md), §2 et §5.

## Vérifier

```bash
cd backend && .venv/Scripts/python manage.py test     # 173 tests
cd frontend && npm run lint && npm run build          # le build vérifie aussi les types
```

## Limites connues

- **Inscription sans e-mail de confirmation.** Sans nom de domaine, Akwaba ne peut pas encore envoyer d'e-mails qui arrivent vraiment. L'inscription se fait donc en une étape : elle révèle qu'une adresse a déjà un compte (freiné à 5 essais par heure et par IP), et personne ne prouve qu'il contrôle la boîte mail. Le mode en deux temps, avec lien de confirmation, est écrit et testé : il revient avec `SIGNUP_EMAIL_VERIFICATION=1` dès qu'un serveur d'e-mails est branché (contrat §2.5).
- **Paiement simulé.** Les plans et les moyens de paiement Mobile Money sont affichés et leurs limites appliquées, mais aucun paiement n'est encaissé.
- **CSP.** Les en-têtes interdisent l'affichage dans un cadre, les `<base>` et les `<object>` étrangers, mais il n'y a pas encore de `script-src` avec nonce : c'est la prochaine protection à ajouter côté Next.
- **Dernier article.** Deux commandes simultanées sur le dernier article sont départagées par une mise à jour conditionnelle du stock en base (`stock >= quantité`), mais aucun test ne simule encore la concurrence.
- **Base SQLite.** Suffisante pour l'évaluation ; en production, PostgreSQL et un cache partagé pour les compteurs de limitation.
