# Thèmes Akwaba — étape 3 : l'univers de chaque catégorie (front)

**Goal:** dans les 5 styles, toucher une catégorie fait entrer dans son univers : décor plein écran à la couleur des photos, l'article au centre qui tourne, défilement de tous les articles de la catégorie, et à l'arrêt sur un article son nom et son prix apparaissent avec « Ajouter ».

**Architecture:** un composant commun `themes/universe.tsx` (+ `universe.css`) rendu dans le style (il hérite de ses polices) ; chaque style lui passe ses couleurs (variables `--uv-*`) et l'ouvre depuis ses catégories (panneaux Market, rubriques Kitchen, filtres Wardrobe, étiquettes Tailor, onglets Tech). Automatique par défaut : couleur tirée de la photo (canvas, repli sur la couleur du style), article de départ = le plus demandé de la catégorie sinon le premier. La rotation à 360° viendra des vidéos (étape 4) : ici la photo tourne sur un plateau et alterne avec les autres photos de l'article.

**Contraintes:** téléphone d'abord, Échap et bouton retour ferment, focus rendu, `data-motion` et reduced-motion respectés, aucune donnée serveur nouvelle.

### Task 1: composant Univers + branchement dans les 5 styles
- Vérif : tsc, lint, build, navigateur 390 px dans 2 styles au moins (ouvrir, faire défiler, s'arrêter → prix, ajouter → panier).
