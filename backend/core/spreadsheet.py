"""Exports CSV ouverts dans Excel : séparateur « ; » (Excel français) et formules neutralisées."""

import csv
import io
import re

FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")
PHONE = re.compile(r"\+\d{6,15}")


class _ServerCell(str):
    """Une cellule que le serveur construit lui-même à partir d'une valeur vérifiée : csv_safe la laisse telle quelle."""


def phone_cell(phone):
    """
    « +2250707000001 » lisible dans Excel. Écrit tel quel, le « + » ferait lire une formule ; précédé
    d'une apostrophe, Excel montre l'apostrophe. La formule texte ="+225…" affiche le numéro exact.
    Elle n'est construite que pour un « + » suivi de chiffres seulement : rien d'autre ne peut y entrer.
    """
    text = "" if phone is None else str(phone)
    return _ServerCell(f'="{text}"') if PHONE.fullmatch(text) else text


def csv_safe(value):
    """Une cellule qui commence par = + - @ serait exécutée comme une formule par Excel."""
    if isinstance(value, _ServerCell):
        return str(value)
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
