import re
import uuid
from datetime import timedelta

from django.utils import timezone

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_shop, without_request_id
from shops.models import REFERENCE_ALPHABET, Customer, Discount, Membership, Order, Product

PHONE = "+2250707123456"
SHOP = "/api/v1/shops/maison-test"
STOREFRONT = "/api/v1/storefront/maison-test"


def reauth(client, password="pirogue-lagune-mangue"):
    return client.post("/api/v1/auth/reauth", {"password": password})


def in_days(days):
    return (timezone.localdate() + timedelta(days=days)).isoformat()


class DiscountTestCase(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test", "Maison Test")
        self.owner = make_member("owner@example.ci", self.shop, "owner", first_name="Adjoua", last_name="Konan")
        self.manager = make_member("fatou@example.ci", self.shop, "manager", first_name="Fatou", last_name="Diallo")
        self.seller = make_member("koffi@example.ci", self.shop, "seller", first_name="Koffi", last_name="Yao")
        self.customer = Customer.objects.create(shop=self.shop, phone=PHONE, name="Aya Koné")
        self.karite = Product.objects.create(shop=self.shop, sku="KAR", slug="karite", name="Beurre de karité", price=2500, stock=10)
        self.url = f"{SHOP}/customers/{self.customer.public_id}/discounts"

    def as_member(self, user, confirm=True):
        self.authenticate(user)
        if confirm:
            reauth(self.client)

    def give(self, **body):
        return self.client.post(self.url, {"kind": "percent", "value": 15, "ends_on": in_days(30), **body})

    def grant(self, cap=15):
        Membership.objects.filter(user=self.manager).update(grants=["discounts.give"], discount_cap_percent=cap)

    def discount(self, customer=None, **fields):
        values = {"kind": "percent", "value": 15, "ends_on": timezone.localdate() + timedelta(days=30), "code": "AYA-7K2Q"}
        values.update(fields)
        return Discount.objects.create(shop=self.shop, customer=customer or self.customer, **values)


class GivingTests(DiscountTestCase):
    def test_owner_gives_a_percent_or_an_amount(self):
        self.as_member(self.owner)
        response = self.give(value=50)
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertRegex(body["code"], r"^AYA-[A-Z0-9]{4}$")
        self.assertTrue(all(ch in REFERENCE_ALPHABET for ch in body["code"][4:]))
        self.assertEqual((body["label"], body["status"], body["customer"]["phone"]), ("−50 %", "active", PHONE))
        self.assertEqual(self.give(kind="amount", value=5000).status_code, 201)

        event = AuditEvent.objects.filter(action="discount_created").order_by("id").first()
        self.assertEqual(event.target_label, Discount.objects.order_by("created_at").first().code)
        self.assertEqual(event.metadata["customer"], "Aya Koné")

    def test_giving_needs_a_fresh_confirmation(self):
        self.as_member(self.owner, confirm=False)
        self.assertProblem(self.give(), 403, "reauth_required")
        self.assertFalse(Discount.objects.exists())

    def test_manager_needs_the_grant_and_stays_under_the_cap(self):
        self.as_member(self.manager)
        self.assertProblem(self.give(), 403, "permission_denied")
        self.grant(cap=15)
        self.assertEqual(self.give(value=15).status_code, 201)
        over = self.give(value=16)
        self.assertProblem(over, 403, "discount_cap_exceeded")
        self.assertEqual(over.json()["limit"], 15)
        self.assertProblem(self.give(kind="amount", value=1000), 403, "discount_kind_forbidden")

    def test_limits_are_checked_before_the_confirmation(self):
        self.grant(cap=10)
        self.as_member(self.manager, confirm=False)
        self.assertProblem(self.give(value=40), 403, "discount_cap_exceeded")

    def test_seller_never_gives_even_with_stray_grants(self):
        Membership.objects.filter(user=self.seller).update(grants=["discounts.give"], discount_cap_percent=50)
        self.as_member(self.seller)
        self.assertProblem(self.give(), 403, "permission_denied")

    def test_a_withdrawn_grant_applies_to_the_next_request(self):
        self.grant()
        self.as_member(self.manager)
        self.assertEqual(self.give().status_code, 201)
        Membership.objects.filter(user=self.manager).update(grants=[], discount_cap_percent=None)
        self.assertProblem(self.give(), 403, "permission_denied")

    def test_customer_of_another_shop_is_not_found(self):
        other = make_shop("comptoir-voisin")
        stranger = Customer.objects.create(shop=other, phone="+2250505050505", name="Ibrahim")
        self.as_member(self.owner)
        url = f"{SHOP}/customers/{stranger.public_id}/discounts"
        self.assertProblem(self.client.post(url, {"kind": "percent", "value": 10, "ends_on": in_days(5)}), 404, "not_found")
        outsider = make_member("autre@example.ci", other, "owner")
        self.as_member(outsider)
        self.assertProblem(self.give(), 404, "not_found")

    def test_values_are_bounded(self):
        self.as_member(self.owner)
        for body in ({"value": 91}, {"kind": "amount", "value": 50}, {"ends_on": in_days(-1)}, {"ends_on": in_days(400)}, {"max_uses": 11}):
            self.assertProblem(self.give(**body), 400, "validation_error")
        self.assertFalse(Discount.objects.exists())


class RevokingTests(DiscountTestCase):
    def test_owner_revokes_any_and_a_manager_only_their_own(self):
        self.grant()
        mine = self.discount(code="AYA-2222", created_by=self.manager)
        theirs = self.discount(code="AYA-3333", created_by=self.owner)
        self.as_member(self.manager, confirm=False)
        self.assertProblem(self.client.delete(f"{SHOP}/discounts/{theirs.pk}"), 403, "permission_denied")
        self.assertEqual(self.client.delete(f"{SHOP}/discounts/{mine.pk}").json()["status"], "revoked")

        self.as_member(self.owner, confirm=False)
        self.assertEqual(self.client.delete(f"{SHOP}/discounts/{theirs.pk}").status_code, 200)
        self.assertEqual(self.client.delete(f"{SHOP}/discounts/{theirs.pk}").json()["status"], "revoked")
        self.assertEqual(AuditEvent.objects.filter(action="discount_revoked").count(), 2)

    def test_discount_of_another_shop_is_not_found(self):
        other = make_shop("comptoir-voisin")
        stranger = Customer.objects.create(shop=other, phone="+2250505050505", name="Ibrahim")
        foreign = Discount.objects.create(shop=other, customer=stranger, code="IBR-2222", kind="percent", value=10, ends_on=timezone.localdate())
        self.as_member(self.owner, confirm=False)
        self.assertProblem(self.client.delete(f"{SHOP}/discounts/{foreign.pk}"), 404, "not_found")


class CapSettingTests(DiscountTestCase):
    def patch(self, **body):
        return self.client.patch(f"{SHOP}/members/{self.manager.pk}", body)

    def test_the_grant_needs_a_cap_and_losing_it_clears_the_cap(self):
        self.as_member(self.owner)
        self.assertProblem(self.patch(grants=["discounts.give"]), 400, "validation_error")
        body = self.patch(grants=["discounts.give"], discount_cap_percent=20).json()
        self.assertEqual((body["grants"], body["discount_cap_percent"]), (["discounts.give"], 20))
        self.assertEqual(self.patch(discount_cap_percent=25).json()["discount_cap_percent"], 25)
        self.assertProblem(self.patch(discount_cap_percent=95), 400, "validation_error")
        self.assertIsNone(self.patch(grants=[]).json()["discount_cap_percent"])

        changes = [e.metadata.get("discount_cap_percent") for e in AuditEvent.objects.filter(action="member_grants_changed").order_by("id")]
        self.assertEqual(changes, [{"previous": None, "new": 20}, {"previous": 20, "new": 25}, {"previous": 25, "new": None}])

    def test_the_manager_reads_their_cap_in_my_shops(self):
        self.grant(cap=12)
        self.as_member(self.manager, confirm=False)
        shop = self.client.get("/api/v1/me/shops").json()[0]
        self.assertEqual(shop["discount_cap_percent"], 12)
        self.assertIn("discounts.give", shop["permissions"])


class CustomerDetailTests(DiscountTestCase):
    def test_detail_lists_discounts_active_first_and_masks_codes_without_the_grant(self):
        today = timezone.localdate()
        self.discount(code="AYA-2222", uses=1)
        self.discount(code="AYA-3333", ends_on=today - timedelta(days=1))
        self.discount(code="AYA-4444", revoked_at=timezone.now())
        self.discount(code="AYA-5555")

        self.as_member(self.owner, confirm=False)
        listed = self.client.get(f"{SHOP}/customers/{self.customer.public_id}").json()["discounts"]
        self.assertEqual([(d["code"], d["status"]) for d in listed][0], ("AYA-5555", "active"))
        self.assertEqual(sorted(d["status"] for d in listed), ["active", "expired", "revoked", "used"])

        self.as_member(self.manager, confirm=False)
        listed = self.client.get(f"{SHOP}/customers/{self.customer.public_id}").json()["discounts"]
        self.assertEqual({d["code"] for d in listed}, {"AYA-••••"})
        self.assertFalse(any(d["can_revoke"] for d in listed))


class StorefrontTests(DiscountTestCase):
    def order_body(self, **overrides):
        body = {
            "items": [{"product_id": str(self.karite.pk), "quantity": 2}],
            "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody", "landmark": ""},
            "payment_method": "wave",
            "expected_total": 5000 - 750 + 1500,
            "discount_code": "aya 7k2q",
        }
        body.update(overrides)
        return body

    def order(self, body=None, key=None):
        return self.client.post(f"{STOREFRONT}/orders", body or self.order_body(), HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4()))

    def check(self, code="aya-7k2q", phone="07 07 12 34 56"):
        return self.client.post(f"{STOREFRONT}/discounts/check", {"code": code, "phone": phone, "items": [{"product_id": str(self.karite.pk), "quantity": 2}]})

    def test_check_gives_the_amount_before_ordering(self):
        self.discount()
        body = self.check().json()
        self.assertEqual((body["code"], body["subtotal"], body["discount_amount"]), ("AYA-7K2Q", 5000, 750))

    def test_every_refusal_looks_the_same(self):
        other = Customer.objects.create(shop=self.shop, phone="+2250505050505", name="Ibrahim")
        today = timezone.localdate()
        self.discount(code="AYA-2222", ends_on=today - timedelta(days=1))
        self.discount(code="AYA-3333", uses=1)
        self.discount(code="AYA-4444", revoked_at=timezone.now())
        self.discount(code="IBR-5555", customer=other)
        answers = [self.check(code) for code in ("AYA-9999", "AYA-2222", "AYA-3333", "AYA-4444", "IBR-5555", "n'importe")]
        for answer in answers:
            self.assertProblem(answer, 400, "discount_invalid")
        self.assertEqual(len({str(without_request_id(answer)) for answer in answers}), 1)

    def test_guessing_is_rate_limited_per_code_and_shared_with_orders(self):
        self.discount()
        for _ in range(4):
            self.check()
        self.assertEqual(self.order().status_code, 201)  # 5e essai sur ce code : la commande
        self.assertProblem(self.check(), 429, "too_many_requests")

    def test_guessing_is_rate_limited_per_ip(self):
        for index in range(20):
            self.check(code=f"AYA-{REFERENCE_ALPHABET[index]}{REFERENCE_ALPHABET[index]}22")
        self.assertProblem(self.check(code="AYA-2345"), 429, "too_many_requests")

    def test_order_with_a_code_pays_the_reduced_total_and_uses_it_once(self):
        discount = self.discount()
        response = self.order()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual((response.json()["total"], response.json()["discount_amount"]), (5750, 750))
        order = Order.objects.get()
        self.assertEqual((order.discount_code, order.discount_amount, order.subtotal, order.total), ("AYA-7K2Q", 750, 5000, 5750))
        discount.refresh_from_db()
        self.assertEqual(discount.uses, 1)
        event = AuditEvent.objects.get(action="order_placed")
        self.assertEqual((event.metadata["discount_amount"], event.metadata["channel"]), (750, "direct"))

        again = self.order()
        self.assertProblem(again, 400, "discount_invalid")
        self.assertEqual(Order.objects.count(), 1)
        self.karite.refresh_from_db()
        self.assertEqual(self.karite.stock, 8)

    def test_amount_never_exceeds_the_subtotal(self):
        self.discount(kind="amount", value=20000)
        self.assertEqual(self.order(self.order_body(expected_total=1500)).json()["total"], 1500)

    def test_a_total_without_the_discount_is_a_price_change(self):
        self.discount()
        response = self.order(self.order_body(expected_total=6500))
        self.assertProblem(response, 409, "price_changed")
        self.assertEqual((response.json()["discount_amount"], response.json()["total"]), (750, 5750))
        self.assertEqual(Discount.objects.get().uses, 0)

    def test_same_idempotency_key_with_another_code_is_a_conflict(self):
        self.discount()
        key = uuid.uuid4()
        self.assertEqual(self.order(key=key).status_code, 201)
        replay = self.order(key=key)
        self.assertEqual(replay.status_code, 201)
        self.assertEqual(Discount.objects.get().uses, 1)  # rejouer ne décompte pas une seconde fois
        conflict = self.order(self.order_body(discount_code="", expected_total=6500), key=key)
        self.assertProblem(conflict, 409, "idempotency_conflict")

    def test_channel_is_a_closed_list(self):
        for sent, kept in (("", "direct"), ("Instagram", "instagram"), ("<script>", "autre"), ("tiktok", "tiktok")):
            body = self.order_body(discount_code="", expected_total=6500, channel=sent)
            self.assertEqual(self.order(body).status_code, 201)
            self.assertEqual(Order.objects.order_by("-created_at").first().channel, kept)

    def test_tracking_shows_the_discount_but_not_the_code(self):
        self.discount()
        reference = self.order().json()["reference"]
        body = self.client.post(f"{STOREFRONT}/track", {"reference": reference, "phone_last4": "3456"}).json()
        self.assertEqual((body["subtotal"], body["discount_amount"], body["delivery_fee"], body["total"]), (5000, 750, 1500, 5750))
        self.assertNotIn("AYA-7K2Q", str(body))


