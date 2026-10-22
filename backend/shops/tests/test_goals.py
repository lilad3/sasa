from datetime import timedelta

from django.utils import timezone

from audit.models import AuditEvent
from core.testing import ApiTestCase, make_member, make_order, make_shop
from shops.models import ShopGoal, TeamNote


class MonthWordingTests(ApiTestCase):
    def test_de_is_elided_before_a_vowel(self):
        from shops.goals import of_month

        self.assertEqual([of_month(m) for m in ("octobre", "août", "avril", "mai", "septembre")], ["d'octobre", "d'août", "d'avril", "de mai", "de septembre"])


class GoalTests(ApiTestCase):
    """Objectif du mois (docs/chantier-p4.md §D) : le vendeur ne voit que le pourcentage."""

    def setUp(self):
        self.shop = make_shop("maison-test")
        self.owner = make_member("owner@example.ci", self.shop, "owner", first_name="Adjoua")
        self.manager = make_member("manager@example.ci", self.shop, "manager")
        self.seller = make_member("seller@example.ci", self.shop, "seller")
        self.url = "/api/v1/shops/maison-test/goal"
        make_order(self.shop, total=30_000, status="delivered")
        make_order(self.shop, total=99_000, status="cancelled")

    def test_owner_sets_the_goal_and_the_seller_only_sees_the_percentage(self):
        self.authenticate(self.owner)
        body = self.client.put(self.url, {"amount": 100_000}).json()
        self.assertEqual((body["goal"]["percent"], body["goal"]["amount"], body["goal"]["revenue"]), (30.0, 100_000, 30_000))
        self.assertTrue(AuditEvent.objects.filter(action="goal_set").exists())

        self.authenticate(self.seller)
        goal = self.client.get(self.url).json()["goal"]
        self.assertEqual((goal["percent"], goal["amount"], goal["revenue"]), (30.0, None, None))

    def test_announcements_hide_the_amount_from_sellers(self):
        self.authenticate(self.owner)
        self.client.put(self.url, {"amount": 2_500_000})
        manager_note = TeamNote.objects.get(kind="goal", audience="managers")
        seller_note = TeamNote.objects.get(kind="goal", audience="sellers")
        self.assertIn("2 500 000 F", manager_note.body)
        self.assertNotIn("2 500 000", seller_note.body)
        self.assertIn("Adjoua a fixé l'objectif", seller_note.body)
        self.assertEqual(seller_note.receipts.get().user, self.seller)

        self.authenticate(self.seller)
        [unread] = self.client.get("/api/v1/shops/maison-test/notes?unread=1").json()
        self.assertEqual(unread["kind"], "goal")

    def test_only_the_owner_sets_it_and_amounts_are_bounded(self):
        self.authenticate(self.manager)
        self.assertProblem(self.client.put(self.url, {"amount": 100_000}), 403, "permission_denied")
        self.authenticate(self.owner)
        self.assertProblem(self.client.put(self.url, {"amount": 999}), 400, "validation_error")
        self.assertProblem(self.client.put(self.url, {"amount": 3_000_000_000}), 400, "validation_error")

    def test_history_shows_previous_months_with_a_goal(self):
        last_month = (timezone.localdate().replace(day=1) - timedelta(days=1)).replace(day=1)
        ShopGoal.objects.create(shop=self.shop, month=last_month, amount=50_000, set_by=self.owner, set_by_name="Adjoua")
        self.authenticate(self.manager)
        body = self.client.get(self.url).json()
        self.assertIsNone(body["goal"])
        self.assertEqual(len(body["history"]), 1)
        self.assertEqual(body["history"][0]["month"], last_month.strftime("%Y-%m"))
        self.assertEqual(body["history"][0]["amount"], 50_000)
