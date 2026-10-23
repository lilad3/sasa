# P01 · Photos dès la création d'un produit · état au 23/10/2026, 15 h 15 UTC

Tenu par Marc (frontend). Branche `claude/a2-photos-creation`, partie de `main` (461d6fa). Prompt : `akwaba-2.0/prompts/P01-photos-creation-produit.md` (hors dépôt).

Le travail a été arrêté sur ordre de l'utilisateur, relayé par Kavin, pour passer dans le cloud. Le commit est marqué WIP : **le code est écrit en entier, mais il n'a pas été essayé dans un navigateur et le build n'a pas tourné.**

## Fait

Le code est écrit. Le lint passe (`npm run lint` : 0 erreur). `tsc --noEmit` ne signale que des `PageProps` introuvables, sur toutes les pages : ces types sont générés par `next build` ou `next dev`, ce n'est pas une erreur du chantier.

| Fichier | Ce qui change |
|---|---|
| `frontend/src/features/products/photo-files.ts` (nouveau) | Module partagé : `ACCEPTED`, `MAX_PHOTOS`, `TARGET_BYTES`, `STEPS`, `shrink`, `photoProblem(file)` (les contrôles de `choose`), `UNREADABLE`, `PHOTO_PROBLEMS` (les messages de refus de Django, sortis de `photo-actions.ts`) |
| `frontend/src/features/products/photos.tsx` | `ProductPhotos` utilise le module partagé. Le comportement ne change pas |
| `frontend/src/features/products/photo-actions.ts` | Importe `PHOTO_PROBLEMS` au lieu de sa copie locale. `uploadPhoto` ne change pas |
| `frontend/src/features/products/photo-drafts.tsx` (nouveau) | `usePhotoDrafts()` : choix, contrôle, réduction, adresse `blob:` libérée au retrait et au démontage, « Mettre en premier », « Retirer ». `sendDrafts()` : envoi un par un, dans l'ordre, avec `uploadPhoto`. `DraftPhotos` : même dessin et mêmes textes que `ProductPhotos` |
| `frontend/src/features/products/actions.ts` | `saveProduct` renvoie `{ created: { id } }` à la création au lieu de rediriger. Nouveau champ `created` dans `ProductFormState` |
| `frontend/src/features/products/product-form.tsx` | En création : zone Photos en tête de la section « Fiche », avant le nom. Le champ « Ou l'adresse d'une photo en ligne » passe dans `<details>` « Options avancées » (fermé, ouvert s'il porte une erreur). L'enregistrement crée le produit, puis envoie les photos : le bouton affiche « Envoi des photos : 2 sur 3 » et reste désactivé jusqu'à l'ouverture de la fiche. Ensuite, `router.push` vers `/app/{shop}/produits/{id}?ok=ajoute[&photos=n-m][&raison=code]`. L'aperçu « Dans la vitrine » montre la première photo choisie. En modification, rien ne change |
| `frontend/src/app/app/[shop]/produits/[id]/page.tsx` | Lit `searchParams`. Avec `ok=ajoute`, affiche « Produit ajouté. » suivi de `voice().productOnline` si le produit est en vente. Avec `photos=n-m` (validé `^[0-2]-[1-3]$`, n < m), affiche une note ocre « 1 photo n'a pas pu être envoyée. Ajoutez-la ci-dessous. » (au pluriel si besoin), plus le message de `raison` s'il est dans `PHOTO_PROBLEMS` |
| `frontend/src/lib/voice.ts` | `productOnline` : « Il est en ligne sur votre vitrine. » pour le propriétaire, « Il est en ligne sur la vitrine de {boutique}. » pour un gérant |

Règles d'envoi (`sendDrafts`) :
- une photo refusée pour elle-même (`unsupported_file`, `file_too_large`) n'arrête pas les suivantes ;
- un réseau coupé (exception), une limite de débit (429) ou `photo_limit` arrêtent l'envoi ;
- le produit existe déjà dans tous les cas, et la fiche s'ouvre toujours.

Sécurité : aucune nouvelle route Django. `uploadPhoto` valide toujours slug et UUID par zod (`Target`). Les photos pas encore envoyées n'existent qu'en `blob:` local. `raison` n'est affichée que si elle fait partie de la liste fermée `PHOTO_PROBLEMS`.

## Reste à faire

1. **`npm run build`** dans `frontend/`. Il génère `PageProps` et vérifie les types.
2. **Essai dans un navigateur**, backend lancé avec un compte de démo propriétaire (voir `backend/README.md`), en vérifiant les critères d'acceptation du prompt :
   - créer un produit avec 3 photos à 375 px : les 3 photos sont là, dans l'ordre, et la fiche s'ouvre ;
   - créer un produit sans photo : on arrive sur la fiche ;
   - couper le réseau pendant la 2ᵉ photo (DevTools > Offline) : le produit existe avec 1 photo et la note ocre s'affiche ;
   - un faux PNG : il est refusé dès le choix (« Cette image ne s'ouvre pas »), parce que `createImageBitmap` échoue avant tout envoi ;
   - la vitrine montre la photo principale ;
   - un gérant lit « la vitrine de Maison Adjoua ».
3. **Captures** à 375 px et sur ordinateur du formulaire (vide, avec 3 photos, pendant l'envoi) et de la fiche avec la note ocre.
4. Vérifier que l'appel direct des Server Actions (`saveProduct`, puis `uploadPhoto` hors `useActionState`) se comporte bien avec ce Next 16. `uploadPhoto` appelle `refresh()` après chaque photo, ce qui recharge la page « nouveau » pendant l'envoi : l'état du formulaire doit survivre, et c'est à confirmer.
5. Tests backend : rien n'a changé côté Django. Lancer `.venv/Scripts/python manage.py test` pour le rapport.
6. Remplacer le commit WIP par un commit propre (`Front A2 photos : …`), puis faire le rapport à Kavin (format de `01-regles-communes.md` §10).

## Écarts au prompt, à signaler dans le rapport

- **`&raison=<code>` dans l'adresse de la fiche**, en plus de `photos=n-m`. Sans lui, on ne peut pas afficher « le message habituel » d'un refus de Django après la redirection. Le code est filtré par la liste fermée `PHOTO_PROBLEMS`.
- **Choix de plusieurs fichiers à la fois** (`multiple`), dans la limite des places libres. Sur téléphone, cela évite trois allers-retours dans la galerie. Si on choisit plus de 3 photos, les premières sont gardées, avec un message.
- **Ordre** : on change l'ordre avec « Mettre en premier », comme sur la fiche. Cela suffit pour obtenir n'importe quel ordre de 3 photos. Il n'y a pas de glisser-déposer.
- La case affiche « Préparation… » pendant la réduction (la photo n'est pas encore envoyée), au lieu du « Envoi… » de la fiche.
- `FLASH.ajoute` de la liste des produits (`produits/page.tsx`) n'est plus utilisé. Il est laissé en place, au cas où ; on peut le retirer.