class MerchantViewsTests(DiscountTestCase):
    def setUp(self):
        super().setUp()
        self.discount()
        self.client.post(
            f"{STOREFRONT}/orders",
            {
                "items": [{"product_id": str(self.karite.pk), "quantity": 2}],
                "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody", "landmark": ""},
                "payment_method": "wave",
                "expected_total": 5750,
                "discount_code": "AYA-7K2Q",
                "channel": "whatsapp",
            },
            HTTP_IDEMPOTENCY_KEY=str(uuid.uuid4()),
        )

    def test_order_export_and_dashboard_show_discount_and_channel(self):
        self.as_member(self.owner)
        order = self.client.get(f"{SHOP}/orders").json()["results"][0]
        self.assertEqual((order["discount_code"], order["discount_amount"], order["channel"]), ("AYA-7K2Q", 750, "whatsapp"))

        today = timezone.localdate().isoformat()
        csv = self.client.get(f"{SHOP}/orders/export?from={today}&to={today}").content.decode("utf-8-sig")
        header, row = csv.splitlines()[:2]
        self.assertIn("Remise (F);Livraison (F);Total (F);Code de réduction;Canal", header)
        self.assertTrue(re.search(r";750;1500;5750;AYA-7K2Q;WhatsApp$", row), row)

        channels = self.client.get(f"{SHOP}/dashboard?period=7d").json()["channels"]
        self.assertEqual(channels, [{"channel": "whatsapp", "orders": 1, "revenue": 5750}])
