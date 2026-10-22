"""
Les thèmes de la vitrine et la configuration par défaut (docs/chantier-p5.md §3.1 et §3.2).

Module feuille : la vitrine publique (storefront.py) et l'éditeur (design.py) le lisent tous les deux.
"""

from .models import StorefrontVersion

SECTIONS = ("livraison", "demandes", "collection", "histoire", "suivi")
MOTIONS = ("full", "soft", "none")
COVERS = ("featured", "name")

# Chaque thème : son nom, le plan à partir duquel il est compris, et ses sections par défaut
# (celles du plan Gratuit, qui ne peut pas les changer).
THEMES = {
    "essentiel": {"label": "Essentiel", "plan": "free", "sections": ("livraison", "collection", "suivi")},
    "epicerie": {"label": "Épicerie", "plan": "free", "sections": ("livraison", "demandes", "collection", "suivi")},
    "beaute": {"label": "Beauté", "plan": "pro", "sections": ("collection", "histoire", "livraison", "suivi")},
    "artisanat": {"label": "Artisanat", "plan": "pro", "sections": ("histoire", "collection", "livraison", "suivi")},
    "piece-phare": {"label": "Pièce phare", "plan": "pro", "sections": ("histoire", "collection", "livraison", "suivi")},
}

PLAN_RANK = {"free": 0, "pro": 1, "business": 2}
VERSIONS_KEPT = {"free": 1, "pro": 5, "business": 20}


def default_config(theme="essentiel"):
    """La vitrine d'une boutique qui n'a encore rien publié : la vitrine d'avant l'éditeur."""
    return {
        "version": 1,
        "theme": theme,
        "motion": "full",
        "cover": "featured",
        "sections": list(THEMES[theme]["sections"]),
        "texts": {"tagline": "", "story": ""},
    }


def published_design(shop):
    published = StorefrontVersion.objects.for_shop(shop).filter(status=StorefrontVersion.Status.PUBLISHED).first()
    return published.config if published else default_config()
