from datetime import timedelta

from django.utils import timezone

from accounts.models import User
from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_shop
from shops.models import Membership


def reauth(client, password="pirogue-lagune-mangue"):
    return client.post("/api/v1/auth/reauth", {"password": password})


class MemberTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.shop.plan = "pro"
        self.shop.save()
        self.owner = make_member("owner@example.ci", self.shop, "owner")
        self.url = "/api/v1/shops/maison-test/members"
        self.new_member = {"email": "Koffi@Example.ci", "first_name": "Koffi", "last_name": "Yao", "role": "seller"}

    def add_member(self):
        self.authenticate(self.owner)
        reauth(self.client)
        response = self.client.post(self.url, self.new_member)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_adding_someone_needs_a_fresh_confirmation(self):
        self.authenticate(self.owner)
        self.assertProblem(self.client.post(self.url, self.new_member), 403, "reauth_required")
        self.assertFalse(User.objects.filter(email="koffi@example.ci").exists())

    def test_temporary_password_only_allows_choosing_a_new_one(self):
        created = self.add_member()
        temporary = created["temporary_password"]
        self.assertTrue(created["member"]["pending"])
        self.assertTrue(AuditEvent.objects.filter(action="member_added", actor_id=self.owner.pk).exists())

        self.client.credentials()
        login = self.login("koffi@example.ci", temporary)
        self.assertEqual(login.status_code, 200, login.content)
        self.assertTrue(login.json()["user"]["must_change_password"])
        self.client.bearer(login.json()["access"])
        self.assertProblem(self.client.get("/api/v1/shops/maison-test/orders"), 403, "password_change_required")
        self.assertEqual(self.client.get("/api/v1/me").status_code, 200)

        changed = self.client.post("/api/v1/me/password", {"current_password": temporary, "password": "mangue-pirogue-lagune-2"})
        self.assertEqual(changed.status_code, 204, changed.content)
        self.assertEqual(self.client.get("/api/v1/shops/maison-test/orders").status_code, 200)

    def test_temporary_password_expires(self):
        created = self.add_member()
        User.objects.filter(email="koffi@example.ci").update(temporary_password_expires_at=timezone.now() - timedelta(minutes=1))
        self.client.credentials()
        self.assertProblem(self.login("koffi@example.ci", created["temporary_password"]), 401, "temporary_password_expired")

    def test_plan_limit_and_existing_accounts(self):
        self.shop.plan = "free"
        self.shop.save()
        self.authenticate(self.owner)
        reauth(self.client)
        self.assertProblem(self.client.post(self.url, self.new_member), 403, "plan_limit_reached")

        self.shop.plan = "pro"
        self.shop.save()
        make_shop("ailleurs")
        User.objects.create_user(email="koffi@example.ci", password="x" * 12)
        self.assertProblem(self.client.post(self.url, self.new_member), 409, "account_exists")

    def test_manager_cannot_add_people_and_owner_cannot_be_touched(self):
        manager = make_member("manager@example.ci", self.shop, "manager")
        self.authenticate(manager)
        self.assertProblem(self.client.post(self.url, self.new_member), 403, "permission_denied")

        self.authenticate(self.owner)
        reauth(self.client)
        self.assertProblem(self.client.delete(f"{self.url}/{self.owner.pk}"), 403, "permission_denied")

    def test_removing_the_last_shop_disables_the_account_and_its_sessions(self):
        created = self.add_member()
        user_id = created["member"]["user_id"]
        self.assertEqual(self.client.delete(f"{self.url}/{user_id}").status_code, 204)
        user = User.objects.get(pk=user_id)
        self.assertFalse(user.is_active)
        self.assertFalse(Membership.objects.filter(user=user).exists())

    def test_seller_sees_the_team_without_emails(self):
        make_member("seller@example.ci", self.shop, "seller")
        self.authenticate(User.objects.get(email="seller@example.ci"))
        members = self.client.get(self.url).json()
        self.assertEqual(len(members), 2)
        self.assertTrue(all("email" not in member for member in members))


class TeamNoteTests(ApiTestCase):
    def setUp(self):
        self.shop = make_shop("maison-test")
        self.owner = make_member("owner@example.ci", self.shop, "owner", first_name="Adjoua", last_name="Konan")
        self.manager = make_member("manager@example.ci", self.shop, "manager")
        self.seller = make_member("seller@example.ci", self.shop, "seller")
        self.url = "/api/v1/shops/maison-test/notes"

    def send(self, **body):
        self.authenticate(self.owner)
        response = self.client.post(self.url, {"body": "Livraisons Yopougon suspendues demain.", "audience": "sellers", **body})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def test_note_reaches_its_audience_until_acknowledged(self):
        note = self.send(urgent=True)
        self.assertEqual(note["receipts"], [{"name": "seller@example.ci", "read_at": None}])

        self.authenticate(self.seller)
        unread = self.client.get(f"{self.url}?unread=1").json()
        self.assertEqual([n["id"] for n in unread], [note["id"]])
        self.assertNotIn("receipts", unread[0])
        self.assertEqual(self.client.post(f"{self.url}/{note['id']}/read").status_code, 200)
        self.assertEqual(self.client.get(f"{self.url}?unread=1").json(), [])

        self.authenticate(self.manager)
        self.assertEqual(self.client.get(f"{self.url}?unread=1").json(), [])

        self.authenticate(self.owner)
        receipts = self.client.get(self.url).json()[0]["receipts"]
        self.assertIsNotNone(receipts[0]["read_at"])

    def test_seller_cannot_send_nor_acknowledge_for_others(self):
        note = self.send(audience="member", recipient=str(self.manager.pk))
        self.authenticate(self.seller)
        self.assertProblem(self.client.post(self.url, {"body": "Je décide", "audience": "all"}), 403, "permission_denied")
        self.assertProblem(self.client.post(f"{self.url}/{note['id']}/read"), 404, "not_found")
        self.assertEqual(self.client.get(self.url).json(), [])

    def test_withdrawn_note_leaves_the_banner(self):
        note = self.send()
        self.assertEqual(self.client.delete(f"{self.url}/{note['id']}").status_code, 204)
        self.authenticate(self.seller)
        self.assertEqual(self.client.get(f"{self.url}?unread=1").json(), [])

    def test_a_note_for_nobody_is_refused(self):
        self.authenticate(self.owner)
        response = self.client.post(self.url, {"body": "Bonjour", "audience": "member", "recipient": str(self.owner.pk)})
        self.assertProblem(response, 400, "validation_error")
