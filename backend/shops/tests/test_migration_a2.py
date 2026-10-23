"""
Reprise des données du chantier A2 : la migration 0008 → 0010 ne doit rien changer pour une boutique existante
(docs/chantier-a2-paiements-livraison.md §1.5).
"""

from datetime import timedelta

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase
from django.utils import timezone

OLD = [("shops", "0008_versions_vitrine")]
NEW = [("shops", "0010_reprise_paiements_livraison")]

# Le catalogue d'avant : ces 15 zones, dans cet ordre, avec ces frais (recopiés de l'ancien delivery.ZONES).
OLD_ZONES = [
    ("Abidjan", "Cocody", 1500, 24), ("Abidjan", "Yopougon", 1500, 24), ("Abidjan", "Marcory", 1500, 24),
    ("Abidjan", "Abobo", 1500, 24), ("Abidjan", "Plateau", 1500, 24), ("Abidjan", "Treichville", 1500, 24),
    ("Abidjan", "Koumassi", 1500, 24), ("Abidjan", "Port-Bouët", 2000, 24), ("Bingerville", "", 2000, 48),
    ("Grand-Bassam", "", 2500, 48), ("Bouaké", "", 3000, 72), ("Yamoussoukro", "", 3000, 72),
    ("Daloa", "", 3000, 72), ("San-Pédro", "", 3500, 72), ("Korhogo", "", 3500, 72),
]


def migrate(targets):
    executor = MigrationExecutor(connection)
    executor.migrate(targets)
    return executor.loader.project_state(targets).apps


class ReprisePaiementsLivraisonTests(TransactionTestCase):
    def tearDown(self):
        migrate(MigrationExecutor(connection).loader.graph.leaf_nodes())  # remet la base à jour pour les tests suivants

    def old_world(self):
        apps = migrate(OLD)
        Shop, Order = apps.get_model("shops", "Shop"), apps.get_model("shops", "Order")
        shops = [Shop.objects.create(slug=slug, name=slug) for slug in ("boutique-a", "boutique-b")]
        now = timezone.now()
        for shop in shops:
            for city, commune, fee in (("Abidjan", "Cocody", 1500), ("Bouaké", "", 3000), ("Bingerville", "", 2000), ("Ville Inconnue", "", 0)):
                Order.objects.create(
                    shop=shop, reference=f"{city[:3].upper()}-{commune[:3].upper() or 'XXX'}"[:7], payment_method="wave",
                    customer_name="Aya", customer_phone="+2250707000001", customer_city=city, customer_commune=commune,
                    subtotal=5000, delivery_fee=fee, total=5000 + fee, created_at=now - timedelta(days=3),
                    delivered_at=now - timedelta(days=2),
                )
        return shops

    def test_every_shop_gets_the_same_fifteen_zones_five_methods_and_frozen_delays(self):
        self.old_world()
        apps = migrate(NEW)
        DeliveryZone, Method, Order = (apps.get_model("shops", n) for n in ("DeliveryZone", "ShopPaymentMethod", "Order"))
        for shop in apps.get_model("shops", "Shop").objects.all():
            zones = [(z.city, z.commune, z.fee, z.delay_hours) for z in DeliveryZone.objects.filter(shop=shop).order_by("position")]
            self.assertEqual(zones, OLD_ZONES)
            self.assertTrue(all(z.is_active for z in DeliveryZone.objects.filter(shop=shop)))
            self.assertEqual(sorted(DeliveryZone.objects.filter(shop=shop).values_list("position", flat=True)), list(range(15)))
            methods = {m.method: m for m in Method.objects.filter(shop=shop)}
            self.assertEqual(set(methods), {"cash_on_delivery", "orange_money", "mtn_momo", "moov_money", "wave"})
            self.assertTrue(all(m.enabled and not m.payout_number and not m.payout_name and not m.had_number for m in methods.values()))
        hours = {(o.customer_city): (o.fulfillment, o.promised_hours) for o in Order.objects.all()}
        self.assertEqual(hours, {"Abidjan": ("delivery", 24), "Bouaké": ("delivery", 72), "Bingerville": ("delivery", 48), "Ville Inconnue": ("delivery", 72)})

    def test_the_storefront_and_the_on_time_rate_are_the_same_before_and_after(self):
        from core.testing import BffClient
        from shops.dashboard import _on_time
        from shops.models import Order

        self.old_world()
        # Avant : la vitrine lisait la liste figée dans le code, le tableau de bord l'ancienne règle des villes.
        from shops.delivery import DEFAULT_ZONES, promised_hours

        before_zones = [{"id": z.id, "city": z.city, "commune": z.commune, "label": z.label, "fee": z.fee, "delay_hours": promised_hours(z.city)} for z in DEFAULT_ZONES]
        before_rate = {"measured": 8, "on_time": 8}  # 1 jour de livraison pour 24 h, 48 h ou 72 h promises
        migrate(NEW)
        for slug in ("boutique-a", "boutique-b"):
            self.assertEqual(BffClient().get(f"/api/v1/storefront/{slug}").json()["delivery_zones"], before_zones)
            methods = BffClient().get(f"/api/v1/storefront/{slug}").json()["payment_methods"]
            self.assertEqual([m["id"] for m in methods], ["cash_on_delivery", "orange_money", "mtn_momo", "moov_money", "wave"])
        rate = _on_time(Order.objects.all())
        self.assertEqual((rate["measured"], rate["on_time"]), (before_rate["measured"], before_rate["on_time"]))

    def test_the_same_cart_gives_the_same_total_after_the_migration(self):
        import uuid

        from shops.checkout import place_order
        from shops.models import Product, Shop

        self.old_world()
        migrate(NEW)
        shop = Shop.objects.get(slug="boutique-a")
        karite = Product.objects.create(shop=shop, sku="KAR", slug="karite", name="Karité", price=2500, stock=5)
        # Directement par le service : le journal est en ajout seul, et un test qui l'alimente ne peut plus vider la base.
        response, order = place_order(
            shop,
            {
                "items": [{"product_id": str(karite.pk), "quantity": 2}],
                "customer": {"name": "Aya Koné", "phone": "+2250707123456", "city": "Abidjan", "commune": "Cocody", "landmark": ""},
                "payment_method": "wave",
                "fulfillment": "delivery",
                "expected_total": 2 * 2500 + 1500,
                "discount_code": "",
                "channel": "direct",
            },
            uuid.uuid4(),
        )
        self.assertEqual((response["total"], order.delivery_fee, order.promised_hours), (6500, 1500, 24))

    def test_the_migration_replayed_duplicates_nothing(self):
        from importlib import import_module

        self.old_world()
        apps = migrate(NEW)
        forward = import_module("shops.migrations.0010_reprise_paiements_livraison").forward
        forward(apps, None)
        forward(apps, None)
        self.assertEqual(apps.get_model("shops", "DeliveryZone").objects.count(), 30)
        self.assertEqual(apps.get_model("shops", "ShopPaymentMethod").objects.count(), 10)

    def test_it_goes_back_without_losing_the_old_data(self):
        self.old_world()
        migrate(NEW)
        apps = migrate(OLD)
        self.assertEqual(apps.get_model("shops", "Order").objects.count(), 8)

    def test_the_starting_zones_fit_in_every_plan(self):
        from shops.plans import PLANS

        self.assertTrue(all(plan.delivery_zones >= 15 for plan in PLANS.values()))
