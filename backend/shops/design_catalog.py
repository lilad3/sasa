"""
Les thèmes de la vitrine et la configuration par défaut (docs/chantier-p5.md §3.1 et §3.2).

Module feuille : la vitrine publique (storefront.py) et l'éditeur (design.py) le lisent tous les deux.
"""

from .models import StorefrontVersion

SECTIONS = ("livraison", "demandes", "collection", "histoire", "suivi")
MOTIONS = ("full", "soft", "none")
COVERS = ("featured", "name")

# Les 5 styles (24/11/2026) : noms anglais validés par le fondateur. Le style généré pour la boutique
# est toujours permis ; passer à un autre style suit la colonne « plan » (choix d'argent du fondateur).
STYLES = ("kitchen", "wardrobe", "tailor", "tech", "market")
STYLE_PLAN = "pro"
_STYLE_SECTIONS = ("collection", "livraison", "suivi")

# Chaque thème : son nom, le plan à partir duquel il est compris, ses sections par défaut
# (celles du plan Gratuit, qui ne peut pas les changer), et « legacy » pour les anciens thèmes :
# toujours valides pour les vitrines déjà publiées, mais plus proposés.
THEMES = {
    **{key: {"label": key.capitalize(), "plan": STYLE_PLAN, "legacy": False, "sections": _STYLE_SECTIONS} for key in STYLES},
    "essentiel": {"label": "Essentiel", "plan": "free", "legacy": True, "sections": ("collection", "livraison", "suivi")},
    "epicerie": {"label": "Épicerie", "plan": "free", "legacy": True, "sections": ("livraison", "demandes", "collection", "suivi")},
    "beaute": {"label": "Beauté", "plan": "pro", "legacy": True, "sections": ("collection", "histoire", "livraison", "suivi")},
    "artisanat": {"label": "Artisanat", "plan": "pro", "legacy": True, "sections": ("histoire", "collection", "livraison", "suivi")},
    "piece-phare": {"label": "Pièce phare", "plan": "pro", "legacy": True, "sections": ("histoire", "collection", "livraison", "suivi")},
}


def selectable_themes():
    """Les styles proposés au marchand, dans l'ordre d'affichage."""
    return [key for key in STYLES if not THEMES[key]["legacy"]]

PLAN_RANK = {"free": 0, "pro": 1, "business": 2}
VERSIONS_KEPT = {"free": 1, "pro": 5, "business": 20}


def default_config(theme="essentiel", pack=""):
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
