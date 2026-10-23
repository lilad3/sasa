# P02 · partie B · Le BFF tient les lenteurs · Marc · 23/10/2026

Branche `claude/a2-fondations-front`, partie de `origin/claude/a2-fondations` (8e21f0d, contrat de Koffi). Règles : `docs/chantier-a2-fondations.md` §3 et décision 9, validées par Kavin.

## Fait

`frontend/src/lib/server/api.ts` : `callApi` et `fetchPublicImage` passent par `send()`.

| Appel | Délai par tentative | Relance |
|---|---|---|
| `GET` (pages marchandes, vitrine, `fetchPublicImage`) | 20 s | une seule, après 1 s, sur réseau coupé, délai dépassé ou 502/503/504, **seulement si la 1re tentative a échoué en moins de 5 s** |
| `POST auth/token/refresh` (`proxy.ts`, `session/renouveler`) | 20 s, **3 s pour la relance** | même règle. Au pire, la relance se termine 9 s après le début, avant la fin de la fenêtre de grâce de 10 s (revue d'Alice) |
| export (`GET …/export`, commandes et clients) | 20 s | **jamais** : Django inscrit chaque export au journal (`orders_exported`), et une relance le compterait deux fois (revue d'Alice) |
| toute autre écriture (`POST`, `PUT`, `PATCH`, `DELETE`, commande, multipart) | 20 s (10 s avant) | jamais |

Ce qui ne change pas :
- une réponse 4xx ou 500 n'est jamais relancée ;
- `sessionIsOver` (une panne passagère ne déconnecte pas) ;
- la clé d'idempotence des commandes ;
- l'écran « Akwaba ne répond pas ».

La 2e tentative garde le même `X-Request-ID` (vérifié par un test), ce qui permet de rapprocher les deux lignes dans les journaux de Django.

Pire cas d'une lecture : 5 s + 1 s + 20 s = 26 s.

Limite : abandonner la relance du refresh à 3 s empêche Next d'utiliser une réponse tardive. Mais si la requête est déjà partie, cela n'empêche pas Django de la traiter plus tard. Le risque de fausse alerte de vol baisse, il ne disparaît pas.

## Tests

`frontend/tests/bff.test.mjs`, lancé par `npm test`. Il utilise le lanceur de Node 24, qui lit `api.ts` sans outil ajouté, contre un faux Django local. 11 sur 11 OK, en 25 s environ :
- un GET qui répond en 15 s passe, sans relance ;
- un GET sans réponse abandonne au bout de 20 s (`network_error`), sans relance ;
- un GET en 502 rapide est relancé une fois et réussit ; s'il échoue encore, il n'est pas relancé une 2e fois ;
- un GET qui échoue après plus de 5 s n'est pas relancé ;
- les deux tentatives portent le même `X-Request-ID` ;
- un export (`GET …/export`) n'est jamais relancé ;
- une commande (`POST`) n'est jamais envoyée deux fois ;
- le refresh n'est pas relancé après un échec de plus de 5 s. Après un échec rapide, il est relancé une fois et réussit. Si cette relance traîne, elle est abandonnée au bout de 3 s.

Essai manuel : `next start` de la branche, relié à Django par un relais qui le ralentit ou le coupe, sur `/boutique/maison-adjoua` :

| Django | Résultat |
|---|---|
| normal | 200 en 0,4 s |
| 15 s par lecture | 200 en 15,2 s : la vitrine s'affiche (avant : écran de panne à 10 s) |
| 502 une seule fois | relance 1 s plus tard, 200 en 1,1 s |
| connexion coupée | une relance par appel, puis l'écran « Le serveur ne répond pas » en 1,1 s |

Lint et build OK.

## Vercel : durée maximale d'une fonction

Avec Fluid compute (activé par défaut sur les projets récents), la durée par défaut et maximale est de 300 s sur le plan Hobby ([Vercel, limites des fonctions](https://vercel.com/docs/functions/limitations)). Elle couvre largement les 26 s du pire cas, donc je n'ajoute aucun `maxDuration`.

**À vérifier dans le tableau de bord Vercel** (Settings > Functions) : Fluid compute doit être activé. Sans lui, l'ancienne limite du plan Hobby coupe la fonction avant nos 20 s, et il faudrait activer Fluid compute ou poser `maxDuration`.

## Écarts au contrat

Aucun. Les valeurs « proposées » du §3 sont appliquées telles que Kavin les a validées.

## À faire en production

Rien : pas de migration ni de variable. Seulement la vérification de Fluid compute ci-dessus.
