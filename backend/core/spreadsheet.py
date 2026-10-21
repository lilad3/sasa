"""Exports CSV ouverts dans Excel : séparateur « ; » (Excel français) et formules neutralisées."""

import csv
import io

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def csv_safe(value):
    """Une cellule qui commence par = + - @ serait exécutée comme une formule par Excel."""
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(FORMULA_PREFIXES) else text


def excel_csv(header, rows):
    """Contenu CSV avec BOM (Excel reconnaît l'UTF-8) ; chaque cellule passe par csv_safe."""
    buffer = io.StringIO()
    buffer.write("﻿")
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(header)
    for row in rows:
        writer.writerow([csv_safe(cell) for cell in row])
    return buffer.getvalue()
