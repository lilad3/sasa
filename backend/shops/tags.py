"""Étiquettes de produit (docs/chantier-a2-produits.md §A2.6) : comparées par `key`, affichées sous une seule forme par boutique."""

import re
import unicodedata
from collections import Counter

from django.db.models import Count

from .models import Product, ProductTag

MAX_LABEL = 30
MAX_PER_PRODUCT = ProductTag.MAX_PER_PRODUCT
SUGGESTIONS = 20
OVERVIEW = 30


def tag_key(label):
    """Sans accents, sans casse, espaces compressés : « Câdeau », « cadeau » et « CADEAU » ne font qu'une étiquette."""
    plain = unicodedata.normalize("NFKD", label)
    plain = "".join(ch for ch in plain if not unicodedata.combining(ch))
    return re.sub(r"\s+", " ", plain).strip().casefold()[:60]


def clean_label(label):
    return re.sub(r"\s+", " ", label).strip()


def dedupe(labels):
    """[(label, key)] sans doublon de `key`, dans l'ordre de saisie."""
    seen, result = set(), []
    for raw in labels:
        label = clean_label(raw)
        key = tag_key(label)
        if label and key not in seen:
            seen.add(key)
            result.append((label, key))
    return result


def replace_tags(product, labels):
    """Remplace la liste du produit (sous le verrou de sa ligne, pris par l'appelant) ; 10 au plus, vérifié ailleurs."""
    wanted = dedupe(labels)
    keep = {key for _, key in wanted}
    ProductTag.objects.filter(product=product).exclude(key__in=keep).delete()
    have = set(ProductTag.objects.filter(product=product).values_list("key", flat=True))
    ProductTag.objects.bulk_create(
        ProductTag(shop_id=product.shop_id, product=product, label=label, key=key) for label, key in wanted if key not in have
    )


def display_labels(shop):
    """key → libellé le plus fréquent de la boutique (à égalité, l'ordre alphabétique) : une seule forme à l'écran."""
    rows = ProductTag.objects.for_shop(shop).values("key", "label").annotate(n=Count("id"))
    best = {}
    for row in rows:
        current = best.get(row["key"])
        candidate = (-row["n"], row["label"])
        if current is None or candidate < current:
            best[row["key"]] = candidate
    return {key: candidate[1] for key, candidate in best.items()}


def labels_of(product, labels_by_key):
    return [labels_by_key.get(tag.key, tag.label) for tag in product.tags.all()]


def popular(shop, prefix="", limit=SUGGESTIONS):
    """Les plus utilisées d'abord : {label, count}, filtrées par préfixe de `key`."""
    rows = ProductTag.objects.for_shop(shop)
    if prefix := tag_key(prefix):
        rows = rows.filter(key__startswith=prefix)
    counts = Counter()
    for key, n in rows.values_list("key").annotate(n=Count("id")):
        counts[key] = n
    labels = display_labels(shop)
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[:limit]
    return [{"label": labels.get(key, key), "count": n} for key, n in ranked]


def lock_for_tags(product_id, shop):
    """La ligne produit verrouillée : deux ajouts simultanés ne passent pas 10."""
    return Product.objects.for_shop(shop).select_for_update().filter(pk=product_id).first()
