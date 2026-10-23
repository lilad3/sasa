"""
Réglages de paiement du propriétaire (docs/chantier-a2-paiements-livraison.md §3.1, §3.2 et revue Alice).

Le serveur seul juge : un numéro ou un nom ne change qu'avec une confirmation d'identité récente, jamais pour un
compte de démo, au plus 3 fois par jour et par boutique. Un numéro qui REMPLACE un autre attend 24 h et peut être
annulé d'un clic (annuler protège : pas de confirmation). Le journal et les e-mails ne montrent que deux chiffres.
"""

import logging

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.response import Response

from accounts import emails
from accounts.sessions import require_reauth
from audit.services import record
from core.exceptions import ProblemError
from core.ratelimit import enforce

from .models import MOBILE_MONEY, Membership, PaymentMethod, Role, ShopPaymentMethod
from .payments import (
    LABELS,
    PAYMENT_ORDER,
    PENDING_DELAY,
    SHORT,
    activates_at,
    effective_payout,
    last2,
    lock_shop,
    name_imitates_service,
    payment_instructions,
    rows,
    settle_pending,
)
from .permissions import ShopScopedView
from .storefront import normalize_phone, plain_text

logger = logging.getLogger("akwaba")

PAYOUT_CHANGE_LIMIT = (3, 86400)  # 3 changements de numéro par jour et par boutique
EXAMPLE_AMOUNT, EXAMPLE_REFERENCE = 12_500, "K7F-92Q"
PAGE = "/app/{slug}/parametres/paiements"


def _error(field, message, code):
    return ValidationError({field: [ErrorDetail(message, code=code)]})


class MethodSerializer(serializers.Serializer):
    method = serializers.ChoiceField(choices=PaymentMethod.choices)
    enabled = serializers.BooleanField()
    payout_number = serializers.CharField(max_length=24, allow_blank=True, required=False, default="")
    payout_name = serializers.CharField(max_length=40, allow_blank=True, required=False, default="", validators=[plain_text])


class PaymentSettingsSerializer(serializers.Serializer):
    methods = MethodSerializer(many=True, allow_empty=False, max_length=len(PAYMENT_ORDER))

    def validate_methods(self, methods):
        if sorted(m["method"] for m in methods) != sorted(PAYMENT_ORDER):
            raise serializers.ValidationError("Les 5 moyens de paiement, chacun une fois.", code="validation_error")
        return methods


def clean_method(index, item):
    """Forme du numéro et du nom, moyen par moyen. Les erreurs portent le champ : `methods.2.payout_number`."""
    number, name = item["payout_number"].strip(), item["payout_name"].strip()
    if item["method"] not in MOBILE_MONEY:
        if number or name:
            field = "payout_number" if number else "payout_name"
            raise _error(f"methods.{index}.{field}", "Le paiement à la livraison n'a pas de numéro.", "payout_number_not_allowed")
        return {**item, "payout_number": "", "payout_name": ""}
    if number:
        try:
            number = normalize_phone(number)
        except serializers.ValidationError as exc:
            raise _error(f"methods.{index}.payout_number", str(exc.detail[0]), "invalid_phone") from None
    if name and name_imitates_service(name):
        raise _error(
            f"methods.{index}.payout_name",
            "Ce nom ressemble à celui d'un opérateur ou d'un service. Donnez le nom de votre commerce ou le vôtre.",
            "payout_name_reserved",
        )
    return {**item, "payout_number": number, "payout_name": name}


