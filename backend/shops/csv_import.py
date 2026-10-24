"""
Import de produits depuis un CSV (Excel : Fichier > Enregistrer sous > CSV).

Tout ou rien : une seule ligne en erreur et rien n'est enregistré, pour ne jamais laisser un
catalogue à moitié importé. Une ligne dont la référence (SKU) existe met le produit à jour ;
une cellule vide ne change pas la valeur existante.
"""

import csv
import io
import unicodedata

from django.db import transaction

from core.exceptions import ProblemError

from . import plans
from . import stock as stock_ledger
from .models import Product, ProductStatus, StockReason
from .serializers import ProductSerializer

MAX_BYTES = 512 * 1024
MAX_ROWS = 1000
MAX_REPORTED_ERRORS = 100

# En-têtes acceptés, sans accents ni majuscules : les noms français d'abord.
COLUMNS = {
    "sku": "sku", "reference": "sku", "ref": "sku",
    "nom": "name", "name": "name", "produit": "name",
    "prix": "price", "price": "price",
    "stock": "stock", "quantite": "stock",
    "categorie": "category", "category": "category", "rayon": "category",
    "description": "description",
    "actif": "is_active", "active": "is_active", "en_vente": "is_active",
    "statut": "status", "status": "status",
    "prix_barre": "compare_at_price", "ancien_prix": "compare_at_price", "compare_at_price": "compare_at_price",
    "cout": "cost", "cout_achat": "cost", "cost": "cost",
    "etiquettes": "tags", "tags": "tags",
    "seuil": "low_stock_threshold", "seuil_alerte": "low_stock_threshold",
    "image": "image_url", "image_url": "image_url",
}
NUMBERS = {"price", "stock", "low_stock_threshold", "compare_at_price", "cost"}
STATUSES = {
    "brouillon": ProductStatus.DRAFT, "draft": ProductStatus.DRAFT, "actif": ProductStatus.ACTIVE, "active": ProductStatus.ACTIVE,
    "archive": ProductStatus.ARCHIVED, "archived": ProductStatus.ARCHIVED,
}
YES = {"oui", "o", "1", "true", "vrai", "yes", "x"}
NO = {"non", "n", "0", "false", "faux", "no"}


def import_products(shop, upload, *, dry_run, can_cost=False, actor=None):
    rows = _read_rows(upload, can_cost)
    existing = {product.sku.upper(): product for product in Product.objects.for_shop(shop)}
    errors, creations, updates, seen = [], [], [], set()
    taken_slugs = set()
    stocks = {}  # ligne → stock du fichier, pour un produit existant (il passe par stock.set_to, jamais par la fiche)

    for line, row in rows:
        sku = row.get("sku", "").strip()
        if not sku:
            errors.append(_error(line, "sku", "required", "La référence (sku) est obligatoire."))
            continue
        if sku.upper() in seen:
            errors.append(_error(line, "sku", "duplicate_sku", "Cette référence apparaît deux fois dans le fichier."))
            continue
        seen.add(sku.upper())
        data, problems = _clean(row)
        errors.extend(_error(line, field, code, message) for field, code, message in problems)
        product = existing.get(sku.upper())
        counted = data.pop("stock", None) if product is not None else None
        serializer = ProductSerializer(
            product, data=data, partial=product is not None,
            context={"shop": shop, "taken_slugs": taken_slugs, "can_cost": can_cost, "actor": actor, "stock_reason": StockReason.IMPORT},
        )
        if not serializer.is_valid():
            # Un champ déjà refusé à la conversion (« douze » pour un prix) n'a pas besoin d'une 2e erreur « obligatoire ».
            rejected = {field for field, _, _ in problems}
            for field, details in serializer.errors.items():
                if field not in rejected:
                    errors.append(_error(line, field, details[0].code, str(details[0])))
        elif not problems:
            (updates if product else creations).append(serializer)
            if counted is not None:
                stocks[id(serializer)] = counted

    # Le plafond compte les créations non archivées et les désarchivages.
    adding = sum(1 for s in creations if s.validated_data.get("status") != ProductStatus.ARCHIVED) + sum(
        1 for s in updates if s.instance.status == ProductStatus.ARCHIVED and s.validated_data.get("status", s.instance.status) != ProductStatus.ARCHIVED
    )
    limit = plans.spec(shop).products
    if limit is not None and plans.count(shop, "products") + adding > limit:
        errors.append(
            _error(0, "file", "plan_limit_reached", f"Votre plan permet {limit} produits : ce fichier en créerait {adding} de plus.")
        )

    report = {
        "dry_run": dry_run,
        "rows": len(rows),
        "created": len(creations),
        "updated": len(updates),
        "error_count": len(errors),
        "errors": errors[:MAX_REPORTED_ERRORS],
    }
    if errors:
        # Tout ou rien : rien n'est enregistré, le rapport dit quoi corriger.
        return report if dry_run else {**report, "created": 0, "updated": 0}
    if not dry_run:
        with transaction.atomic():
            # Le plafond se revérifie sous le verrou de la boutique : deux imports simultanés ne le dépassent pas.
            plans.lock_shop(shop)
            plans.ensure_room(shop, "products", adding=adding)
            for serializer in [*creations, *updates]:
                product = serializer.save()
                if id(serializer) in stocks:
                    stock_ledger.set_to(product.pk, stocks[id(serializer)], StockReason.IMPORT, shop=shop, actor=actor)
    return report


