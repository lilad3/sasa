"""
« Générer » le thème d'une boutique à partir de ses réponses d'inscription (décision du 24/11/2026).

Ce n'est pas une IA : un tableau de règles, fiable et gratuit à chaque inscription.
Réponses : secteur (« Que vendez-vous ? »), focus (« Surtout quoi ? », plusieurs cases), public (« Pour qui ? »).
"""

from .packs import PACKS

SECTORS = ("restaurant", "mode", "telephones", "beaute", "epicerie", "maison", "artisanat", "autre")
AUDIENCES = ("femme", "homme", "tous")

# Les cases « Surtout quoi ? » permises par secteur, avec leur libellé de catégorie.
FOCUS_BY_SECTOR = {
    "mode": {"vetements": "Vêtements", "chaussures": "Chaussures", "sacs": "Sacs", "bijoux": "Bijoux"},
    "beaute": {"parfums": "Parfums", "soins": "Soins"},
    "telephones": {"telephones": "Téléphones", "ordinateurs": "Ordinateurs"},
}

# Une seule case cochée qui a son propre pack : boutique spécialisée.
SPECIALIZED = {"chaussures": "chaussures", "sacs": "sacs", "bijoux": "bijoux-montres", "parfums": "parfums-beaute", "soins": "parfums-beaute"}

SECTOR_PACK = {"restaurant": "plats", "telephones": "tech", "beaute": "parfums-beaute"}


def generate(sector, focus, audience):
    """Renvoie {"style", "pack", "categories"}. Une case hors du secteur est ignorée."""
    if sector not in SECTORS:
        raise ValueError(f"Secteur inconnu : {sector}")
    if audience not in AUDIENCES:
        raise ValueError(f"Public inconnu : {audience}")
    allowed = FOCUS_BY_SECTOR.get(sector, {})
    chosen = list(dict.fromkeys(f for f in focus if f in allowed))

    if len(chosen) == 1 and chosen[0] in SPECIALIZED:
        pack = PACKS[SPECIALIZED[chosen[0]]]
    elif sector == "mode":
        pack = PACKS["mode-homme" if audience == "homme" else "mode-femme"]
    else:
        pack = PACKS[SECTOR_PACK.get(sector, "general")]

    # Pack à deux styles (chaussures, sacs, bijoux) : Tailor pour les hommes, Wardrobe sinon.
    if {"tailor", "wardrobe"} <= set(pack.styles):
        style = "tailor" if audience == "homme" else "wardrobe"
    else:
        style = pack.default_style

    categories = [allowed[f] for f in chosen] if sector == "mode" and len(chosen) > 1 else list(pack.categories)
    return {"style": style, "pack": pack.id, "categories": categories}
