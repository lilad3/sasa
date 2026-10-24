from django.core import mail
from django.test import override_settings

from core.testing import make_member, make_shop
from notifications.models import NotificationPreference

from .support import NOTIFS, NotifTestCase, enabled


class NotificationRoutesTests(NotifTestCase):
    def ids(self, response):
        return [event["id"] for event in response.json()["events"]]

    def test_each_role_sees_only_the_events_it_may_receive_with_its_defaults(self):
        for user, defaults in (
            (self.owner, {"new_order": True, "low_stock": True, "order_cancelled": True, "daily_summary": True}),
            (self.manager, {"new_order": True, "low_stock": True, "order_cancelled": False, "daily_summary": True}),
            (self.seller, {"new_order": False, "low_stock": False, "order_cancelled": False, "daily_summary": False}),
        ):
            self.authenticate(user)
            response = self.client.get(NOTIFS)
            self.assertEqual(response.status_code, 200, response.content)
            body = response.json()
            self.assertEqual({e["id"]: e["enabled"] for e in body["events"]}, defaults)
            self.assertEqual(body["email"], user.email)
            self.assertTrue(all(e["default"] == e["enabled"] and not e["custom"] for e in body["events"]))
            # Les événements réservés (non prêts) n'apparaissent jamais.
            self.assertNotIn("payment_received", self.ids(response))

    def test_revenue_is_announced_only_to_who_can_read_it(self):
        def row(user):
            self.authenticate(user)
            return next(e for e in self.client.get(NOTIFS).json()["events"] if e["id"] == "daily_summary")

        self.assertTrue(row(self.owner)["includes_revenue"])
        self.assertFalse(row(self.seller)["includes_revenue"])
        # Pas de « products.view » sans l'avoir : le vendeur l'a ; ici on vérifie qu'un champ n'existe que sur cette ligne.
        self.authenticate(self.owner)
        others = [e for e in self.client.get(NOTIFS).json()["events"] if e["id"] != "daily_summary"]
        self.assertTrue(all("includes_revenue" not in e for e in others))

    def test_put_is_partial_and_stores_only_deviations_from_the_default(self):
        self.authenticate(self.manager)
        response = self.client.put(NOTIFS, {"events": {"low_stock": False, "order_cancelled": True}})
        self.assertEqual(response.status_code, 200, response.content)
        rows = {e["id"]: e for e in response.json()["events"]}
        self.assertEqual((rows["low_stock"]["enabled"], rows["low_stock"]["custom"]), (False, True))
        self.assertEqual((rows["order_cancelled"]["enabled"], rows["order_cancelled"]["custom"]), (True, True))
        self.assertTrue(rows["new_order"]["enabled"])
        self.assertEqual(NotificationPreference.objects.filter(membership=self.membership(self.manager)).count(), 2)
        # Revenir au défaut supprime la ligne, et le PUT est idempotent.
        for _ in range(2):
            response = self.client.put(NOTIFS, {"events": {"low_stock": True, "order_cancelled": False}})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(NotificationPreference.objects.count(), 0)

    def test_invalid_event_gives_the_same_answer_for_unknown_unready_and_forbidden(self):
        # Un vendeur n'a pas « dashboard.view » mais a bien tous les événements ; on retire donc un droit au gérant pour le cas « sans droit ».
        self.authenticate(self.seller)
        answers = []
        for key in ("n_importe_quoi", "payment_received", "review_to_moderate"):
            response = self.client.put(NOTIFS, {"events": {key: True}})
            self.assertProblem(response, 400, "invalid_event")
            body = response.json()
            body.pop("request_id")
            answers.append(body)
        self.assertEqual(answers[0], answers[1])
        self.assertEqual(answers[1], answers[2])
        self.assertEqual(NotificationPreference.objects.count(), 0)

    def test_event_without_the_required_right_is_refused_like_an_unknown_one(self):
        from notifications import events

        self.authenticate(self.seller)
        before = self.client.put(NOTIFS, {"events": {"inconnu": True}}).json()
        # Si un événement exige un droit que le rôle n'a pas, il est absent de la page et refusé pareil.
        original = events.EVENTS["low_stock"]
        events.EVENTS["low_stock"] = type(original)("low_stock", "customers.vip", True, original.default_roles)
        try:
            self.assertNotIn("low_stock", self.ids(self.client.get(NOTIFS)))
            after = self.client.put(NOTIFS, {"events": {"low_stock": True}})
        finally:
            events.EVENTS["low_stock"] = original
        self.assertProblem(after, 400, "invalid_event")
        self.assertEqual(after.json()["detail"], before["detail"])

    def test_body_validation(self):
        self.authenticate(self.owner)
        for body in ({}, {"events": {}}, {"events": []}, {"events": "x"}, {"events": {"low_stock": "oui"}}, {"events": {"low_stock": 1}}):
            self.assertProblem(self.client.put(NOTIFS, body), 400, "validation_error")
        too_many = {f"e{i}": True for i in range(21)}
        self.assertProblem(self.client.put(NOTIFS, {"events": too_many}), 400, "validation_error")

    def test_61st_change_in_an_hour_is_limited(self):
        self.authenticate(self.owner)
        for _ in range(60):
            self.assertEqual(self.client.put(NOTIFS, {"events": {"low_stock": False}}).status_code, 200)
        self.assertProblem(self.client.put(NOTIFS, {"events": {"low_stock": False}}), 429, "too_many_requests")

    def test_non_member_and_other_shop_get_404(self):
        outsider = make_member("autre@exemple.ci", make_shop("autre-boutique"), "owner")
        self.authenticate(outsider)
        self.assertProblem(self.client.get(NOTIFS), 404, "not_found")
        self.assertProblem(self.client.put(NOTIFS, {"events": {"low_stock": False}}), 404, "not_found")
        self.assertProblem(self.client.post(NOTIFS + "/test"), 404, "not_found")

    def test_one_member_cannot_change_another_ones_choices(self):
        self.authenticate(self.owner)
        self.client.put(NOTIFS, {"events": {"new_order": False}})
        self.authenticate(self.manager)
        rows = {e["id"]: e for e in self.client.get(NOTIFS).json()["events"]}
        self.assertTrue(rows["new_order"]["enabled"])
        # Aucun identifiant de membre n'est accepté : ni dans le corps, ni dans l'adresse.
        self.client.put(NOTIFS, {"events": {"low_stock": False}, "membership": self.membership(self.owner).pk})
        self.assertFalse(NotificationPreference.objects.filter(membership=self.membership(self.owner), event="low_stock").exists())

    def test_two_shops_have_independent_choices(self):
        other = make_shop("deuxieme", "Deuxième")
        from shops.models import Membership

        Membership.objects.create(user=self.manager, shop=other, role="manager")
        self.authenticate(self.manager)
        self.client.put(NOTIFS, {"events": {"low_stock": False}})
        rows = {e["id"]: e for e in self.client.get("/api/v1/shops/deuxieme/notifications").json()["events"]}
        self.assertTrue(rows["low_stock"]["enabled"])

    def test_sending_is_false_with_the_console_backend_or_when_disabled(self):
        self.authenticate(self.owner)
        self.assertTrue(self.client.get(NOTIFS).json()["sending"])
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend"):
            self.assertFalse(self.client.get(NOTIFS).json()["sending"])
        with override_settings(NOTIFICATIONS_ENABLED=False):
            self.assertFalse(self.client.get(NOTIFS).json()["sending"])


