from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_shop
from shops.models import Membership


def reauth(client, password="pirogue-lagune-mangue"):
    return client.post("/api/v1/auth/reauth", {"password": password})


class ManagerGrantTests(ApiTestCase):
    """Droits du gérant (docs/chantier-p4.md §A) : ceux de son rôle, plus ceux que le propriétaire lui confie."""

    def setUp(self):
        self.shop = make_shop("maison-test")
        self.shop.plan = "business"
        self.shop.save()
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.manager = make_member("manager@example.ci", self.shop, "manager")
        self.other_manager = make_member("manager2@example.ci", self.shop, "manager")
        self.seller = make_member("seller@example.ci", self.shop, "seller")
        self.members = "/api/v1/shops/maison-test/members"
        self.new_seller = {"email": "awa@example.ci", "first_name": "Awa", "last_name": "Koné", "role": "seller"}

    def grant(self, *codes, to=None):
        self.authenticate(self.owner)
        reauth(self.client)
        target = to or self.manager
        return self.client.patch(f"{self.members}/{target.pk}", {"grants": list(codes)})

    def test_manager_without_the_grant_cannot_manage_sellers(self):
        self.authenticate(self.manager)
        reauth(self.client)
        self.assertProblem(self.client.post(self.members, self.new_seller), 403, "permission_denied")
        self.assertProblem(self.client.delete(f"{self.members}/{self.seller.pk}"), 403, "permission_denied")

    def test_granted_manager_adds_and_removes_sellers_only(self):
        self.assertEqual(self.grant("team.manage_sellers").status_code, 200)
        self.authenticate(self.manager)
        reauth(self.client)
        self.assertEqual(self.client.post(self.members, self.new_seller).status_code, 201)
        self.assertProblem(self.client.post(self.members, {**self.new_seller, "email": "x@example.ci", "role": "manager"}), 403, "permission_denied")
        self.assertProblem(self.client.delete(f"{self.members}/{self.other_manager.pk}"), 403, "permission_denied")
        self.assertProblem(self.client.delete(f"{self.members}/{self.owner.pk}"), 403, "permission_denied")
        self.assertEqual(self.client.delete(f"{self.members}/{self.seller.pk}").status_code, 204)

    def test_manager_cannot_grant_himself_anything_nor_change_a_role(self):
        self.grant("team.manage_sellers")
        self.authenticate(self.manager)
        reauth(self.client)
        self.assertProblem(self.client.patch(f"{self.members}/{self.manager.pk}", {"grants": ["team.presence"]}), 403, "permission_denied")
        self.assertProblem(self.client.patch(f"{self.members}/{self.seller.pk}", {"role": "manager"}), 403, "permission_denied")

    def test_only_grantable_codes_and_only_for_managers(self):
        for code in ("shop.manage", "goals.manage", "customers.vip", "inconnu"):
            with self.subTest(code=code):
                response = self.grant(code)
                self.assertProblem(response, 400, "validation_error")
                self.assertIn("grants", response.json()["errors"])
        self.assertProblem(self.grant("team.presence", to=self.seller), 400, "validation_error")

    def test_grants_need_a_fresh_confirmation_and_are_logged(self):
        self.authenticate(self.owner)
        response = self.client.patch(f"{self.members}/{self.manager.pk}", {"grants": ["team.presence"]})
        self.assertProblem(response, 403, "reauth_required")
        self.grant("team.presence")
        event = AuditEvent.objects.get(action="member_grants_changed")
        self.assertEqual((event.metadata["added"], event.metadata["removed"]), (["team.presence"], []))

    def test_a_removed_grant_stops_at_the_next_request(self):
        self.grant("team.presence")
        self.authenticate(self.manager)
        self.assertEqual(self.client.get("/api/v1/shops/maison-test/team/presence").status_code, 200)
        self.grant()
        self.authenticate(self.manager)
        self.assertProblem(self.client.get("/api/v1/shops/maison-test/team/presence"), 403, "permission_denied")

    def test_back_to_seller_drops_the_grants_and_me_shops_lists_effective_rights(self):
        self.grant("team.presence", "storefront.edit")
        self.authenticate(self.manager)
        [shop] = self.client.get("/api/v1/me/shops").json()
        self.assertIn("team.presence", shop["permissions"])
        self.assertEqual(shop["grants"], ["storefront.edit", "team.presence"])

        self.authenticate(self.owner)
        reauth(self.client)
        self.client.patch(f"{self.members}/{self.manager.pk}", {"role": "seller"})
        self.assertEqual(Membership.objects.get(user=self.manager).grants, [])


class PresenceTests(ApiTestCase):
    def test_owner_sees_who_came_today_without_ip_or_device(self):
        from core.testing import make_order

        shop = make_shop("maison-test")
        owner = make_member("owner@example.ci", shop, "owner")
        seller = make_member("seller@example.ci", shop, "seller")
        make_member("never@example.ci", shop, "seller")
        self.authenticate(seller)
        order = make_order(shop)
        self.client.patch(f"/api/v1/shops/maison-test/orders/{order.pk}", {"status": "confirmed"})

        self.authenticate(owner)
        people = {p["name"]: p for p in self.client.get("/api/v1/shops/maison-test/team/presence").json()}
        self.assertEqual((people["seller@example.ci"]["status"], people["seller@example.ci"]["handled_today"]), ("today", 1))
        self.assertEqual(people["never@example.ci"]["status"], "never")
        self.assertFalse({"ip", "device_label", "user_agent"} & set(people["seller@example.ci"]))

    def test_seller_cannot_see_presence(self):
        shop = make_shop("maison-test")
        self.authenticate(make_member("seller@example.ci", shop, "seller"))
        self.assertProblem(self.client.get("/api/v1/shops/maison-test/team/presence"), 403, "permission_denied")
