# Modèle de menaces et maquette de sécurité d'Akwaba

Tenu par **Alice** (sécurité). Version 0.1 · 23/10/2026 · **brouillon** (volet A de P24, à compléter).

Ce document est la référence de l'équipe : où vit chaque donnée, où chaque contrôle a lieu, et qui pourrait attaquer quoi. Il complète la carte des menaces du contrat (`docs/contrat-api.md` §2.1), qui est classée par parade ; ici, on classe **par bien à protéger**.

Les écarts trouvés à l'audit sont notés `A2-Fn`. Leur détail n'est **pas** dans le dépôt tant qu'ils ne sont pas corrigés : il est dans le rapport privé d'Alice, transmis à Kavin.

---

## 1. Maquette de sécurité : zones de confiance et points de contrôle

```
 ZONE 0 · Internet (aucune confiance)
 ┌──────────────────────────────┐   ┌──────────────────────┐   ┌───────────────────────┐
 │ Navigateur marchand / client │   │ Robots, attaquants   │   │ Logiciel tiers (clé)  │
 │ cookies HttpOnly, pas de jeton│  │                      │   │ Bearer akw_live_…     │
 └──────────────┬───────────────┘   └──────────┬───────────┘   └───────────┬───────────┘
                │ HTTPS                         │                           │ HTTPS
   ╔════════════▼═══════════════════════════════▼═══════╗                   │
   ║ ZONE 1 · Next.js sur Vercel (BFF)                  ║                   │
   ║ C1 proxy.ts : session présente ? renouvelle l'accès ║                   │
   ║ C2 Server Actions : vérif. d'origine (Next), zod   ║                   │
   ║ C3 en-têtes : cadre interdit, CSP (script-src : A2-F11)                 │
   ║ C4 IP du visiteur lue ici                         ║                   │
   ║ Secrets : BFF_SHARED_SECRET, API_URL               ║                   │
   ╚════════════╤═══════════════════════════════════════╝                   │
                │ HTTPS · Bearer JWT + X-Akwaba-Bff + X-Client-IP/UA/Device  │
   ╔════════════▼═══════════════════════════════════════════════════════════▼═══╗
   ║ ZONE 2 · Django sur PythonAnywhere                                         ║
   ║ C5 BffMiddleware : secret BFF (temps constant) sinon 403 ; fait confiance   ║
   ║    à X-Client-IP seulement après ce contrôle                               ║
   ║ C6 SessionJWTAuthentication : signature, aud/iss, session active (révocation║
   ║    immédiate), PasswordChosen                                              ║
   ║ C7 ShopScopedView : appartenance (404), droit par méthode (403), refus par ║
   ║    défaut ; données filtrées par for_shop()                                ║
   ║ C8 Sérialiseurs : plain_text, longueurs, listes fermées                    ║
   ║ C9 Règles métier : prix/stock/remises recalculés, mises à jour conditionnelles║
   ║ C10 Limites de débit (core/ratelimit, compteurs en base)                   ║
   ║ C11 Confirmation renforcée (reauth 10 min) avant les actions graves        ║
   ║ C12 Journal d'audit : record(), ajout seul, chaîne HMAC                    ║
   ║ C13 ApiKeyAuthentication + HasScope pour /api/public/v1/                   ║
   ║ C14 Admin : mot de passe + 2FA + verrou                                    ║
   ║ Secrets : DJANGO_SECRET_KEY, JWT_SIGNING_KEY, BFF_SHARED_SECRET,           ║
   ║           TOTP_ENCRYPTION_KEY, AUDIT_HMAC_KEY (fichier .env, hors dépôt)   ║
   ╚════════════╤═══════════════════════════════════════════╤═══════════════════╝
                │                                           │ SMTP
   ╔════════════▼══════════════════════╗        ┌───────────▼──────────┐
   ║ ZONE 3 · Base (SQLite → PostgreSQL)║        │ Boîte mail du marchand│
   ║ mots de passe Argon2id ; TOTP chiffré         │ liens signés à durée  │
   ║ (Fernet) ; clés API et codes de    ║        │ courte                │
   ║ secours en empreinte ; journal en  ║        └──────────────────────┘
   ║ ajout seul (triggers)              ║
   ║ Sauvegardes : chiffrées (P02)      ║
   ╚════════════════════════════════════╝
```

**Règle d'or** : la zone 1 filtre pour le confort, la zone 2 décide. Toute règle de sécurité qui n'existe qu'en zone 1 est un défaut.

### Où chaque chose est contrôlée

