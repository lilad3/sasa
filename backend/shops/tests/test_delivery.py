"""Zones de livraison et retrait par boutique (docs/chantier-a2-paiements-livraison.md §1.2, §3.3 à §3.8, §4)."""

import uuid
from datetime import timedelta

from django.utils import timezone

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_order, make_shop
from shops.models import DeliveryZone, Order, Product

BASE = "/api/v1/shops/maison-test/delivery"
STORE = "/api/v1/storefront/maison-test"


def zone(shop, city, commune=""):
    return DeliveryZone.objects.get(shop=shop, city=city, commune=commune)


class DeliveryTestCase(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.manager = make_member("manager@example.ci", self.shop, "manager")
        self.seller = make_member("seller@example.ci", self.shop, "seller")
        self.other = make_shop("autre-boutique")
        self.stranger = make_member("stranger@example.ci", self.other, "owner")
        self.karite = Product.objects.create(shop=self.shop, sku="KAR", slug="karite", name="Karité", price=2500, stock=20)
        self.authenticate(self.owner)

    def public_order(self, shop_slug="maison-test", **overrides):
        body = {
            "items": [{"product_id": str(self.karite.pk), "quantity": 2}],
            "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody", "landmark": "Près de la pharmacie"},
            "payment_method": "cash_on_delivery",
        }
        body.update(overrides)
        saved = self.client._credentials
        self.client.credentials()
        try:
            return self.client.post(f"/api/v1/storefront/{shop_slug}/orders", body, format="json", HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()))
        finally:
            self.client.credentials(**saved)

    def patch(self, *changes):
        return self.client.patch(f"{BASE}/zones", {"zones": list(changes)}, format="json")


class DeliveryRightsTests(DeliveryTestCase):
    def test_only_the_owner_manages_delivery(self):
        owner_zone = zone(self.shop, "Abidjan", "Cocody")
        calls = [
            lambda: self.client.get(BASE),
            lambda: self.client.post(f"{BASE}/zones", {"city": "Man", "fee": 3000, "delay_hours": 72}, format="json"),
            lambda: self.patch({"id": str(owner_zone.pk), "fee": 1800}),
            lambda: self.client.delete(f"{BASE}/zones/{owner_zone.pk}"),
            lambda: self.client.put(f"{BASE}/zones/order", {"ids": []}, format="json"),
            lambda: self.client.put(f"{BASE}/pickup", {"enabled": False, "prep_hours": 2}, format="json"),
        ]
        for user, status in ((self.manager, 403), (self.seller, 403), (self.stranger, 404)):
            self.authenticate(user)
            for call in calls:
                self.assertEqual(call().status_code, status)
        self.assertEqual(zone(self.shop, "Abidjan", "Cocody").fee, 1500)
        self.assertFalse(DeliveryZone.objects.filter(city="Man").exists())

    def test_the_owner_reads_the_fifteen_starting_zones(self):
        data = self.client.get(BASE).json()
        self.assertEqual(len(data["zones"]), 15)
        self.assertEqual(data["summary"], "15 zones · dès 1 500 F")
        self.assertEqual(data["limits"]["zones"], 20)
        self.assertEqual([z["label"] for z in data["zones"]][:2], ["Cocody, Abidjan", "Yopougon, Abidjan"])
        self.assertTrue(all(not z["used"] for z in data["zones"]))


