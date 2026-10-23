# P01 · Photos dès la création d'un produit · terminé le 23/10/2026

Tenu par Marc (frontend). Branche `claude/a2-photos-creation`, partie de `main` (461d6fa). Prompt : `akwaba-2.0/prompts/P01-photos-creation-produit.md` (hors dépôt). Rien n'est fusionné : il reste la relecture d'Alice et de Kavin.

## Ce qui change

| Fichier | Ce qui change |
|---|---|
| `frontend/src/features/products/photo-files.ts` (nouveau) | Module partagé : `ACCEPTED`, `MAX_PHOTOS`, `TARGET_BYTES`, `STEPS`, `shrink`, `photoProblem(file)` (les contrôles de `choose`), `UNREADABLE`, `PHOTO_PROBLEMS` (messages de refus de Django, sortis de `photo-actions.ts`) |
| `frontend/src/features/products/photos.tsx` | `ProductPhotos` utilise le module partagé. Le comportement ne change pas |
| `frontend/src/features/products/photo-actions.ts` | Importe `PHOTO_PROBLEMS`. `uploadPhoto` ne change pas |
| `frontend/src/features/products/photo-drafts.tsx` (nouveau) | `usePhotoDrafts()` : choix, contrôle, réduction, adresses `blob:` libérées au retrait et au démontage, « Mettre en premier », « Retirer ». `sendDrafts()` : envoi un par un, dans l'ordre, avec `uploadPhoto`. `DraftPhotos` : même dessin et mêmes textes que `ProductPhotos` |
| `frontend/src/features/products/actions.ts` | À la création, `saveProduct` renvoie `{ created: { id } }` au lieu de rediriger |
| `frontend/src/features/products/product-form.tsx` | En création : zone Photos en tête de la section « Fiche », avant le nom. L'adresse en ligne passe dans « Options avancées » (fermé, ouvert s'il porte une erreur). L'enregistrement crée le produit, puis envoie les photos (« Envoi des photos : 2 sur 3 ») ; le bouton reste désactivé jusqu'à l'ouverture de la fiche, puis `router.push` vers `/app/{shop}/produits/{id}?ok=ajoute[&photos=n-m][&raison=code]`. En modification, rien ne change |
| `frontend/src/app/app/[shop]/produits/[id]/page.tsx` | Avec `ok=ajoute`, affiche « Produit ajouté. », suivi de `voice().productOnline` si le produit est en vente. Avec `photos=n-m` (validé `^[0-2]-[1-3]$`, n < m), affiche une note ocre « 1 photo n'a pas pu être envoyée. Ajoutez-la ci-dessous. » (accordée au pluriel), plus le message de `raison` s'il fait partie de `PHOTO_PROBLEMS` |
| `frontend/src/lib/voice.ts` | `productOnline` : « Il est en ligne sur votre vitrine. » pour le propriétaire, « Il est en ligne sur la vitrine de {boutique}. » pour un gérant |

Règles d'envoi : une photo refusée pour elle-même (`unsupported_file`, `file_too_large`) n'arrête pas les suivantes. Un réseau coupé, un 429 ou `photo_limit` arrêtent l'envoi. Le produit existe dans tous les cas, et la fiche s'ouvre.

Sécurité : aucune nouvelle route Django, et `uploadPhoto` valide toujours le slug et l'UUID par zod. Les photos pas encore envoyées n'existent qu'en `blob:` local. `raison` n'est affichée que si elle fait partie de la liste fermée.

## Vérifications

- `npm run lint` : 0 erreur. `npm run build` : OK.
- Tests backend : 291 OK (le backend n'a pas changé).
- Essai dans Edge (Playwright), front de la branche relié à un backend isolé (copie de la base de démo, `seed_demo`) : 21 contrôles sur 21 :
  - 375 px, propriétaire, 3 photos dont la 3ᵉ mise en premier : la progression s'affiche, on arrive sur la fiche, 3 photos dans l'ordre choisi (dimensions servies vérifiées), « Produit ajouté. Il est en ligne sur votre vitrine. » ;
  - la vitrine montre la photo principale envoyée ;
  - sans photo : on arrive sur la fiche, sans note ;
  - échec de la 2ᵉ photo (requête coupée) : `photos=1-3`, note ocre, 1 photo sur la fiche ;
  - faux PNG : « Cette image ne s'ouvre pas » dès le choix, rien n'est ajouté. Un SVG est refusé ;
  - adresse trafiquée (`photos=9-1&raison=<b>x</b>`) : rien ne s'affiche. Motif connu : le message habituel s'affiche ;
  - fiche existante : l'adresse en ligne reste visible, pas de brouillons ;
  - 414 px, gérant : « Il est en ligne sur la vitrine de Maison Adjoua. »

## Écarts au prompt

- **`&raison=<code>`** dans l'adresse de la fiche, en plus de `photos=n-m`, pour afficher « le message habituel » d'un refus de Django après la redirection. Le code est filtré par une liste fermée.
- **Plusieurs fichiers à la fois** (`multiple`), dans la limite des places libres : sur téléphone, cela évite trois allers-retours dans la galerie.
- **Ordre** : on le change avec « Mettre en premier », comme sur la fiche. Cela suffit pour obtenir n'importe quel ordre de 3 photos.
- La case affiche « Préparation… » pendant la réduction (la photo n'est pas encore envoyée), au lieu de « Envoi… ».
- `FLASH.ajoute` dans `produits/page.tsx` ne sert plus. Il est laissé en place ; on peut le retirer.

## Points ouverts

- Un fichier choisi avant que la page ait fini de se charger (dans la première demi-seconde) est ignoré sans message. L'essai automatique l'a rencontré ; une personne n'a presque pas le temps de le faire. Ce comportement est le même sur le bloc Photos existant.
- `uploadPhoto` appelle `refresh()` après chaque photo. La page « Nouveau produit » se recharge donc pendant l'envoi. L'état du formulaire survit (vérifié), mais cela fait deux appels à l'API de plus par photo.
- Le premier commit est marqué WIP (c704b6a) : il a été poussé à la demande de l'utilisateur avant la fin des essais. Le commit suivant termine le chantier. On peut les fusionner en un seul à l'intégration.
