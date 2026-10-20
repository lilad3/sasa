from rest_framework.test import APIClient

from accounts.models import UserSession
from audit.models import AuditEvent
from core.testing import CLIENT_IP, LOGIN_URL, ApiTestCase, make_user, without_request_id

WRONG = "ce-n-est-pas-le-bon"


class AntiEnumerationTests(ApiTestCase):
    def test_unknown_email_and_wrong_password_get_the_same_answer(self):
        make_user("awa@example.ci")
        wrong_password = self.login("awa@example.ci", WRONG)
        unknown_email = self.login("personne@example.ci", WRONG)

        self.assertProblem(wrong_password, 401, "invalid_credentials")
        self.assertEqual(without_request_id(wrong_password), without_request_id(unknown_email))


class LockoutTests(ApiTestCase):
    def test_fifth_failure_locks_even_an_unknown_email(self):
        for _ in range(4):
            self.assertProblem(self.login("personne@example.ci", WRONG), 401, "invalid_credentials")

        locked = self.login("personne@example.ci", WRONG)
        self.assertProblem(locked, 423, "account_locked")
        self.assertEqual(locked.json()["retry_after"], 900)
        self.assertEqual(locked["Retry-After"], "900")
        self.assertProblem(self.login("personne@example.ci", WRONG), 423, "account_locked")

    def test_lock_also_refuses_the_right_password(self):
        make_user("awa@example.ci")
        for _ in range(5):
            self.login("awa@example.ci", WRONG)

        self.assertProblem(self.login("awa@example.ci"), 423, "account_locked")
        self.assertTrue(AuditEvent.objects.filter(action="account_locked").exists())

    def test_attempts_remaining_appears_only_near_the_lock(self):
        first = self.login("personne@example.ci", WRONG).json()
        second = self.login("personne@example.ci", WRONG).json()

        self.assertNotIn("attempts_remaining", first)
        self.assertEqual(second["attempts_remaining"], 3)

    def test_success_resets_the_counter(self):
        make_user("awa@example.ci")
        for _ in range(3):
            self.login("awa@example.ci", WRONG)
        self.assertEqual(self.login("awa@example.ci").status_code, 200)

        for _ in range(4):
            self.assertProblem(self.login("awa@example.ci", WRONG), 401, "invalid_credentials")

    def test_ip_limit_applies_across_emails(self):
        for index in range(20):
            self.assertProblem(self.login(f"inconnu{index}@example.ci", WRONG), 401, "invalid_credentials")

        throttled = self.login("encore@example.ci", WRONG)
        self.assertProblem(throttled, 429, "too_many_requests")
        self.assertGreater(throttled.json()["retry_after"], 0)


class LoginTests(ApiTestCase):
    def test_login_returns_tokens_profile_and_shops(self):
        make_user("awa@example.ci", first_name="Awa")
        body = self.login("awa@example.ci").json()

        self.assertEqual(body["status"], "authenticated")
        self.assertEqual(body["access_expires_in"], 300)
        self.assertEqual(body["refresh_expires_in"], 7 * 24 * 3600)
        self.assertEqual(body["user"]["email"], "awa@example.ci")
        self.assertEqual(body["shops"], [])

    def test_email_is_case_insensitive(self):
        make_user("awa@example.ci")
        self.assertEqual(self.login("  AWA@Example.CI ").status_code, 200)

    def test_session_records_the_visitor_sent_by_the_bff(self):
        make_user("awa@example.ci")
        self.login("awa@example.ci")

        session = UserSession.objects.get()
        self.assertEqual(session.ip, CLIENT_IP)
        self.assertEqual(session.device_label, "Chrome · Android")


class BffSecretTests(ApiTestCase):
    def test_api_refuses_calls_without_the_bff_secret(self):
        response = APIClient().post(LOGIN_URL, {"email": "a@example.ci", "password": WRONG}, format="json")
        self.assertProblem(response, 403, "bff_required")

    def test_api_refuses_a_wrong_secret(self):
        client = APIClient(HTTP_X_AKWABA_BFF="devine")
        response = client.post(LOGIN_URL, {"email": "a@example.ci", "password": WRONG}, format="json")
        self.assertProblem(response, 403, "bff_required")