class IsolationTests(DeliveryTestCase):
    def test_a_fee_changed_in_one_shop_changes_nothing_in_another(self):
        other_product = Product.objects.create(shop=self.other, sku="KAR", slug="karite", name="Karité", price=2500, stock=20)
        self.assertEqual(self.patch({"id": str(zone(self.shop, "Abidjan", "Cocody").pk), "fee": 2000}).status_code, 200)
        mine = {z["id"]: z for z in self.client.get(STORE).json()["delivery_zones"]}
        theirs = {z["id"]: z for z in self.client.get("/api/v1/storefront/autre-boutique").json()["delivery_zones"]}
        self.assertEqual((mine["Abidjan|Cocody"]["fee"], theirs["Abidjan|Cocody"]["fee"]), (2000, 1500))
        # Le checkout de l'autre boutique garde 1 500 F.
        saved = self.public_order("autre-boutique", items=[{"product_id": str(other_product.pk), "quantity": 2}])
        self.assertEqual(saved.status_code, 201, saved.content)
        self.assertEqual(Order.objects.get(shop=self.other).delivery_fee, 1500)
        mine_order = self.public_order(expected_total=2 * 2500 + 2000)
        self.assertEqual(mine_order.status_code, 201, mine_order.content)

    def test_a_zone_added_in_one_shop_does_not_exist_in_another(self):
        self.client.post(f"{BASE}/zones", {"city": "Man", "fee": 3000, "delay_hours": 72}, format="json")
        self.assertTrue(DeliveryZone.objects.filter(shop=self.shop, city="Man").exists())
        self.assertFalse(DeliveryZone.objects.filter(shop=self.other, city="Man").exists())
        body = {"customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Man"}}
        other_product = Product.objects.create(shop=self.other, sku="KAR", slug="karite", name="Karité", price=2500, stock=20)
        response = self.public_order("autre-boutique", items=[{"product_id": str(other_product.pk), "quantity": 1}], **body)
        self.assertEqual(response.json()["errors"]["customer.city"][0]["code"], "delivery_unavailable")

    def test_a_zone_id_of_another_shop_is_a_404_and_nothing_is_applied(self):
        foreign = zone(self.other, "Abidjan", "Cocody")
        mine = zone(self.shop, "Abidjan", "Plateau")
        response = self.patch({"id": str(mine.pk), "fee": 1700}, {"id": str(foreign.pk), "fee": 9999})
        self.assertProblem(response, 404, "not_found")
        self.assertEqual(zone(self.shop, "Abidjan", "Plateau").fee, 1500)  # tout ou rien
        self.assertEqual(zone(self.other, "Abidjan", "Cocody").fee, 1500)
        self.assertProblem(self.client.delete(f"{BASE}/zones/{foreign.pk}"), 404, "not_found")
        self.assertTrue(DeliveryZone.objects.filter(pk=foreign.pk).exists())
        self.assertProblem(self.patch({"id": str(uuid.uuid4()), "fee": 1}), 404, "not_found")  # même réponse qu'un id inconnu
        self.assertProblem(
            self.client.put(f"{BASE}/zones/order", {"ids": [str(foreign.pk)] + [str(z.pk) for z in DeliveryZone.objects.filter(shop=self.shop)][1:]}, format="json"),
            400,
            "order_mismatch",
        )


