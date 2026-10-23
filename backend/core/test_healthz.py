from unittest import mock

from django.db import OperationalError
from django.test import TestCase


class HealthzTests(TestCase):
    def test_answers_without_the_bff_secret(self):
        response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"ok": True})
        self.assertIn("no-cache", response["Cache-Control"])

    def test_a_dead_database_answers_503_without_detail(self):
        with mock.patch("core.views.connection.cursor", side_effect=OperationalError("password authentication failed for user akwaba")):
            response = self.client.get("/healthz")

        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"ok": False})
        self.assertNotIn(b"akwaba", response.content)

    def test_rate_limited_per_ip(self):
        with mock.patch("core.ratelimit.time.time", return_value=1_000_000.0):  # une seule fenêtre
            statuses = [self.client.get("/healthz").status_code for _ in range(62)]

        self.assertEqual(statuses[:60], [200] * 60)
        self.assertEqual(set(statuses[60:]), {429})

    def test_only_get(self):
        self.assertEqual(self.client.post("/healthz").status_code, 405)
