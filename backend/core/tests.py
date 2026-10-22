from unittest import mock

from core.testing import ApiTestCase, make_member, make_shop


class ErrorFormatTests(ApiTestCase):
    def test_unknown_route_keeps_the_problem_format(self):
        self.assertProblem(self.client.get("/api/v1/n-existe-pas"), 404, "not_found")

    def test_unknown_route_answers_json_even_to_a_post_without_csrf_token(self):
        # Le client de test n'applique pas le CSRF par défaut : on le force, comme un vrai navigateur.
        strict = self.client_class(enforce_csrf_checks=True)
        for method in ("post", "patch", "delete"):
            with self.subTest(method=method):
                self.assertProblem(getattr(strict, method)("/api/v1/me/role"), 404, "not_found")

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


class SpreadsheetTests(ApiTestCase):
    def test_phone_cells_show_plus_225_and_nothing_else_slips_through(self):
        from core.spreadsheet import csv_safe, excel_csv, phone_cell

        self.assertEqual(csv_safe(phone_cell("+2250707000001")), '="+2250707000001"')
        # Tout ce qui n'est pas un « + » suivi de chiffres retombe dans la neutralisation habituelle.
        for trap in ['+225" & HYPERLINK("x', "+225 07 07", "=CMD()", "-1+1"]:
            with self.subTest(trap=trap):
                self.assertTrue(csv_safe(phone_cell(trap)).startswith("'"))
        self.assertIn('"=""+2250707000001"""', excel_csv(["Téléphone"], [[phone_cell("+2250707000001")]]))
