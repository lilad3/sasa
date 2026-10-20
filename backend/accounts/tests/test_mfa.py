import time
from unittest import mock

from django.core import mail

from accounts.models import RecoveryCode, TOTPDevice, UserSession
from audit.models import AuditEvent
from core.testing import ApiTestCase, enable_mfa, make_user, totp, wrong_code

MFA_URL = "/api/v1/auth/login/2fa"


class MfaSetupTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.authenticate(self.user)

    def test_setup_then_first_code_enables_2fa(self):
        setup = self.client.post("/api/v1/me/2fa/setup").json()
        self.assertTrue(setup["otpauth_uri"].startswith("otpauth://totp/Akwaba:"))
        self.assertIn("<svg", setup["qr_svg"])
        self.assertFalse(self.client.get("/api/v1/me").json()["mfa_enabled"])  # pas encore confirmée

        confirm = self.client.post("/api/v1/me/2fa/confirm", {"code": totp(setup["secret"])})
        self.assertEqual(confirm.status_code, 200)
        self.assertEqual(len(confirm.json()["recovery_codes"]), 10)
        self.assertTrue(self.client.get("/api/v1/me").json()["mfa_enabled"])
        self.assertTrue(AuditEvent.objects.filter(action="mfa_enabled", actor_id=self.user.pk).exists())

    def test_wrong_first_code_does_not_enable(self):
        setup = self.client.post("/api/v1/me/2fa/setup").json()
        response = self.client.post("/api/v1/me/2fa/confirm", {"code": wrong_code(setup["secret"])})

        self.assertProblem(response, 400, "validation_error")
        self.assertEqual(response.json()["errors"]["code"][0]["code"], "mfa_invalid_code")
        self.assertFalse(TOTPDevice.objects.filter(confirmed_at__isnull=False).exists())

    def test_confirm_without_setup_is_refused(self):
        self.assertProblem(self.client.post("/api/v1/me/2fa/confirm", {"code": "123456"}), 409, "mfa_setup_required")

    def test_cannot_setup_twice(self):
        enable_mfa(self.user)
        self.assertProblem(self.client.post("/api/v1/me/2fa/setup"), 409, "mfa_already_enabled")

    def test_secrets_are_never_stored_in_clear(self):
        secret, codes = enable_mfa(self.user)

        self.assertNotIn(secret, TOTPDevice.objects.get(user=self.user).secret_encrypted)
        stored = set(RecoveryCode.objects.values_list("code_hash", flat=True))
        self.assertEqual(len(stored), 10)
        plain = set(codes) | {code.replace("-", "") for code in codes}
        self.assertFalse(stored & plain)

    def test_demo_accounts_cannot_touch_2fa(self):
        self.authenticate(make_user("demo@example.ci", is_demo=True))
        self.assertProblem(self.client.post("/api/v1/me/2fa/setup"), 403, "demo_restricted")


class MfaLoginTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.secret, self.codes = enable_mfa(self.user)

    def challenge(self):
        body = self.login("awa@example.ci").json()
        self.assertEqual(body["status"], "mfa_required")
        return body["mfa_token"]

    def second_step(self, token, code):
        return self.client.post(MFA_URL, {"mfa_token": token, "code": code})

    def test_password_alone_opens_no_session(self):
        body = self.login("awa@example.ci").json()

        self.assertEqual(body["methods"], ["totp", "recovery_code"])
        self.assertNotIn("access", body)
        self.assertNotIn("refresh", body)
        self.assertFalse(UserSession.objects.exists())

    def test_valid_code_completes_the_login(self):
        response = self.second_step(self.challenge(), totp(self.secret))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "authenticated")
        self.assertTrue(response.json()["user"]["mfa_enabled"])

    def test_a_code_cannot_be_replayed(self):
        code = totp(self.secret)
        self.second_step(self.challenge(), code)
        self.assertProblem(self.second_step(self.challenge(), code), 401, "mfa_invalid_code")

    def test_mfa_token_works_only_once(self):
        token = self.challenge()
        self.second_step(token, totp(self.secret))
        self.assertProblem(self.second_step(token, totp(self.secret, steps_ahead=1)), 401, "mfa_token_expired")

    def test_mfa_token_dies_after_three_wrong_codes(self):
        token = self.challenge()
        first = self.second_step(token, wrong_code(self.secret))
        self.assertProblem(first, 401, "mfa_invalid_code")
        self.assertEqual(first.json()["attempts_remaining"], 2)
        self.second_step(token, wrong_code(self.secret))

        self.assertProblem(self.second_step(token, wrong_code(self.secret)), 401, "mfa_token_expired")
        self.assertProblem(self.second_step(token, totp(self.secret)), 401, "mfa_token_expired")

    def test_mfa_token_expires_after_five_minutes(self):
        token = self.challenge()
        with mock.patch("django.core.signing.time.time", return_value=time.time() + 6 * 60):
            response = self.second_step(token, totp(self.secret))
        self.assertProblem(response, 401, "mfa_token_expired")

    def test_recovery_code_works_once_and_alerts_the_owner(self):
        response = self.second_step(self.challenge(), self.codes[0].upper())
        self.assertEqual(response.status_code, 200)
        self.assertIn("Un code de secours a été utilisé", [m.subject for m in mail.outbox])
        self.assertTrue(AuditEvent.objects.filter(action="recovery_code_used").exists())

        self.assertProblem(self.second_step(self.challenge(), self.codes[0]), 401, "mfa_invalid_code")

    def test_known_password_does_not_allow_endless_code_guessing(self):
        # Le mot de passe juste ne remet pas le compteur à zéro : les codes faux finissent par verrouiller le compte.
        for _ in range(2):
            token = self.challenge()
            self.second_step(token, wrong_code(self.secret))
            self.second_step(token, wrong_code(self.secret))

        self.assertProblem(self.second_step(self.challenge(), wrong_code(self.secret)), 423, "account_locked")
        self.assertProblem(self.login("awa@example.ci"), 423, "account_locked")
        self.assertEqual(AuditEvent.objects.filter(action="mfa_failed").count(), 5)
