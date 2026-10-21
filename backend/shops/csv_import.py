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
from .models import Product
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
    "seuil": "low_stock_threshold", "seuil_alerte": "low_stock_threshold",
    "image": "image_url", "image_url": "image_url",
}
NUMBERS = {"price", "stock", "low_stock_threshold"}
YES = {"oui", "o", "1", "true", "vrai", "yes", "x"}
NO = {"non", "n", "0", "false", "faux", "no"}


def import_products(shop, upload, *, dry_run):
    rows = _read_rows(upload)
    existing = {product.sku.upper(): product for product in Product.objects.for_shop(shop)}
    errors, creations, updates, seen = [], [], [], set()
    taken_slugs = set()

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
        serializer = ProductSerializer(
            product, data=data, partial=product is not None, context={"shop": shop, "taken_slugs": taken_slugs}
        )
        if not serializer.is_valid():
            # Un champ déjà refusé à la conversion (« douze » pour un prix) n'a pas besoin d'une 2e erreur « obligatoire ».
            rejected = {field for field, _, _ in problems}
            for field, details in serializer.errors.items():
                if field not in rejected:
                    errors.append(_error(line, field, details[0].code, str(details[0])))
        elif not problems:
            (updates if product else creations).append(serializer)

    limit = plans.spec(shop).products
    if limit is not None and len(existing) + len(creations) > limit:
        errors.append(
            _error(0, "file", "plan_limit_reached", f"Votre plan permet {limit} produits : ce fichier en créerait {len(creations)} de plus.")
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
            for serializer in [*creations, *updates]:
                serializer.save()
    return report


def _read_rows(upload):
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
            if value.lower() in YES:
                data[field] = True
            elif value.lower() in NO:
                data[field] = False
            else:
                problems.append((field, "invalid_boolean", "« oui » ou « non » attendu."))
        else:
            data[field] = value
    return data, problems


def _error(line, field, code, message):
    return {"line": line, "field": field, "code": code, "message": message}
