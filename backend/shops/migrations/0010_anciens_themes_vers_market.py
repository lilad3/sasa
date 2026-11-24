"""Les anciens thèmes sont supprimés (24/11/2026) : leurs vitrines passent au style Market, pack « Un peu de tout »."""

from django.db import migrations

OLD_THEMES = {"essentiel", "epicerie", "beaute", "artisanat", "piece-phare"}
MARKET_SECTIONS = ["livraison", "demandes", "collection", "suivi"]


def convert(config):
    """Renvoie la configuration passée à Market, ou None si elle n'utilisait pas un ancien thème."""
    if not isinstance(config, dict) or config.get("theme") not in OLD_THEMES:
        return None
    sections = [s for s in config.get("sections", []) if s in {"livraison", "demandes", "collection", "histoire", "suivi"}]
    if "collection" not in sections:
        sections = MARKET_SECTIONS
    return {**config, "theme": "market", "pack": "general", "sections": sections}


def forwards(apps, schema_editor):
    StorefrontVersion = apps.get_model("shops", "StorefrontVersion")
    for version in StorefrontVersion.objects.all().only("pk", "config"):
        new = convert(version.config)
        if new is not None:
            StorefrontVersion.objects.filter(pk=version.pk).update(config=new)


class Migration(migrations.Migration):
    dependencies = [("shops", "0009_boutique_theme_genere")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
