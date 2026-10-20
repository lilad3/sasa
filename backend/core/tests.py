from unittest import mock

from core.testing import ApiTestCase, make_member, make_shop


class ErrorFormatTests(ApiTestCase):
    def test_unknown_route_keeps_the_problem_format(self):
        self.assertProblem(self.client.get("/api/v1/n-existe-pas"), 404, "not_found")

    def test_unexpected_error_hides_internals(self):
        shop = make_shop("maison-test")
        self.authenticate(make_member("owner@example.ci", shop, "owner"))

        with (
            mock.patch("shops.views.dashboard_summary", side_effect=RuntimeError("détail interne secret")),
            self.assertLogs("akwaba", level="ERROR"),
        ):
            response = self.client.get("/api/v1/shops/maison-test/dashboard")

        self.assertProblem(response, 500, "server_error")
        content = response.content.decode()
        self.assertNotIn("détail interne secret", content)
        self.assertNotIn("Traceback", content)
        self.assertEqual(response.json()["request_id"], response["X-Request-ID"])

    def test_request_id_from_the_bff_is_kept(self):
        response = self.client.get("/api/v1/me", HTTP_X_REQUEST_ID="req_depuis_next_123")
        self.assertEqual(response["X-Request-ID"], "req_depuis_next_123")
        self.assertEqual(response.json()["request_id"], "req_depuis_next_123")

    def test_malformed_request_id_is_replaced(self):
        response = self.client.get("/api/v1/me", HTTP_X_REQUEST_ID="<script>")
        self.assertTrue(response["X-Request-ID"].startswith("req_"))