| Quoi | Zone 1 (Next) | Zone 2 (Django) |
|---|---|---|
| Identité | cookie présent (C1) | jeton signé + session active (C6) |
| Droits | menu masqué | appartenance + droit (C7) |
| Données saisies | zod (confort) | sérialiseurs, `plain_text` (C8) |
| Prix, stock, remises | affichage | recalcul + mise à jour conditionnelle (C9) |
| Limites de débit | — | C10, par IP réelle transmise par C4 |
| Actions graves | fenêtre de confirmation | `require_reauth` (C11) |
| Traces | — | `record()` (C12) |

---

## 2. Menaces par bien à protéger

Légende des attaquants : **E** extérieur anonyme · **C** client de la vitrine · **M** membre d'une autre boutique · **S** employé (vendeur, gérant) qui dépasse son rôle · **V** voleur de session (cookie, appareil prêté) · **I** quelqu'un qui a lu la base ou les logs.

La colonne « Écart » ne cite que la dette déjà publique (README, « Limites connues »). Un « — » ne veut pas dire « aucun écart » : les écarts ouverts sont listés au §4, avec leur détail dans le rapport privé.

### 2.1 Comptes marchands
| Attaquant · par où | Défense en place | Écart |
|---|---|---|
| E · deviner le mot de passe, listes d'identifiants | Argon2id, verrou par e-mail, limite par IP, liste noire locale | — |
| E · savoir qui a un compte | réponses et temps identiques ; inscription en deux temps | — |
| E · bloquer un marchand avec le verrou | e-mail de déblocage | — |
| V · s'installer durablement dans le compte | reauth sur mot de passe, clés, équipe, plan, export | — |
| E · pré-créer le compte d'une victime | inscription en deux temps | — |
| E · admin de la plateforme | 2FA obligatoire, verrou, URL cachée | — |

### 2.2 Sessions
| Attaquant · par où | Défense en place | Écart |
|---|---|---|
| E · vol par XSS | cookies HttpOnly, pas de HTML rendu | CSP à nonce : A2-F11 |
| V · refresh copié | rotation + détection de réutilisation + alerte | — |
| V · session oubliée | mode appareil partagé, liste des sessions, révocation immédiate | — |
| E · déconnecter un marchand depuis un autre site | — | A2-F11 (`/session/fin`) |

### 2.3 Argent des commandes et encaissements
| Attaquant · par où | Défense en place | Écart |
|---|---|---|
| C · changer prix, frais, remise | tout recalculé, `409 price_changed` | — |
| C · user deux fois un code unique | mise à jour conditionnelle dans la transaction | test de concurrence : A2-F11 |
| C/E · fausses commandes, stock vidé | 10/h par IP, champ piège, idempotence | — |
| S · remise au-delà de son plafond | plafond serveur + reauth + journal | — |
| Chantiers à venir (P05, P10, P11) | **défense à concevoir avant le code** : voir §3 | — |

### 2.4 Données personnelles des clients (nom, téléphone, adresse)
| Attaquant · par où | Défense en place | Écart |
|---|---|---|
| M · lire les clients d'une autre boutique | `for_shop()`, 404 | à prouver (volet C) |
| S · exporter la clientèle | droit `customers.export` / `orders.export` + reauth + journal | — |
| C · suivre la commande d'un autre | référence + 4 chiffres, 5 essais/h/référence, même 404 | — |
| Logiciel tiers | clé à scope `orders:read`, révocable | — |
| I · logs | pas de données client dans les logs | — |

