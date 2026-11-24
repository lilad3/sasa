"""
Les packs : une spécialité par famille d'articles (décision du fondateur, 24/11/2026).

Thème d'une boutique = style (design_catalog.STYLES) × pack. Un pack fixe les sections propres au
métier, les informations produit à demander, et les catégories proposées par défaut. Module feuille :
la génération (generation.py), l'éditeur et la vitrine le lisent.
"""

from dataclasses import dataclass

# Les informations produit qu'un pack peut demander en plus du nom, du prix, du stock et des photos.
PRODUCT_FIELDS = (
    "taille", "pointure", "coloris", "etat", "garantie", "stockage",
    "unite", "prix_gros", "poids", "options_plat", "contenance", "matiere",
)

# Vidéos produit et univers de catégorie : dans tous les packs.
_COMMON = ("video", "univers")


@dataclass(frozen=True)
class Pack:
    id: str
    label: str
    styles: tuple[str, ...]
    default_style: str
    categories: tuple[str, ...]
    fields: tuple[str, ...]
    sections: tuple[str, ...]


def _pack(id, label, styles, categories, fields, sections=()):
    return Pack(id, label, tuple(styles), styles[0], tuple(categories), tuple(fields), (*sections, *_COMMON))


PACKS = {
    p.id: p
    for p in (
        _pack("plats", "Plats", ["kitchen"], ["Plats", "Grillades", "Boissons", "Desserts"], ["options_plat"], ["ecran-cuisine"]),
        _pack("mode-femme", "Mode femme", ["wardrobe"], ["Hauts", "Bas", "Robes", "Chaussures", "Sacs", "Bijoux"], ["taille", "coloris"], ["essayer-le-look"]),
        _pack("mode-homme", "Mode homme", ["tailor"], ["Chemises", "Pantalons", "Costumes", "Pagne", "Chaussures", "Accessoires"], ["taille", "pointure", "coloris"], ["essayer-le-look"]),
        _pack("chaussures", "Chaussures", ["tailor", "wardrobe"], ["Baskets", "Ville", "Sandales", "Nouveautés"], ["pointure", "coloris"], ["sorties"]),
        _pack("sacs", "Sacs", ["wardrobe", "tailor"], ["Sacs à main", "Sacs à dos", "Pochettes", "Valises"], ["coloris", "matiere"]),
        _pack("bijoux-montres", "Bijoux et montres", ["wardrobe", "tailor"], ["Colliers", "Bracelets", "Boucles d'oreilles", "Montres"], ["matiere"]),
        _pack("parfums-beaute", "Parfums et beauté", ["wardrobe"], ["Parfums", "Soins", "Maquillage", "Cheveux"], ["contenance"]),
        _pack("tech", "Téléphones et ordinateurs", ["tech"], ["Téléphones", "Ordinateurs", "Tablettes", "Accessoires"], ["etat", "garantie", "stockage", "coloris"], ["comparateur", "reprise"]),
        _pack("general", "Un peu de tout", ["market"], ["Nouveautés", "Maison", "Divers", "Promotions"], ["unite", "prix_gros", "poids"]),
    )
}
