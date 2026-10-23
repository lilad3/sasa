# P02 · Fondations techniques · état de Koffi (23/10/2026)

À l'attention de la session cloud « Koffi » qui reprend ce chantier depuis `claude/a2-fondations`.

## Où j'en suis

**L'étape 1 (contrat) est finie.** Je suis à l'arrêt prévu par le prompt. Il n'y a aucun code, uniquement de la documentation.

- Contrat : `docs/chantier-a2-fondations.md`. Il couvre le plan des parties A à E, l'inventaire de 15 dépendances à SQLite (§5.2), les variables nouvelles (§7), 10 décisions à valider et 2 questions pour l'utilisateur (§10).
- Branche `claude/a2-fondations`, partie de `main` (`461d6fa`). Elle est poussée sur `origin` à la demande de l'utilisateur, relayée par Kavin, pour la bascule dans le cloud.

## Fait

1. Lecture de `akwaba-2.0/00-index.md`, `01-regles-communes.md` et `prompts/P02-fondations-techniques.md`. Ces fichiers sont **hors du dépôt**, dans le dossier local de l'utilisateur ; demande-les à Kavin si tu en as besoin.
2. Inventaire du backend sur ce qui dépend de SQLite. Les quatre points qui ont le plus de poids :
   - `audit/migrations/0002` est écrite en SQL propre à SQLite : **`migrate` plante sur PostgreSQL** ;
   - `audit/services.record()` : sans le verrou `IMMEDIATE`, la chaîne du journal bifurque ;
   - checkout : l'idempotence répond 500 en cas de course ;
   - changement de statut d'une commande : deux transitions incompatibles peuvent passer toutes les deux.
3. Piège repéré pour la migration des données : `dumpdata` coupe les dates à la milliseconde. Cela casse l'empreinte HMAC du journal, d'où la commande `copy_to_postgres` (§5.6).
4. Piège repéré dans le BFF : relancer `auth/token/refresh` après un échec long dépasse la fenêtre de grâce de 10 s, et Django y verrait un vol de session. D'où la règle « relance seulement si le premier échec a pris moins de 5 s » (§3).

## Reste à faire

1. **Attendre** :
   - la revue sécurité d'Alice, qui ajoute la §11 du contrat ;
   - les décisions de l'utilisateur, présentées par Kavin, sur les décisions 1 à 10 et les questions Q1 (taille de la base et quota disque) et Q2 (Sentry sur la liste blanche de PythonAnywhere).
2. Marc complète la partie B (BFF) et la partie C côté Next du contrat, sur `claude/a2-fondations-front`.
3. **Étape 2, seulement après le feu vert relayé par Kavin** :
   - sauvegardes : `core/backup.py`, `backup_db`, `restore_db` et leurs tests ;
   - Sentry Django : `core/sentry.py` et son test de filtre ;
   - `DATABASES` via `DATABASE_URL` ;
   - migration `audit 0010`, avec `0002` rendue sans effet hors SQLite ;
   - verrous PostgreSQL (§5.2, lignes 2 à 6) ;
   - `copy_to_postgres` ;
   - `/healthz`, si décidé ;
   - suite complète sur `postgres:17` dans Docker ;
   - `docs/exploitation.md`, avec les prix relevés sur les pages officielles et datés.
4. Rapport à Kavin au format de `01-regles-communes.md` §10.

## Règles à garder

- Tout passe par Kavin. Ne rien pousser d'autre que `claude/a2-fondations`, ne jamais toucher à `main`, ne pas ouvrir de PR et ne rien fusionner.
- Commits en français : `Contrat A2 fondations : …`, puis `API A2 fondations : …`, terminés par la ligne d'attribution.
