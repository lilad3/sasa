# Akwaba — API (Django + DRF)

L'API qui protège le dashboard de ventes d'Akwaba. Le contrat complet (routes, formats, protections) est dans [`../docs/contrat-api.md`](../docs/contrat-api.md).

## Lancer en local

Prérequis : Python 3.13 et [uv](https://docs.astral.sh/uv/).

```bash
cd backend
uv venv .venv --python 3.13
uv pip install -r requirements.txt   # uv trouve tout seul le .venv du dossier
cp .env.example .env          # puis remplir les secrets (voir les commentaires du fichier)
.venv/Scripts/python manage.py migrate          # macOS/Linux : .venv/bin/python
.venv/Scripts/python manage.py createcachetable # compteurs anti brute-force
.venv/Scripts/python manage.py seed_demo        # boutiques et comptes de démo
.venv/Scripts/python manage.py runserver
```

En développement, les e-mails (lien d'inscription, réinitialisation du mot de passe) s'affichent dans le terminal de `runserver`.

## Comptes de démo

Mot de passe commun : `Demo-Vitrine-2026`

| E-mail | Rôle | Boutique |
|---|---|---|
| `adjoua@akwaba.test` | Propriétaire | Maison Adjoua |
| `fatou@akwaba.test` | Gérante | Maison Adjoua |
| `koffi@akwaba.test` | Vendeur (pas d'accès au CA) | Maison Adjoua |
| `ibrahim@akwaba.test` | Propriétaire, **2FA active** | Comptoir Fofana |
| `admin@akwaba.test` | Administrateur de la plateforme, **2FA active** | Admin Django (`/admin/`) |

Chaque boutique a 12 produits et environ 500 commandes sur 180 jours. `seed_demo` peut être relancé : il remet tout à zéro. Il refuse de tourner si `DJANGO_DEBUG` n'est pas à 1, car ces secrets sont publics.

Secrets TOTP des comptes avec 2FA, à ajouter dans une application d'authentification (Google Authenticator, Aegis…) :

| Compte | Secret |
|---|---|
| `ibrahim@akwaba.test` | `MBNM5GZTHXLVVEGZM4BKEEE4I6OQNQCK` |
| `admin@akwaba.test` | `DQAYDJNECMCHH7BTOVXVR6NVCFAJWDQL` |

Sans téléphone, générez le code du moment :

```bash
.venv/Scripts/python -c "import pyotp; print(pyotp.TOTP('DQAYDJNECMCHH7BTOVXVR6NVCFAJWDQL').now())"
```

Un même code ne sert qu'une fois : pour vous reconnecter tout de suite, attendez le code suivant (30 s).

## Journal d'audit (admin de la plateforme)

Connectez-vous sur `http://127.0.0.1:8000/admin/` avec `admin@akwaba.test`, le mot de passe de démo et un code 2FA, puis ouvrez **Journal d'audit**. Vous y trouverez :
- le bandeau des dernières 24 h ;
- des filtres par gravité, événement, boutique et date ;
- un export CSV ;
- le bouton **Vérifier l'intégrité**, qui recalcule la chaîne HMAC.

Le journal est en lecture seule pour tout le monde. Pour un vrai administrateur :

```bash
.venv/Scripts/python manage.py createsuperuser
.venv/Scripts/python manage.py setup_2fa vous@exemple.ci   # affiche le QR code dans le terminal
```

Sans 2FA, l'admin refuse la connexion.

## Appeler l'API à la main

`/api/v1/` n'accepte que le serveur Next. Pour tester avec curl, envoyez le même secret que lui :

```bash
SECRET=$(grep '^BFF_SHARED_SECRET=' .env | cut -d= -f2-)
curl -X POST http://127.0.0.1:8000/api/v1/auth/login \
  -H "Content-Type: application/json" -H "X-Akwaba-Bff: $SECRET" \
  -d '{"email":"adjoua@akwaba.test","password":"Demo-Vitrine-2026"}'
```

## Tests

```bash
.venv/Scripts/python manage.py test
```

Chaque protection du contrat (§5) a son test :
- connexion : anti-énumération, verrouillage, 2FA (anti-rejeu, codes de secours, verrou commun), confirmation renforcée ;
- sessions : rotation et vol de refresh, révocation immédiate, appareil partagé, gestion des sessions ;
- boutiques : rôles et isolation ;
- journal d'audit : ajout seul et détection d'altération ;
- admin : 2FA obligatoire et lecture seule ;
- divers : alertes e-mail et format des erreurs.

`manage.py flush` échoue volontairement : les triggers du journal refusent tout `DELETE`. Pour repartir de zéro en développement, supprimez `db.sqlite3` puis relancez `migrate`, `createcachetable` et `seed_demo`.

## Où lire quoi

| Fichier | Contenu |
|---|---|
| `accounts/policy.py` | Toute la politique de sécurité : durées, seuils, limites de débit |
| `accounts/sessions.py` | Sessions serveur, rotation du refresh, détection de vol |
| `accounts/authentication.py` | Vérification du JWT **et** de sa session à chaque requête |
| `accounts/lockout.py` | Verrouillage par e-mail, sans révéler les comptes, avec lien de déblocage |
| `accounts/mfa.py` | 2FA TOTP (secret chiffré, anti-rejeu) et codes de secours |
| `accounts/admin_login.py` | Connexion à l'admin : mot de passe + code 2FA |
| `audit/models.py` · `audit/services.py` | Journal d'audit en ajout seul, chaîné par HMAC, et sa vérification |
| `audit/admin.py` | L'interface du journal dans l'admin Django |
| `accounts/validators.py` | Règles de mot de passe, dont la liste noire locale |
| `core/middleware.py` | Secret BFF, IP réelle du visiteur, `request_id` |
| `core/exceptions.py` | Format d'erreur unique |
| `shops/permissions.py` | Rôles et isolation entre boutiques |
| `accounts/permissions.py` | Compte sur mot de passe provisoire : rien d'autre que choisir son mot de passe |
| `shops/team.py` | Équipe (comptes créés par le propriétaire, mot de passe provisoire) et mot du patron |
| `shops/plans.py` | Plans et limites, appliqués par le serveur |
| `shops/api_keys.py` · `shops/public_api.py` | Clés API (empreinte seule, temps constant) et API publique `/api/public/v1/` |
| `shops/catalog.py` · `shops/csv_import.py` | Catalogue, alertes de stock, import CSV tout ou rien |
| `core/spreadsheet.py` | Exports CSV pour Excel, formules neutralisées |