def _read_rows(upload, can_cost):
    if upload.size > MAX_BYTES:
        raise ProblemError(413, "file_too_large", "Fichier trop lourd : 512 Ko au maximum (environ 1 000 produits).")
    if not upload.name.lower().endswith(".csv"):
        raise ProblemError(415, "unsupported_file", "Envoyez un fichier .csv (Excel : Fichier > Enregistrer sous > CSV).")
    raw = upload.read(MAX_BYTES + 1)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1252", errors="replace")  # CSV enregistré par un ancien Excel
    if "\x00" in text:
        raise ProblemError(415, "unsupported_file", "Ce fichier n'est pas un CSV lisible.")

    first_line = text.split("\n", 1)[0]
    delimiter = max([";", ",", "\t"], key=first_line.count)
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    header = [_column(name) for name in next(reader, [])]
    if "cost" in header and not can_cost:
        # Avant toute lecture de ligne, et sans jamais répéter une valeur.
        raise ProblemError(403, "permission_denied", "La colonne coût est réservée au propriétaire.")
    if "sku" not in header:
        raise ProblemError(
            400, "validation_error", "La première ligne doit nommer les colonnes, dont « sku » (la référence du produit).",
            errors={"file": [{"code": "missing_column", "message": "Colonne « sku » introuvable."}]},
        )

    rows = []
    for line, cells in enumerate(reader, start=2):
        if not any(cell.strip() for cell in cells):
            continue
        if len(rows) == MAX_ROWS:
            raise ProblemError(413, "file_too_large", f"{MAX_ROWS} produits au maximum par import.")
        rows.append((line, {field: cell.strip() for field, cell in zip(header, cells, strict=False) if field}))
    return rows


def _column(name):
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().strip().lower().replace(" ", "_")
    return COLUMNS.get(plain)


def _clean(row):
    """Convertit les cellules (« 2 500 F », « oui ») ; une cellule vide est ignorée."""
    data, problems = {}, []
    for field, value in row.items():
        if value == "":
            continue
        if field in NUMBERS:
            digits = value.upper().replace("FCFA", "").replace("F", "")
            digits = "".join(ch for ch in digits if not ch.isspace())
            if not digits.isdigit():
                problems.append((field, "invalid_number", "Nombre entier attendu (sans centimes)."))
                continue
            data[field] = int(digits)
        elif field == "is_active":
            # Anciens fichiers : « oui » met en vente, « non » en brouillon. Une colonne « statut » l'emporte.
            if value.lower() in YES:
                legacy_status = ProductStatus.ACTIVE
            elif value.lower() in NO:
                legacy_status = ProductStatus.DRAFT
            else:
                problems.append((field, "invalid_boolean", "« oui » ou « non » attendu."))
                continue
            data.setdefault("status", legacy_status)
        elif field == "status":
            plain = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode().strip().lower()
            if plain not in STATUSES:
                problems.append((field, "invalid_choice", "« brouillon », « actif » ou « archivé » attendu."))
                continue
            data[field] = STATUSES[plain]
        elif field == "tags":
            labels = [part.strip() for part in value.replace("|", ",").split(",") if part.strip()]
            data[field] = labels
        else:
            data[field] = value
    return data, problems


def _error(line, field, code, message):
    return {"line": line, "field": field, "code": code, "message": message}