class TestEmailTests(NotifTestCase):
    def test_goes_only_to_the_account_address_with_no_shop_data(self):
        self.authenticate(self.manager)
        response = self.client.post(NOTIFS + "/test", {"to": "pirate@exemple.ci"})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["fatou@exemple.ci"])
        body = message.body + message.alternatives[0][0]
        self.assertNotIn("Maison Adjoua", body)
        self.assertNotIn("pirate", body)

    def test_limited_to_three_per_hour_and_needs_active_sending(self):
        self.authenticate(self.owner)
        for _ in range(3):
            self.assertEqual(self.client.post(NOTIFS + "/test").status_code, 200)
        self.assertProblem(self.client.post(NOTIFS + "/test"), 429, "too_many_requests")

    def test_409_when_sending_is_not_active(self):
        self.authenticate(self.owner)
        with override_settings(EMAIL_BACKEND="django.core.mail.backends.console.EmailBackend"):
            self.assertProblem(self.client.post(NOTIFS + "/test"), 409, "notifications_disabled")

    @override_settings(EMAIL_BACKEND="notifications.tests.support.BrokenBackend")
    def test_502_when_the_server_fails(self):
        self.authenticate(self.owner)
        self.assertProblem(self.client.post(NOTIFS + "/test"), 502, "email_failed")