def settings_payload(shop):
    now = timezone.now()
    methods = []
    for row in rows(shop):
        kind = "mobile_money" if row.method in MOBILE_MONEY else "cash"
        number, name = effective_payout(row, now)
        instructions = payment_instructions(shop, row.method, EXAMPLE_AMOUNT, EXAMPLE_REFERENCE, row=row)
        methods.append(
            {
                "method": row.method,
                "label": LABELS[row.method],
                "short": SHORT[row.method],
                "kind": kind,
                "enabled": row.enabled,
                "payout_number": number,
                "payout_name": name,
                # Le texte vient de la même fonction que la confirmation de commande : le front ne le compose jamais.
                "example": instructions["text"] if instructions else None,
                "pending": (
                    {
                        "payout_number": row.pending_number,
                        "payout_name": row.pending_name,
                        "since": row.pending_at,
                        "activates_at": activates_at(row),
                    }
                    if row.pending_at and row.pending_number
                    else None
                ),
            }
        )
    enabled = [m for m in methods if m["enabled"]]
    return {
        "summary": " + ".join(m["short"] for m in enabled),
        "missing_numbers": sum(1 for m in enabled if m["kind"] == "mobile_money" and not m["payout_number"]),
        "pending_count": sum(1 for m in methods if m["pending"]),
        "methods": methods,
    }


def _alert_owners(shop, request, action, lines):
    """Un e-mail à CHAQUE propriétaire (un voleur de session ne s'écrit pas à lui-même). Un échec n'annule rien."""
    owners = [m.user for m in Membership.objects.filter(shop=shop, role=Role.OWNER).select_related("user")]
    for owner in owners:
        try:
            emails.send_security_alert(
                owner, action, request, link=PAGE.format(slug=shop.slug), shop=shop.name, changes="\n".join(lines)
            )
        except Exception:
            logger.exception("Alerte de changement de numéro non envoyée (boutique %s)", shop.slug)


