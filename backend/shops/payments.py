"""
Moyens de paiement d'une boutique et instructions montrées au client (docs/chantier-a2-paiements-livraison.md §1.1, §4.3).

Aucun paiement ne passe par Akwaba : le client paie le commerçant sur son numéro. Ce numéro est donc
l'objet le plus sensible du chantier. Règles tenues ici :
- un numéro qui REMPLACE un autre attend 24 h (`pending_*`) ; pendant l'attente, les clients voient l'ancien ;
- l'activation se calcule à la lecture (`effective_payout`), sans tâche planifiée ;
- le numéro entier n'entre jamais dans le journal : seulement ses deux derniers chiffres (`last2`).
"""

import re
import unicodedata
from datetime import timedelta

from django.utils import timezone

from audit.services import record

from .models import MOBILE_MONEY, PaymentMethod, ShopPaymentMethod

PENDING_DELAY = timedelta(hours=24)
PAYMENT_ORDER = [value for value, _ in PaymentMethod.choices]
LABELS = dict(PaymentMethod.choices)
SHORT = {
    "cash_on_delivery": "Livraison",
    "orange_money": "Orange Money",
    "mtn_momo": "MTN MoMo",
    "moov_money": "Moov Money",
    "wave": "Wave",
}

# Un nom affiché au client ne doit pas faire croire que le numéro est celui d'un opérateur ou d'un service.
# Liste fermée : on cherche ces mots entiers (sans accents ni casse) dans le nom.
RESERVED_NAME_WORDS = frozenset(
    {"wave", "orange", "mtn", "moov", "money", "momo", "akwaba", "support", "assistance", "operateur", "officiel", "official"}
)
RESERVED_NAME_PHRASES = ("service client", "customer service", "mobile money")


def fold(text):
    text = unicodedata.normalize("NFKD", text or "")
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"[^a-z0-9]+", " ", text.casefold()).strip()


def name_imitates_service(name):
    folded = fold(name)
    if not folded:
        return False
    words = set(folded.split())
    squashed = folded.replace(" ", "")
    return bool(words & RESERVED_NAME_WORDS) or any(phrase.replace(" ", "") in squashed for phrase in RESERVED_NAME_PHRASES)


def last2(number):
    """Les deux derniers chiffres seulement : tout ce que le journal et les e-mails gardent d'un numéro."""
    return number[-2:] if number else None


def display_number(number):
    """+2250707123456 → « +225 07 07 12 34 56 »."""
    digits = number[4:]
    return "+225 " + " ".join(digits[i : i + 2] for i in range(0, len(digits), 2))


def fcfa(amount):
    return f"{amount:,}".replace(",", " ") + " F"


def lock_shop(shop):
    """Verrou de ligne sur la boutique (sans effet sur SQLite, qui sérialise déjà les écritures)."""
    from .models import Shop

    return Shop.objects.select_for_update().get(pk=shop.pk)


def rows(shop):
    """Les 5 réglages dans l'ordre de PaymentMethod. Une ligne absente se lit « accepté, sans numéro » (rien n'est écrit)."""
    existing = {row.method: row for row in ShopPaymentMethod.objects.for_shop(shop)}
    return [existing.get(method) or ShopPaymentMethod(shop=shop, method=method, enabled=True) for method in PAYMENT_ORDER]


def is_enabled(shop, method):
    return any(row.method == method and row.enabled for row in rows(shop))


def active_methods(shop):
    return [row.method for row in rows(shop) if row.enabled]


def pending_due(row, now=None):
    """Vrai quand le numéro en attente a passé ses 24 h."""
    return row.pending_at is not None and (now or timezone.now()) >= row.pending_at + PENDING_DELAY


def activates_at(row):
    return row.pending_at + PENDING_DELAY if row.pending_at else None


def effective_payout(row, now=None):
    """(numéro, nom) que voient les clients : l'ancien pendant l'attente, le nouveau une fois les 24 h passées."""
    if pending_due(row, now):
        return row.pending_number, row.pending_name
    return row.payout_number, row.payout_name


def settle_pending(shop, request=None):
    """
    Fait passer les numéros dont l'attente est finie, et le note au journal. Mise à jour conditionnelle :
    deux lectures simultanées n'activent (et ne journalisent) qu'une fois. La lecture reste juste même
    sans cet appel, puisque `effective_payout` fait le même calcul.
    """
    now = timezone.now()
    due = ShopPaymentMethod.objects.for_shop(shop).filter(pending_at__isnull=False, pending_at__lte=now - PENDING_DELAY)
    for row in list(due):
        done = ShopPaymentMethod.objects.filter(pk=row.pk, pending_at=row.pending_at).update(
            payout_number=row.pending_number, payout_name=row.pending_name, pending_number="", pending_name="", pending_at=None
        )
        if done:
            record(
                "payout_number_activated",
                request,
                shop=shop,
                target=("payment_method", row.pk, LABELS[row.method]),
                method=row.method,
                previous_last2=last2(row.payout_number),
                new_last2=last2(row.pending_number),
            )


def instruction_text(method, number, holder, amount, reference):
    label = LABELS[method]
    if not number:
        return f"La boutique vous enverra la demande de paiement {label} au numéro indiqué lors de la commande."
    return f"Envoyez {fcfa(amount)} par {label} au {display_number(number)} ({holder}). Indiquez la référence {reference}."


def payment_instructions(shop, method, amount, reference, row=None):
    """
    Le texte que voit le client, écrit par le serveur seul. Le numéro est lu EN DIRECT (pas copié dans la commande).
    Paiement à la livraison : None.
    """
    if method not in MOBILE_MONEY:
        return None
    row = row or next((r for r in rows(shop) if r.method == method), None)
    number, holder = effective_payout(row) if row else ("", "")
    return {
        "method": method,
        "label": LABELS[method],
        "number": number or None,
        "number_display": display_number(number) if number else None,
        "holder": (holder or None) if number else None,
        "amount": amount,
        "reference": reference,
        "text": instruction_text(method, number, holder, amount, reference),
    }