class DisabledZoneTests(DeliveryTestCase):
    def test_a_disabled_zone_is_hidden_refused_by_a_direct_call_but_keeps_past_orders(self):
        first = self.public_order()
        self.assertEqual(first.status_code, 201, first.content)
        cocody = zone(self.shop, "Abidjan", "Cocody")
        self.assertEqual(self.patch({"id": str(cocody.pk), "is_active": False}).status_code, 200)
        self.assertNotIn("Abidjan|Cocody", [z["id"] for z in self.client.get(STORE).json()["delivery_zones"]])
        refused = self.public_order()
        self.assertEqual(refused.status_code, 400)
        self.assertEqual(refused.json()["errors"]["customer.city"][0]["code"], "delivery_unavailable")
        old = Order.objects.get()
        self.assertEqual((old.customer_commune, old.delivery_fee, old.total), ("Cocody", 1500, 6500))

    def test_a_changed_fee_does_not_touch_past_orders_and_a_stale_price_is_409(self):
        self.public_order()
        old_total = Order.objects.get().total
        self.patch({"id": str(zone(self.shop, "Abidjan", "Cocody").pk), "fee": 2500, "delay_hours": 12})
        order = Order.objects.get()
        self.assertEqual((order.delivery_fee, order.total, order.promised_hours), (1500, old_total, 24))
        stale = self.public_order(expected_total=old_total)
        self.assertProblem(stale, 409, "price_changed")
        self.assertEqual(stale.json()["delivery_fee"], 2500)

    def test_zone_lookup_tolerates_case_and_accents_but_only_active_zones_of_the_shop(self):
        self.assertEqual(self.public_order(customer={"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "bouake"}).status_code, 201)
        self.assertEqual(Order.objects.get().customer_city, "Bouaké")
        self.assertEqual(self.public_order(customer={"name": "Aya Koné", "phone": "07 07 12 34 56", "city": ""}).status_code, 400)


class PickupTests(DeliveryTestCase):
    def enable(self, **extra):
        body = {"enabled": True, "address": "Rue des Jardins, Cocody", "hours": "Lun-Sam, 9 h-18 h", "prep_hours": 2, **extra}
        return self.client.put(f"{BASE}/pickup", body, format="json")

    def test_pickup_has_no_fee_no_place_and_no_promised_hours(self):
        self.assertProblem(self.public_order(fulfillment="pickup"), 400, "pickup_unavailable")
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(self.enable().status_code, 200)
        shop = self.client.get(STORE).json()
        self.assertEqual(shop["pickup"], {"address": "Rue des Jardins, Cocody", "hours": "Lun-Sam, 9 h-18 h", "prep_hours": 2})
        response = self.public_order(fulfillment="pickup", expected_total=5000)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json()["fulfillment"], "pickup")
        order = Order.objects.get()
        self.assertEqual((order.fulfillment, order.delivery_fee, order.total, order.promised_hours), ("pickup", 0, 5000, None))
        self.assertEqual((order.customer_city, order.customer_commune, order.customer_landmark), ("", "", ""))
        track = self.client.post(f"{STORE}/track", {"reference": order.reference, "phone_last4": "3456"}, format="json").json()
        self.assertEqual(track["fulfillment"], "pickup")
        self.assertEqual(track["pickup"]["prep_hours"], 2)
        self.assertEqual(track["delivery_fee"], 0)

    def test_a_city_sent_with_a_pickup_is_ignored_and_does_not_change_the_idempotency_fingerprint(self):
        self.enable()
        key = uuid.uuid4()
        self.client.credentials()
        base = {
            "items": [{"product_id": str(self.karite.pk), "quantity": 1}],
            "payment_method": "cash_on_delivery",
            "fulfillment": "pickup",
        }
        one = self.client.post(f"{STORE}/orders", {**base, "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody"}}, format="json", HTTP_IDEMPOTENCY_KEY=str(key))
        two = self.client.post(f"{STORE}/orders", {**base, "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Korhogo"}}, format="json", HTTP_IDEMPOTENCY_KEY=str(key))
        self.assertEqual((one.status_code, two.status_code), (201, 201))
        self.assertEqual(one.json()["reference"], two.json()["reference"])
        self.assertEqual(Order.objects.count(), 1)

    def test_delivery_is_the_default_and_unknown_modes_are_refused(self):
        self.assertEqual(self.public_order().status_code, 201)
        self.assertEqual(Order.objects.get().fulfillment, "delivery")
        self.assertProblem(self.public_order(fulfillment="drone"), 400, "validation_error")

    def test_pickup_validation_and_the_last_option_rule(self):
        self.assertEqual(self.enable(address="").json()["errors"]["address"][0]["code"], "pickup_address_required")
        self.assertEqual(self.enable(address="<b>x</b>").status_code, 400)
        self.assertEqual(self.enable(prep_hours=0).json()["errors"]["prep_hours"][0]["code"], "prep_out_of_range")
        self.assertEqual(self.enable(prep_hours=169).status_code, 400)
        self.assertEqual(self.enable().status_code, 200)
        # Le retrait ne ferme pas la boutique : sans zone active, on ne peut pas l'éteindre.
        DeliveryZone.objects.filter(shop=self.shop).update(is_active=False)
        off = self.client.put(f"{BASE}/pickup", {"enabled": False, "prep_hours": 2}, format="json")
        self.assertProblem(off, 409, "no_fulfillment_option")
        self.assertTrue(self.client.get(BASE).json()["pickup"]["enabled"])

    def test_pickup_is_journaled_once_and_orders_show_the_mode_everywhere(self):
        self.enable()
        self.enable()  # sans changement : pas de second événement
        events = AuditEvent.objects.filter(action="delivery_settings_changed")
        self.assertEqual(events.count(), 1)
        self.assertEqual(events.get().metadata, {"change": "pickup_changed", "pickup_enabled": True})
        self.public_order(fulfillment="pickup")
        order_id = Order.objects.get().pk
        self.assertEqual(self.client.get(f"/api/v1/shops/maison-test/orders/{order_id}").json()["fulfillment"], "pickup")
        self.assertIsNone(self.client.get(f"/api/v1/shops/maison-test/orders/{order_id}").json()["promised_hours"])
        self.assertEqual(self.client.get("/api/v1/shops/maison-test/orders").json()["results"][0]["fulfillment"], "pickup")

    def test_the_public_api_and_the_csv_export_show_the_mode(self):
        self.enable()
        self.public_order(fulfillment="pickup")
        self.public_order()
        self.client.post("/api/v1/auth/reauth", {"password": "pirogue-lagune-mangue"})
        self.shop.plan = "pro"
        self.shop.save()
        key = self.client.post("/api/v1/shops/maison-test/api-keys", {"name": "Compta", "scopes": ["orders:read"]}, format="json").json()["key"]
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {key}")
        public = self.client.get("/api/public/v1/orders").json()["results"]
        self.assertEqual(sorted(order["fulfillment"] for order in public), ["delivery", "pickup"])
        self.authenticate(self.owner)
        self.client.post("/api/v1/auth/reauth", {"password": "pirogue-lagune-mangue"})
        csv = self.client.get("/api/v1/shops/maison-test/orders/export")
        self.assertEqual(csv.status_code, 200, csv.content)
        lines = csv.content.decode("utf-8-sig").splitlines()
        header = lines[0].split(";") if ";" in lines[0] else lines[0].split(",")
        self.assertEqual(header[2:4], ["Statut", "Mode"])
        self.assertEqual(sorted(line.split(";" if ";" in line else ",")[3] for line in lines[1:]), ["Livraison", "Retrait sur place"])

    def test_pickup_orders_do_not_count_as_late_deliveries_or_places(self):
        from shops.dashboard import _by_place, _on_time

        delivered = timezone.now() - timedelta(hours=1)
        make_order(self.shop, age=timedelta(hours=10), status="delivered", delivered_at=delivered)  # 9 h pour 24 h promises : à temps
        make_order(self.shop, age=timedelta(hours=400), status="delivered", delivered_at=delivered, phone="+2250707000002")  # en retard
        make_order(self.shop, age=timedelta(hours=400), status="delivered", delivered_at=delivered, fulfillment="pickup", customer_city="", customer_commune="", phone="+2250707000003")
        qs = Order.objects.for_shop(self.shop)
        self.assertEqual((_on_time(qs)["measured"], _on_time(qs)["on_time"]), (2, 1))
        self.assertEqual([p["city"] for p in _by_place(qs)], ["Abidjan"])

    def test_changing_a_delay_does_not_rewrite_history(self):
        from shops.dashboard import _on_time

        make_order(self.shop, age=timedelta(hours=20), status="delivered", delivered_at=timezone.now() - timedelta(hours=2))  # 18 h pour 24 h : à temps
        self.patch({"id": str(zone(self.shop, "Abidjan", "Cocody").pk), "delay_hours": 4})
        self.assertEqual(_on_time(Order.objects.for_shop(self.shop))["on_time"], 1)