class PaymentSettingsView(ShopScopedView):
    permission_by_method = {"GET": "shop.manage", "PUT": "shop.manage"}

    def get(self, request, slug):
        settle_pending(self.shop, request)
        return Response(settings_payload(self.shop))

    def put(self, request, slug):
        # La démo d'abord : rien d'autre n'est examiné ni révélé.
        if request.user.is_demo:
            raise ProblemError(403, "demo_restricted", "Action désactivée sur les comptes de démonstration.")
        serializer = PaymentSettingsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        wanted = {}
        for index, item in enumerate(serializer.validated_data["methods"]):
            wanted[item["method"]] = clean_method(index, item)
        index_of = {item["method"]: i for i, item in enumerate(serializer.validated_data["methods"])}
        if not any(item["enabled"] for item in wanted.values()):
            raise ProblemError(400, "payment_methods_required", "Gardez au moins un moyen de paiement.")

        settle_pending(self.shop, request)
        events, lines, pending_started = [], [], False
        with transaction.atomic():
            lock_shop(self.shop)
            current = {row.method: row for row in rows(self.shop)}
            before = {method for method, row in current.items() if row.enabled}
            plan = {}
            for method in PAYMENT_ORDER:
                row, new = current[method], wanted[method]
                number, name = new["payout_number"], new["payout_name"]
                touched = number != row.payout_number or name != row.payout_name
                if method in MOBILE_MONEY and new["enabled"] and (touched or not row.enabled):
                    # Un Mobile Money qui s'active, ou dont on touche au numéro ou au nom, exige les deux.
                    if not number:
                        raise _error(f"methods.{index_of[method]}.payout_number", "Indiquez le numéro qui reçoit les paiements.", "payout_number_required")
                    if not name:
                        raise _error(f"methods.{index_of[method]}.payout_name", "Indiquez le nom que verra le client.", "payout_name_required")
                if method in MOBILE_MONEY and not new["enabled"] and not number and name:
                    raise _error(f"methods.{index_of[method]}.payout_number", "Indiquez le numéro qui reçoit les paiements.", "payout_number_required")
                plan[method] = (row, new, number, name, touched)

            changes_numbers = any(touched for *_, touched in plan.values())
            if changes_numbers:
                # Après la validation : une faute de saisie ne coûte pas une confirmation. Hors des Mobile Money, rien à confirmer.
                require_reauth(request)
                enforce("payout_change:shop", str(self.shop.pk), PAYOUT_CHANGE_LIMIT)

            now = timezone.now()
            for method in PAYMENT_ORDER:
                row, new, number, name, touched = plan[method]
                fields = {}
                if new["enabled"] != row.enabled:
                    fields["enabled"] = new["enabled"]
                if touched:
                    if not number:
                        # Retrait : tout de suite, et l'éventuelle attente tombe.
                        fields.update(payout_number="", payout_name="", pending_number="", pending_name="", pending_at=None)
                        events.append(("payout_number_changed", row, {"previous_last2": last2(row.payout_number), "new_last2": None, "name_changed": False}))
                        lines.append(f"{SHORT[method]} : ••••{last2(row.payout_number) or '—'} → numéro retiré")
                    elif number == row.payout_number:
                        # Même numéro, autre nom : un nom ne déplace pas l'argent, il vaut tout de suite.
                        fields["payout_name"] = name
                        events.append(("payout_number_changed", row, {"previous_last2": last2(number), "new_last2": last2(number), "name_changed": True}))
                        lines.append(f"{SHORT[method]} : nom modifié, numéro ••••{last2(number)} inchangé")
                    elif row.had_number:
                        # Il REMPLACE un numéro donné un jour : 24 h d'attente, l'ancien (ou le texte de repli) sert entre-temps.
                        if (number, name) != (row.pending_number, row.pending_name) or row.pending_at is None:
                            fields.update(pending_number=number, pending_name=name, pending_at=now)
                            pending_started = True
                            events.append(
                                (
                                    "payout_number_pending",
                                    row,
                                    {"previous_last2": last2(row.payout_number), "new_last2": last2(number), "activates_at": (now + PENDING_DELAY).isoformat()},
                                )
                            )
                            lines.append(f"{SHORT[method]} : ••••{last2(row.payout_number) or '—'} → ••••{last2(number)} (dans 24 h)")
                    else:
                        # Première saisie : elle sert tout de suite.
                        fields.update(payout_number=number, payout_name=name, had_number=True)
                        events.append(("payout_number_changed", row, {"previous_last2": None, "new_last2": last2(number), "name_changed": bool(name)}))
                        lines.append(f"{SHORT[method]} : numéro ajouté ••••{last2(number)}")
                if fields:
                    fields["updated_by"] = request.user
                    for key, value in fields.items():
                        setattr(row, key, value)
                    row.save()

            after = {m for m in PAYMENT_ORDER if wanted[m]["enabled"]}

        for action, row, details in events:
            record(action, request, actor=request.user, shop=self.shop, target=("payment_method", row.pk, LABELS[row.method]), method=row.method, **details)
        if before != after:
            record(
                "payment_methods_changed",
                request,
                actor=request.user,
                shop=self.shop,
                enabled=[m for m in PAYMENT_ORDER if m in after - before],
                disabled=[m for m in PAYMENT_ORDER if m in before - after],
            )
        if lines:
            _alert_owners(self.shop, request, "payout_number_pending" if pending_started else "payout_number_changed", lines)
        return Response(settings_payload(self.shop))


class PendingPayoutView(ShopScopedView):
    """Annuler l'attente d'un nouveau numéro. Annuler protège : ni confirmation renforcée, ni limite de démo."""

    permission_by_method = {"DELETE": "shop.manage"}

    def delete(self, request, slug, method):
        if method not in PAYMENT_ORDER:
            raise NotFound("Moyen de paiement introuvable.")
        settle_pending(self.shop, request)
        with transaction.atomic():
            lock_shop(self.shop)
            row = ShopPaymentMethod.objects.for_shop(self.shop).filter(method=method, pending_at__isnull=False).first()
            if row is None:
                raise NotFound("Aucun changement de numéro en attente pour ce moyen.")
            pending = last2(row.pending_number)
            # Conditionnel : si l'attente vient de se terminer ailleurs, rien n'est défait à moitié.
            done = ShopPaymentMethod.objects.filter(pk=row.pk, pending_at=row.pending_at).update(
                pending_number="", pending_name="", pending_at=None, updated_by=request.user
            )
        if done:
            record("payout_number_cancelled", request, actor=request.user, shop=self.shop, target=("payment_method", row.pk, LABELS[method]), method=method, pending_last2=pending)
        return Response(settings_payload(self.shop))
