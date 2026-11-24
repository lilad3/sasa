"""
Les thèmes de la vitrine et la configuration par défaut (docs/chantier-p5.md §3.1 et §3.2).

Module feuille : la vitrine publique (storefront.py) et l'éditeur (design.py) le lisent tous les deux.
"""

from .models import StorefrontVersion

SECTIONS = ("livraison", "demandes", "collection", "histoire", "suivi")
MOTIONS = ("full", "soft", "none")
COVERS = ("featured", "name")

# Les 5 styles (24/11/2026) : noms anglais validés par le fondateur ; les anciens thèmes sont supprimés
# (migration 0010). Le style généré pour la boutique est toujours permis ; les autres suivent la colonne
# « plan » (choix d'argent du fondateur). Market, héritier d'Essentiel, reste compris en Gratuit.
STYLES = ("kitchen", "wardrobe", "tailor", "tech", "market")

# Chaque style : son nom, le plan à partir duquel il est compris, et ses sections par défaut
# (celles du plan Gratuit, qui ne peut pas les changer).
THEMES = {
    "kitchen": {"label": "Kitchen", "plan": "pro", "sections": ("collection", "livraison", "suivi")},
    "wardrobe": {"label": "Wardrobe", "plan": "pro", "sections": ("collection", "livraison", "suivi")},
    "tailor": {"label": "Tailor", "plan": "pro", "sections": ("collection", "livraison", "suivi")},
    "tech": {"label": "Tech", "plan": "pro", "sections": ("collection", "livraison", "suivi")},
    "market": {"label": "Market", "plan": "free", "sections": ("livraison", "demandes", "collection", "suivi")},
}


def selectable_themes():
    """Les styles proposés au marchand, dans l'ordre d'affichage."""
    return list(STYLES)

PLAN_RANK = {"free": 0, "pro": 1, "business": 2}
VERSIONS_KEPT = {"free": 1, "pro": 5, "business": 20}


def default_config(theme="market", pack="general"):
    """La vitrine d'une boutique qui n'a encore rien publié : la vitrine d'avant l'éditeur."""
    return {
        "version": 1,
        "theme": theme,
        "pack": pack,
        "motion": "full",
        "cover": "featured",
        "sections": list(THEMES[theme]["sections"]),
        "texts": {"tagline": "", "story": ""},
    }


def published_design(shop):
    published = StorefrontVersion.objects.for_shop(shop).filter(status=StorefrontVersion.Status.PUBLISHED).first()
    if not published:
        return default_config()
    return {"pack": "", **published.config}  # les vitrines publiées avant les packs n'ont pas la clé
