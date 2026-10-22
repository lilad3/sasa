"""
Règles des codes de réduction (docs/chantier-p5.md §1.2 et §1.5), sans vue : partagées par la
vérification en vitrine et par la commande, qui les rejoue dans sa transaction.

Le code seul ne sert à rien : il ne vaut qu'avec le téléphone du client à qui il a été offert.
Toute raison de refus (code inconnu, expiré, épuisé, annulé ou lié à un autre numéro) donne la même
réponse : on ne doit pas pouvoir apprendre si un numéro est client de la boutique.
"""

import re
import secrets
import unicodedata

from core.exceptions import ProblemError

from .models import REFERENCE_ALPHABET, Discount, DiscountKind

# Vérification et commande partagent le compteur par code : 5 essais par heure et par code.
CHECK_IP_LIMIT = (20, 3600)
CHECK_CODE_LIMIT = (5, 3600)

NOT_ALNUM = re.compile(r"[^A-Za-z0-9]")


def normalize_code(raw):
    """« aya 7k2q », « AYA7K2Q » ou « aya-7k2q » donnent « AYA-7K2Q » ; autre chose donne None."""
    chars = NOT_ALNUM.sub("", raw or "").upper()
    if len(chars) != 7:
        return None
    # Le préfixe vient d'un prénom : un 0 ou un 1 tapés à la place d'un O ou d'un I y sont corrigés.
    prefix = chars[:3].replace("0", "O").replace("1", "I")
    if not prefix.isalpha():
        return None
    return f"{prefix}-{chars[3:]}"


def code_prefix(name):
    """Les 3 premières lettres du prénom, sans accents : « Élodie » donne ELO, « Bi » donne BIX."""
    first = (name or "").split()[0] if (name or "").split() else ""
    letters = "".join(ch for ch in unicodedata.normalize("NFD", first).upper() if "A" <= ch <= "Z")
    return (letters + "XXX")[:3]


def new_code(shop, name):
    prefix = code_prefix(name)
    while True:
        code = f"{prefix}-{''.join(secrets.choice(REFERENCE_ALPHABET) for _ in range(4))}"
        if not Discount.objects.filter(shop=shop, code=code).exists():
            return code


def invalid():
    return ProblemError(400, "discount_invalid", "Ce code ne fonctionne pas avec ce numéro.")


def code_key(shop, raw):
    """Clé du compteur par code : le code normalisé, ou à défaut le texte saisi (borné)."""
    return f"{shop.pk}:{normalize_code(raw) or NOT_ALNUM.sub('', raw or '').upper()[:12]}"


def usable_discount(shop, raw_code, phone):
    """La réduction si ce téléphone peut l'utiliser maintenant ; sinon, toujours la même erreur."""
    code = normalize_code(raw_code)
    discount = Discount.objects.for_shop(shop).select_related("customer").filter(code=code).first() if code else None
    if discount is None or discount.customer.phone != phone or discount.status() != "active":
        raise invalid()
    return discount


def label(kind, value):
    """« −15 % » ou « −2 000 F » (espaces insécables, comme sur une étiquette)."""
    if kind == DiscountKind.PERCENT:
        return f"−{value} %"
    return f"−{value:,}".replace(",", " ") + " F"
