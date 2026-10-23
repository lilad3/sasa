"""
Reprise des données du chantier A2 (docs/chantier-a2-paiements-livraison.md §1.5). Migration de données seule :
sur PostgreSQL, mêler ALTER TABLE et mises à jour de lignes dans une même transaction peut échouer.

Les 15 zones, leur ordre, leurs frais et la règle des délais sont RECOPIÉS ici (constantes figées) : cette migration
doit donner le même résultat dans deux ans, même si `delivery.py` a changé.
Idempotente : une boutique qui a déjà ses zones ou ses lignes de paiement est sautée.
"""

import re
import unicodedata

from django.db import migrations

ZONES = [
    ("Abidjan", "Cocody", 1500),
    ("Abidjan", "Yopougon", 1500),
    ("Abidjan", "Marcory", 1500),
    ("Abidjan", "Abobo", 1500),
    ("Abidjan", "Plateau", 1500),
    ("Abidjan", "Treichville", 1500),
    ("Abidjan", "Koumassi", 1500),
    ("Abidjan", "Port-Bouët", 2000),
    ("Bingerville", "", 2000),
    ("Grand-Bassam", "", 2500),
    ("Bouaké", "", 3000),
    ("Yamoussoukro", "", 3000),
    ("Daloa", "", 3000),
    ("San-Pédro", "", 3500),
    ("Korhogo", "", 3500),
]
PAYMENT_METHODS = ["cash_on_delivery", "orange_money", "mtn_momo", "moov_money", "wave"]


def promised_hours(city):
    """24 h dans le Grand Abidjan, 48 h à Bingerville et Grand-Bassam, 72 h ailleurs (et pour un lieu inconnu)."""
    place = (city or "").strip().casefold()
    if place == "abidjan":
        return 24
    if place in {"bingerville", "grand-bassam"}:
        return 48
    return 72


def zone_key(city, commune=""):
    def clean(text):
        text = unicodedata.normalize("NFKD", text or "")
        text = "".join(char for char in text if not unicodedata.combining(char))
        return re.sub(r"[\s\-_'’]+", " ", text.casefold()).strip()

    return f"{clean(city)}|{clean(commune)}"


def forward(apps, schema_editor):
    Shop = apps.get_model("shops", "Shop")
    DeliveryZone = apps.get_model("shops", "DeliveryZone")
    ShopPaymentMethod = apps.get_model("shops", "ShopPaymentMethod")
    Order = apps.get_model("shops", "Order")

    with_zones = set(DeliveryZone.objects.values_list("shop_id", flat=True).distinct())
    with_methods = set(ShopPaymentMethod.objects.values_list("shop_id", flat=True).distinct())
    zones, methods = [], []
    for shop_id in Shop.objects.values_list("pk", flat=True).iterator():
        if shop_id not in with_zones:
            zones.extend(
                DeliveryZone(
                    shop_id=shop_id, city=city, commune=commune, key=zone_key(city, commune), fee=fee,
                    delay_hours=promised_hours(city), is_active=True, position=position,
                )
                for position, (city, commune, fee) in enumerate(ZONES)
            )
        if shop_id not in with_methods:
            # Les boutiques existantes continuent d'accepter les 5 moyens, sans numéro.
            methods.extend(ShopPaymentMethod(shop_id=shop_id, method=method, enabled=True) for method in PAYMENT_METHODS)
    DeliveryZone.objects.bulk_create(zones, batch_size=500)
    ShopPaymentMethod.objects.bulk_create(methods, batch_size=500)

    # Le délai promis de chaque commande est figé avec l'ancienne règle : une mise à jour par ville distincte.
    for city in list(Order.objects.filter(promised_hours__isnull=True).values_list("customer_city", flat=True).distinct()):
        Order.objects.filter(promised_hours__isnull=True, customer_city=city).update(promised_hours=promised_hours(city))


class Migration(migrations.Migration):

    dependencies = [
        ("shops", "0009_paiements_livraison"),
    ]

    operations = [
        migrations.RunPython(forward, migrations.RunPython.noop),
    ]