### 2.5 Secrets
| Bien | Où il vit | Défense | Écart |
|---|---|---|---|
| Secrets Django et BFF | `.env` (PythonAnywhere), variables Vercel | jamais dans git (vérifié sur tout l'historique le 23/10) | — |
| Secrets 2FA | base, chiffrés Fernet | clé hors base | — |
| Clés API | base, SHA-256 | affichée une fois | — |
| Liens e-mail | signés, durée courte, usage unique | — | — |

### 2.6 Journal d'audit
| Attaquant · par où | Défense en place | Écart |
|---|---|---|
| I · effacer ses traces | ajout seul (ORM + triggers), chaîne HMAC, vérification | triggers à refaire pour PostgreSQL (P02) |
| Marchand · voir l'IP de ses clients | liste blanche des détails, IP masquée | — |

### 2.7 Exports, imports, éditeur de boutique et journal côté marchand
| Attaquant · par où | Défense en place | Écart |
|---|---|---|
| S · formule piégée dans un export Excel | `csv_safe` neutralise `= + - @` à chaque cellule ; le numéro de téléphone n'est mis en forme que s'il suit `+` et des chiffres seulement | — |
| M · fichier CSV piégé à l'import des produits | 512 Ko et 1 000 lignes au plus, extension `.csv`, octet nul refusé, aucune exécution ; chaque ligne passe par le sérialiseur produit (`plain_text`, plafond du plan) ; tout ou rien | — |
| M · contenu actif dans la vitrine | la configuration de l'éditeur est un JSON fermé : listes de choix, champs inconnus refusés, deux textes seulement et ils passent par `plain_text` ; le plan est revérifié à la publication | — |
| M · saturer l'éditeur | 120 enregistrements par heure et par membre ; un seul brouillon par boutique ; publication atomique | — |
| M · voir plus que sa part du journal | le propriétaire lit son journal par liste blanche de détails, sur 90 jours, jamais l'IP ni l'appareil d'un client | — |
| Quiconque · comptes de démonstration | `seed_demo` refuse de tourner hors mode développement ; un compte `is_demo` ne peut changer ni mot de passe, ni 2FA, ni clé API, et n'a pas de réinitialisation | voir le suivi des comptes de démo (A2-F5) |

### 2.8 Front (Server Actions) et dépendances
| Attaquant · par où | Défense en place | Écart |
|---|---|---|
| M · détourner une Server Action | chaque entrée est validée par zod (slug `^[a-z0-9-]{1,60}$`, identifiants UUID, longueurs) avant d'être placée dans un chemin d'API ; l'autorisation reste décidée par Django | — |
| Quiconque · redirection ouverte après connexion | `safeNext` n'accepte qu'un chemin interne `/app…` (ni `//`, ni `\`, ni `://`) | — |
| Dépendance vulnérable | `pip-audit` sur `requirements.txt` et `npm audit --omit=dev` : aucune vulnérabilité connue au 23/10/2026 | à refaire à chaque ajout de paquet (P02 : `sentry-sdk`, `psycopg`) |

---

## 3. Défense attendue des chantiers Akwaba 2.0 (à reporter dans chaque « Revue sécurité »)

Résumé ; le détail sera écrit dans la section « Revue sécurité » de chaque contrat, avant le code.

| Chantier | Exigences minimales d'Alice |
|---|---|
| P02 Fondations | sauvegardes chiffrées et testées (restauration), avec une clé dédiée rangée hors du serveur et une restauration qui ne rouvre aucun accès fermé depuis la sauvegarde ; Sentry sans données personnelles (`send_default_pii=False`, filtrage des corps, en-têtes, chaînes de requête, textes d'exception) ; triggers d'ajout seul du journal recréés sur PostgreSQL, doublés par des droits de base séparés (rôle de migration, rôle d'exécution) ; chaîne du journal protégée par un verrou sur PostgreSQL ; IP réelle derrière le proxy de l’hébergeur |
| P05 Paiements et livraison | changer un numéro Mobile Money de réception = reauth + alerte e-mail + journal Sécurité + délai avant effet ; numéros jamais dans une URL |
| P10 Encaissements | montants entiers, transitions de statut fermées, mises à jour conditionnelles, stock cohérent après une annulation, journal de chaque encaissement |
| P11 Remboursements et reçus | rembourser = reauth + plafond + journal Sécurité ; jeton de reçu aléatoire, sans donnée devinable, même 404 pour inconnu et expiré |
| P13 Réductions | refus uniformes, compteurs par code, cumul fermé côté serveur |
| P14 Campagnes | consentement vérifié par le serveur, désinscription sans compte, export sous reauth |
| P15 Contenu | aucun HTML : blocs JSON fermés ; avis modérés ; recherche publique limitée |
| P23 Légal | anonymisation qui ne casse pas la chaîne du journal |
| Tous | plain_text et longueurs partout ; nouvelles actions dans `audit/actions.py` ; limites de débit documentées |

---

## 4. Écarts ouverts (au 23/10/2026)

| Id | Gravité | Détail |
|---|---|---|
| A2-F1 | élevée | voir rapport privé |
| A2-F2 | moyenne | voir rapport privé |
| A2-F3 | moyenne | voir rapport privé |
| A2-F4 | moyenne | voir rapport privé |
| A2-F5 | moyenne | voir rapport privé |
| A2-F6 | moyenne | voir rapport privé |
| A2-F7 à F13 | faible ou info | voir rapport privé |

Le détail (fichier, ligne, scénario, correction) est dans le rapport privé d'Alice, hors du dépôt.
