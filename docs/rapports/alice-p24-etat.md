# P24 · État du chantier d'Alice (sécurité) · 23/10/2026, 15 h 30 UTC

Branche `claude/a2-securite`, partie de `main` @ 461d6fa. Travail **inachevé** : ce fichier dit où reprendre.

## Fait
- Lu : `akwaba-2.0/00-index.md`, `01-regles-communes.md`, `prompts/P24-dette-securite.md`, `docs/contrat-api.md`, `README.md`.
- **Volet A (brouillon)** : `docs/securite/modele-menaces.md`
  - maquette des zones de confiance (navigateur → Next/BFF → Django → base) et des 14 points de contrôle ;
  - menaces classées par bien (comptes, sessions, argent, données clients, secrets, journal) ;
  - défense minimale attendue des chantiers P02, P05, P10, P11, P13, P14, P15, P23.
- **Volet B (en partie)**, audit en lecture :
  - secrets : aucun `.env`, `.env.local`, `db.sqlite3` ni clé dans **tout** l'historique git (toutes branches) ; dépôt `lilad3/sasa` non visible sans connexion (404) le 23/10 ;
  - `uvx pip-audit -r backend/requirements.txt` : aucune vulnérabilité connue ;
  - relu : réglages Django, middleware BFF, authentification, sessions, verrou, 2FA, admin, permissions et isolation des boutiques (`ShopScopedView`, `for_shop`), vitrine et checkout, réductions, équipe et mot du patron, clés API et API publique, commandes et export, images, cookies et proxy Next, route `/session/fin`.

## Écarts trouvés
Le détail (fichier, scénario, correction) **n'est pas dans le dépôt** : il est dans le rapport privé d'Alice (`akwaba-2.0/rapports-prives/alice-p24-audit-prive.md`, hors dépôt, sur le poste de l'utilisateur).

| Id | Gravité | Détail |
|---|---|---|
| A2-F1 | **élevée** | voir rapport privé |
| A2-F2 | moyenne | voir rapport privé |
| A2-F3 | moyenne | voir rapport privé |
| A2-F4 | moyenne | voir rapport privé |
| A2-F5 | moyenne | réglages de production à vérifier par l'utilisateur, voir rapport privé |
| A2-F6 | moyenne | voir rapport privé |
| A2-F7 à F10 | faible | voir rapport privé |
| A2-F11 | faible | la dette déjà publique du README (`/session/fin` en GET, pas de CSP à nonce, pas de test de concurrence) : c'est l'objet de P24 §1 à §3 |
| A2-F12, F13 | faible / info | voir rapport privé |

Aucune faille n'a été corrigée ni jouée : tout ceci vient de la lecture du code.

## Reste à faire (volet B)
- Relire : `shops/customers.py`, `shops/design.py`, `shops/shop_settings.py` (changement de plan), `shops/activity.py` (liste blanche), `audit/` (triggers, admin, chaîne HMAC), garde de `seed_demo`, fin de `shops/csv_import.py`, Server Actions du front (`frontend/src/features/*/actions.ts`).
- `npm audit --omit=dev` (pas de `node_modules` dans le worktree : `npm ci` d'abord).
- Compléter le modèle de menaces avec ce qui sortira de ces lectures, puis le rapport final à Kavin (format de `01-regles-communes.md` §10).

## Ensuite (pas commencé, attend un oui de l'utilisateur dans la session d'Alice)
- **Volet C** : tests d'abus en local, sur la base de démo. Les premiers à écrire prouveront A2-F1 à A2-F3 et l'isolation entre boutiques pour les trois rôles.
- **Volet D** : correctifs P24 §1 à §3, puis section « Sécurité en production » de `docs/exploitation.md`.

## Pour la session qui reprend
- Travailler dans un worktree sur `claude/a2-securite` ; ne rien pousser sur `main`, pas de PR.
- Le rapport privé n'est pas sur GitHub. Si la session cloud n'y a pas accès, Kavin peut lui transmettre le détail par message ; **ne jamais** le recopier dans un fichier du dépôt avant la correction.