class ZoneWriteTests(DeliveryTestCase):
    def add(self, **fields):
        return self.client.post(f"{BASE}/zones", {"city": "Man", "commune": "", "fee": 3000, "delay_hours": 72, **fields}, format="json")

    def test_a_zone_is_added_at_the_end_with_a_journal_line(self):
        response = self.add()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual((response.json()["position"], response.json()["label"], response.json()["is_active"]), (15, "Man", True))
        event = AuditEvent.objects.get(action="delivery_settings_changed")
        self.assertEqual((event.metadata["change"], event.metadata["zone"], event.metadata["fee"]), ("zone_added", "Man", 3000))
        self.assertEqual(event.category, "security")

    def test_duplicates_ignore_case_accents_and_hyphens(self):
        self.assertProblem(self.add(city="abidjan", commune="PORT BOUET"), 409, "zone_duplicate")
        self.assertProblem(self.add(city="  Bouake "), 409, "zone_duplicate")
        self.assertProblem(self.add(city="San Pedro"), 409, "zone_duplicate")
        self.assertEqual(self.add(city="Abidjan", commune="Anyama").status_code, 201)

    def test_texts_and_numbers_are_checked(self):
        self.assertEqual(self.add(city="<b>Man</b>").json()["errors"]["city"][0]["code"], "invalid_characters")
        self.assertEqual(self.add(city="---").status_code, 400)
        self.assertEqual(self.add(city="x" * 61).status_code, 400)
        for fee in (-1, 100_001, "1500", 1500.5, True, None):
            response = self.add(city=f"Ville {uuid.uuid4().hex[:4]}", fee=fee)
            self.assertEqual(response.status_code, 400, fee)
            self.assertEqual(response.json()["errors"]["fee"][0]["code"], "fee_out_of_range" if fee is not None else "null")
        for delay in (0, 241, "24"):
            response = self.add(city=f"V{delay}", delay_hours=delay)
            self.assertEqual(response.json()["errors"]["delay_hours"][0]["code"], "delay_out_of_range")
        self.assertEqual(self.add(city="Gratuite", fee=0, delay_hours=1).status_code, 201)
        self.assertEqual(self.add(city="Chère", fee=100_000, delay_hours=240).status_code, 201)

    def test_the_plan_caps_zones_inactive_ones_included(self):
        for n in range(5):
            self.assertEqual(self.add(city=f"Ville {n}", is_active=False).status_code, 201)
        refused = self.add(city="Une de trop")
        self.assertProblem(refused, 403, "plan_limit_reached")
        self.assertEqual(refused.json()["limit"], 20)
        self.assertIn("20 zones de livraison", refused.json()["detail"])
        self.shop.plan = "pro"
        self.shop.save()
        self.assertEqual(self.add(city="Une de plus").status_code, 201)

    def test_downgrading_is_blocked_while_there_are_too_many_zones(self):
        from shops.plans import downgrade_blockers

        self.shop.plan = "pro"
        self.shop.save()
        for n in range(10):
            DeliveryZone.objects.create(shop=self.shop, city=f"V{n}", key=f"v{n}|", fee=1000, delay_hours=48, position=20 + n)
        self.assertIn("25 zones de livraison pour 20 autorisées", downgrade_blockers(self.shop, "free"))

    def test_city_and_commune_cannot_be_modified(self):
        cocody = zone(self.shop, "Abidjan", "Cocody")
        for field in ("city", "commune", "position"):
            response = self.patch({"id": str(cocody.pk), field: "Autre" if field != "position" else 3})
            self.assertProblem(response, 400, "validation_error")
        self.assertEqual(zone(self.shop, "Abidjan", "Cocody").city, "Abidjan")

    def test_batch_update_is_atomic_journals_one_event_per_changed_zone_and_none_without_change(self):
        cocody, yop, plateau = (zone(self.shop, "Abidjan", c) for c in ("Cocody", "Yopougon", "Plateau"))
        response = self.patch(
            {"id": str(cocody.pk), "fee": 1800, "delay_hours": 30},
            {"id": str(yop.pk), "is_active": False},
            {"id": str(plateau.pk), "fee": 1500},  # inchangé
        )
        self.assertEqual(response.status_code, 200, response.content)
        events = {e.metadata["zone"]: e.metadata for e in AuditEvent.objects.filter(action="delivery_settings_changed")}
        self.assertEqual(set(events), {"Cocody, Abidjan", "Yopougon, Abidjan"})
        self.assertEqual(events["Cocody, Abidjan"], {"change": "zone_updated", "zone": "Cocody, Abidjan", "previous_fee": 1500, "fee": 1800, "previous_hours": 24, "hours": 30})
        self.assertEqual(events["Yopougon, Abidjan"]["change"], "zone_disabled")
        count = AuditEvent.objects.count()
        self.assertEqual(self.patch({"id": str(cocody.pk), "fee": 1800}).status_code, 200)
        self.assertEqual(AuditEvent.objects.count(), count)
        self.assertProblem(self.patch({"id": str(cocody.pk), "fee": 1}, {"id": str(cocody.pk), "fee": 2}), 400, "validation_error")
        self.assertProblem(self.patch({"id": str(cocody.pk), "fee": 200_000}), 400, "validation_error")
        self.assertEqual(zone(self.shop, "Abidjan", "Cocody").fee, 1800)

    def test_the_last_option_cannot_be_switched_off(self):
        DeliveryZone.objects.filter(shop=self.shop).exclude(city="Korhogo").update(is_active=False)
        korhogo = zone(self.shop, "Korhogo")
        self.assertProblem(self.patch({"id": str(korhogo.pk), "is_active": False}), 409, "no_fulfillment_option")
        self.assertTrue(zone(self.shop, "Korhogo").is_active)
        self.assertProblem(self.client.delete(f"{BASE}/zones/{korhogo.pk}"), 409, "no_fulfillment_option")

    def test_delete_only_a_zone_that_never_served(self):
        used = zone(self.shop, "Abidjan", "Cocody")
        self.public_order()
        listing = {z["label"]: z["used"] for z in self.client.get(BASE).json()["zones"]}
        self.assertTrue(listing["Cocody, Abidjan"])
        self.assertFalse(listing["Korhogo"])
        self.assertProblem(self.client.delete(f"{BASE}/zones/{used.pk}"), 409, "zone_in_use")
        free = zone(self.shop, "Korhogo")
        self.assertEqual(self.client.delete(f"{BASE}/zones/{free.pk}").status_code, 204)
        self.assertEqual(AuditEvent.objects.filter(metadata__change="zone_deleted").count(), 1)
        self.assertEqual(sorted(DeliveryZone.objects.filter(shop=self.shop).values_list("position", flat=True)), list(range(14)))

    def test_reordering_needs_exactly_the_shop_zones(self):
        ids = [str(z.pk) for z in DeliveryZone.objects.filter(shop=self.shop)]
        reverse = list(reversed(ids))
        response = self.client.put(f"{BASE}/zones/order", {"ids": reverse}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual([z["id"] for z in response.json()["zones"]], reverse)
        self.assertEqual(self.client.get(STORE).json()["delivery_zones"][0]["id"], "Korhogo")
        for bad in (ids[:-1], ids + ids[:1], ids[:-1] + [str(uuid.uuid4())]):
            self.assertProblem(self.client.put(f"{BASE}/zones/order", {"ids": bad}, format="json"), 400, "order_mismatch")
        self.assertEqual(AuditEvent.objects.filter(action="delivery_settings_changed").count(), 0)  # l'ordre n'est pas journalisé

    def test_the_summary_wording(self):
        DeliveryZone.objects.filter(shop=self.shop).exclude(city="Korhogo").update(is_active=False)
        self.assertEqual(self.client.get(BASE).json()["summary"], "1 zone · dès 3 500 F")
        DeliveryZone.objects.filter(shop=self.shop).update(is_active=False)
        self.assertEqual(self.client.get(BASE).json()["summary"], "Aucune livraison")
        self.client.put(f"{BASE}/pickup", {"enabled": True, "address": "Rue 1", "prep_hours": 3}, format="json")
        self.assertEqual(self.client.get(BASE).json()["summary"], "Retrait sur place")

    def test_writes_are_rate_limited_per_member(self):
        cocody = zone(self.shop, "Abidjan", "Cocody")
        for _ in range(60):
            self.assertEqual(self.patch({"id": str(cocody.pk), "fee": 1500}).status_code, 200)
        self.assertProblem(self.patch({"id": str(cocody.pk), "fee": 1500}), 429, "too_many_requests")
        self.assertEqual(self.client.get(BASE).status_code, 200)  # les lectures ne sont pas limitées

    def test_the_storefront_shape_is_unchanged_and_follows_position_and_activity(self):
        zones = self.client.get(STORE).json()["delivery_zones"]
        self.assertEqual(zones[0], {"id": "Abidjan|Cocody", "city": "Abidjan", "commune": "Cocody", "label": "Cocody, Abidjan", "fee": 1500, "delay_hours": 24})
        self.assertEqual(zones[8]["id"], "Bingerville")
        self.assertIsNone(self.client.get(STORE).json()["pickup"])


class DemoDataTests(DeliveryTestCase):
    def test_the_demo_uses_the_active_zones_and_methods_of_the_shop_and_writes_no_number(self):
        from shops.demo import generate_demo_data
        from shops.models import ShopPaymentMethod

        DeliveryZone.objects.filter(shop=self.shop).exclude(commune="Cocody").exclude(city="Korhogo").update(is_active=False)
        ShopPaymentMethod.objects.filter(shop=self.shop).exclude(method__in=["wave", "cash_on_delivery"]).update(enabled=False)
        self.shop.pickup_enabled, self.shop.pickup_address = True, "Rue 1"
        self.shop.save()
        generate_demo_data(self.shop)
        orders = Order.objects.for_shop(self.shop).filter(is_demo=True)
        self.assertGreater(orders.count(), 100)
        self.assertEqual({o.payment_method for o in orders}, {"wave", "cash_on_delivery"})
        delivery = orders.filter(fulfillment="delivery")
        self.assertEqual({(o.customer_city, o.customer_commune) for o in delivery}, {("Abidjan", "Cocody"), ("Korhogo", "")})
        self.assertTrue(all(o.promised_hours == (24 if o.customer_city == "Abidjan" else 72) for o in delivery))
        pickup = orders.filter(fulfillment="pickup")
        self.assertTrue(0.03 < pickup.count() / orders.count() < 0.2)
        self.assertTrue(all((o.delivery_fee, o.customer_city, o.promised_hours) == (0, "", None) for o in pickup))
        self.assertFalse(ShopPaymentMethod.objects.filter(shop=self.shop).exclude(payout_number="").exists())
