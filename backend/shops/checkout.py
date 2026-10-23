"""
Passage de commande depuis la vitrine publique (docs/contrat-api.md §2.13 et §4.4).

Le client n'est jamais cru sur parole : prix, frais de livraison et total sont recalculés ici,
et le stock est décrémenté dans la même transaction que la création de la commande.
"""

import hashlib
import json
from datetime import timedelta

from django.db import transaction
from django.db.models import F
from django.utils import timezone

from core.exceptions import ProblemError

from .delivery import find_zone
from .discount_codes import invalid as discount_invalid
from .discount_codes import usable_discount
from .locks import lock_shop
from .models import Channel, Customer, Discount, IdempotencyRecord, Order, OrderItem, OrderStatus, Product, new_reference

IDEMPOTENCY_TTL = timedelta(hours=24)


def request_hash(data):
    """Empreinte du contenu validé : deux envois identiques donnent la même empreinte."""
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str)
    return hashlib.sha256(canonical.encode()).hexdigest()


def fake_response(data):
    """Réponse donnée à un robot (champ piège rempli) : elle ressemble à une vraie, rien n'est créé."""
    return {"reference": new_reference(), "total": data.get("expected_total") or 0, "status": OrderStatus.PENDING, "discount_amount": 0}


def place_order(shop, data, idempotency_key):
    """
    Crée la commande et renvoie (réponse, commande). `data` sort de CheckoutSerializer.
    Une clé déjà vue avec le même contenu renvoie la même réponse, sans nouvelle commande.
    """
    fingerprint = request_hash(data)
    # SQLite : transaction_mode IMMEDIATE (settings) prend le verrou d'écriture dès le début. PostgreSQL : le verrou
    # de la boutique fait la même chose. Dans les deux cas, les commandes d'une boutique passent l'une après l'autre :
    # le stock ne se vide pas deux fois et une clé d'idempotence rejouée renvoie la réponse déjà donnée.
    with transaction.atomic():
        lock_shop(shop)
        IdempotencyRecord.objects.filter(created_at__lt=timezone.now() - IDEMPOTENCY_TTL).delete()
        previous = IdempotencyRecord.objects.filter(shop=shop, key=idempotency_key).first()
        if previous is not None:
            if previous.request_hash != fingerprint:
                raise ProblemError(
                    409, "idempotency_conflict", "Cette clé d'idempotence a déjà servi pour une autre commande."
                )
            return previous.response, None

        lines = priced_lines(shop, data["items"])
        zone = find_zone(data["customer"]["city"], data["customer"].get("commune", ""))
        subtotal = sum(line["line_total"] for line in lines)
        # Le code ne vaut qu'avec le téléphone de la commande ; tout refus donne la même erreur.
        discount = usable_discount(shop, data["discount_code"], data["customer"]["phone"]) if data.get("discount_code") else None
        discount_amount = discount.amount_for(subtotal) if discount else 0
        total = subtotal - discount_amount + zone.fee

        expected = data.get("expected_total")
        if expected is not None and expected != total:
            raise ProblemError(
                409,
                "price_changed",
                "Le total a changé depuis l'affichage de votre panier.",
                subtotal=subtotal,
                discount_amount=discount_amount,
                delivery_fee=zone.fee,
                total=total,
            )

        if discount is not None:
            # Décompte conditionnel : deux commandes simultanées ne peuvent pas user deux fois un code à usage unique.
            # Un échec annule toute la transaction, stock compris.
            used = Discount.objects.filter(
                pk=discount.pk, uses__lt=F("max_uses"), revoked_at__isnull=True, ends_on__gte=timezone.localdate()
            ).update(uses=F("uses") + 1)
            if used != 1:
                raise discount_invalid()

        customer = data["customer"]
        order = Order.objects.create(
            shop=shop,
            reference=_free_reference(shop),
            payment_method=data["payment_method"],
            customer_name=customer["name"],
            customer_phone=customer["phone"],
            customer_city=zone.city,
            customer_commune=zone.commune,
            customer_landmark=customer.get("landmark", ""),
            subtotal=subtotal,
            discount=discount,
            discount_code=discount.code if discount else "",
            discount_amount=discount_amount,
            delivery_fee=zone.fee,
            total=total,
            channel=data.get("channel") or Channel.DIRECT,
        )
        # La fiche client suit le dernier nom donné avec ce numéro ; un fidèle nommé le reste.
        Customer.objects.update_or_create(shop=shop, phone=customer["phone"], defaults={"name": customer["name"]})
        OrderItem.objects.bulk_create(
            OrderItem(
                order=order,
                product=line["product"],
                name=line["product"].name,
                unit_price=line["product"].price,
                quantity=line["quantity"],
                line_total=line["line_total"],
            )
            for line in lines
        )
        for line in lines:
            # Décrément conditionnel : même si deux écritures se croisaient, le stock ne passerait pas sous zéro.
            updated = Product.objects.filter(pk=line["product"].pk, stock__gte=line["quantity"]).update(
                stock=F("stock") - line["quantity"]
            )
            if updated != 1:
                raise ProblemError(409, "out_of_stock", "Un article vient d'être épuisé.")

        response = {"reference": order.reference, "total": order.total, "status": order.status, "discount_amount": order.discount_amount}
        IdempotencyRecord.objects.create(shop=shop, key=idempotency_key, request_hash=fingerprint, response=response)
    return response, order


def priced_lines(shop, items):
    """Lignes au prix du serveur. Produit inconnu ou masqué : erreur de saisie. Stock insuffisant : 409."""
    wanted = {item["product_id"]: item["quantity"] for item in items}
    # Clés en texte : les identifiants arrivent en texte dans `data` (forme stable pour l'empreinte).
    products = {str(p.pk): p for p in Product.objects.for_shop(shop).filter(pk__in=wanted, is_active=True)}

    unknown = {
        f"items.{index}.product_id": [{"code": "product_unavailable", "message": "Cet article n'est plus en vente."}]
        for index, item in enumerate(items)
        if item["product_id"] not in products
    }
    if unknown:
        raise ProblemError(400, "validation_error", "Certains articles ne sont plus en vente.", errors=unknown)

    short = {
        f"items.{index}.quantity": [
            {
                "code": "out_of_stock",
                "message": f"Il en reste {products[item['product_id']].stock}." if products[item["product_id"]].stock else "Épuisé.",
                "available": products[item["product_id"]].stock,
            }
        ]
        for index, item in enumerate(items)
        if products[item["product_id"]].stock < item["quantity"]
    }
    if short:
        raise ProblemError(409, "out_of_stock", "Certains articles n'ont plus assez de stock.", errors=short)

    return [
        {"product": products[item["product_id"]], "quantity": item["quantity"], "line_total": products[item["product_id"]].price * item["quantity"]}
        for item in items
    ]


def _free_reference(shop):
    while True:
        reference = new_reference()
        if not Order.objects.filter(shop=shop, reference=reference).exists():
            return reference
