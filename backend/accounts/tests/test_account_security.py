import re
from datetime import timedelta

from django.core import mail
from django.utils import timezone

from accounts import mfa
from accounts.models import KnownDevice, UserSession
from accounts.sessions import open_session
from audit.models import AuditEvent
from audit.services import record
from core.testing import DEVICE_ID, LOGIN_URL, PASSWORD, ApiTestCase, enable_mfa, make_user, totp

REAUTH_URL = "/api/v1/auth/reauth"
WRONG = "ce-n-est-pas-le-bon"


class ReauthTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.authenticate(self.user)

    def test_wrong_password_is_refused_and_logged(self):
        response = self.client.post(REAUTH_URL, {"password": WRONG})

        self.assertProblem(response, 400, "validation_error")
        self.assertEqual(response.json()["errors"]["password"][0]["code"], "invalid_password")
        self.assertTrue(AuditEvent.objects.filter(action="reauth_failed").exists())

    def test_password_opens_a_ten_minute_window(self):
        self.assertEqual(self.client.post(REAUTH_URL, {"password": PASSWORD}).status_code, 200)

        until = UserSession.objects.get().reauth_until
        self.assertAlmostEqual((until - timezone.now()).total_seconds(), 600, delta=5)

    def test_with_2fa_on_the_code_is_required(self):
        secret, _ = enable_mfa(self.user)

        refused = self.client.post(REAUTH_URL, {"password": PASSWORD})
        self.assertEqual(refused.json()["errors"]["code"][0]["code"], "required")
        self.assertEqual(self.client.post(REAUTH_URL, {"code": totp(secret)}).status_code, 200)


class MfaDisableTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.secret, self.codes = enable_mfa(self.user)
        self.authenticate(self.user)

    def test_disable_requires_a_recent_confirmation(self):
        self.assertProblem(self.client.post("/api/v1/me/2fa/disable"), 403, "reauth_required")
        self.assertTrue(mfa.is_enabled(self.user))

    def test_disable_after_confirmation_alerts_the_owner(self):
        self.client.post(REAUTH_URL, {"code": totp(self.secret)})

        self.assertEqual(self.client.post("/api/v1/me/2fa/disable").status_code, 204)
        self.assertFalse(mfa.is_enabled(self.user))
        self.assertIn("Double authentification désactivée", [m.subject for m in mail.outbox])
        self.assertTrue(AuditEvent.objects.filter(action="mfa_disabled").exists())

    def test_expired_window_is_refused(self):
        self.client.post(REAUTH_URL, {"code": totp(self.secret)})
        UserSession.objects.update(reauth_until=timezone.now() - timedelta(seconds=1))
        self.assertProblem(self.client.post("/api/v1/me/2fa/disable"), 403, "reauth_required")

    def test_new_recovery_codes_replace_the_old_ones(self):
        self.client.post(REAUTH_URL, {"code": totp(self.secret)})
        response = self.client.post("/api/v1/me/2fa/recovery-codes")

        self.assertEqual(len(response.json()["recovery_codes"]), 10)
        self.assertIsNone(mfa.verify(self.user, self.codes[0]))
        self.assertEqual(mfa.verify(self.user, response.json()["recovery_codes"][0]), "recovery_code")


class SessionManagementTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.laptop = self.login("awa@example.ci").json()
        self.phone = self.login("awa@example.ci").json()
        self.client.bearer(self.laptop["access"])

    def test_list_shows_active_sessions_and_the_current_one(self):
        sessions = self.client.get("/api/v1/me/sessions").json()

        self.assertEqual(len(sessions), 2)
        self.assertEqual([s["current"] for s in sessions].count(True), 1)
        self.assertEqual(sessions[0]["device_label"], "Chrome · Android")

    def test_closing_one_session_cuts_it_immediately(self):
        [phone_session] = [s for s in self.client.get("/api/v1/me/sessions").json() if not s["current"]]
        self.assertEqual(self.client.delete(f"/api/v1/me/sessions/{phone_session['id']}").status_code, 204)

        self.client.bearer(self.phone["access"])
        self.assertProblem(self.client.get("/api/v1/me"), 401, "session_revoked")

    def test_revoke_others_keeps_the_current_session(self):
        self.assertEqual(self.client.post("/api/v1/me/sessions/revoke-others").status_code, 204)

        self.assertEqual(self.client.get("/api/v1/me").status_code, 200)
        self.client.bearer(self.phone["access"])
        self.assertProblem(self.client.get("/api/v1/me"), 401, "session_revoked")

    def test_cannot_close_someone_elses_session(self):
        other_session, _ = open_session(make_user("autre@example.ci"), None)

        self.assertProblem(self.client.delete(f"/api/v1/me/sessions/{other_session.pk}"), 404, "not_found")
        other_session.refresh_from_db()
        self.assertIsNone(other_session.revoked_at)


class UnlockTests(ApiTestCase):
    def lock(self, email):
        for _ in range(5):
            self.login(email, WRONG)

    def test_owner_unlocks_from_the_email_link_once(self):
        make_user("awa@example.ci")
        self.lock("awa@example.ci")
        self.assertIn("/deverrouiller?token=", mail.outbox[-1].body)
        token = re.search(r"deverrouiller\?token=(\S+)", mail.outbox[-1].body).group(1)

        self.assertEqual(self.client.post("/api/v1/auth/unlock", {"token": token}).status_code, 204)
        self.assertEqual(self.login("awa@example.ci").status_code, 200)
        again = self.client.post("/api/v1/auth/unlock", {"token": token})
        self.assertProblem(again, 400, "token_invalid_or_expired")

    def test_unknown_email_gets_locked_but_no_email_is_sent(self):
        self.lock("personne@example.ci")
        self.assertEqual(len(mail.outbox), 0)

    def test_forged_link_is_refused(self):
        response = self.client.post("/api/v1/auth/unlock", {"token": "faux"})
        self.assertProblem(response, 400, "token_invalid_or_expired")


class NewDeviceTests(ApiTestCase):
    def setUp(self):
        make_user("awa@example.ci")

    def new_device_alerts(self):
        return [m for m in mail.outbox if m.subject == "Nouvelle connexion à votre compte Akwaba"]

    def test_first_login_and_known_device_raise_no_alert(self):
        self.login("awa@example.ci")
        self.login("awa@example.ci")
        self.assertEqual(self.new_device_alerts(), [])

    def test_login_from_an_unknown_device_alerts_the_owner(self):
        self.login("awa@example.ci")
        self.client.post(
            LOGIN_URL, {"email": "awa@example.ci", "password": PASSWORD}, HTTP_X_DEVICE_ID="dev_ordinateur_inconnu_42"
        )

        self.assertEqual(len(self.new_device_alerts()), 1)
        self.assertTrue(AuditEvent.objects.filter(action="new_device").exists())

    def test_device_ids_are_stored_as_fingerprints(self):
        self.login("awa@example.ci")
        self.assertNotIn(DEVICE_ID, KnownDevice.objects.get().device_hash)


class AlertTests(ApiTestCase):
    def test_password_change_alerts_the_owner(self):
        self.authenticate(make_user("awa@example.ci"))
        self.client.post("/api/v1/me/password", {"current_password": PASSWORD, "password": "mangrove-baobab-tambour"})
        self.assertIn("Votre mot de passe Akwaba a été changé", [m.subject for m in mail.outbox])

    def test_stolen_refresh_alerts_the_owner(self):
        make_user("awa@example.ci")
        tokens = self.login("awa@example.ci").json()
        self.refresh(tokens["refresh"])
        UserSession.objects.update(rotated_at=timezone.now() - timedelta(seconds=30))
        self.refresh(tokens["refresh"])
        self.assertIn("Une de vos sessions a été fermée par sécurité", [m.subject for m in mail.outbox])


class MerchantSecurityPageTests(ApiTestCase):
    def test_merchant_sees_only_their_own_security_events(self):
        awa = make_user("awa@example.ci")
        make_user("autre@example.ci")
        self.login("autre@example.ci")
        self.login("awa@example.ci", WRONG)
        tokens = self.login("awa@example.ci").json()
        record("shop_created", actor=awa)  # activité de boutique : pas sur la page Sécurité

        self.client.bearer(tokens["access"])
        events = self.client.get("/api/v1/me/security-events").json()["results"]

        self.assertEqual([e["type"] for e in events], ["login_succeeded", "login_failed"])
        self.assertEqual(events[0]["label"], "Connexion réussie")
        self.assertEqual(set(events[0]), {"id", "type", "label", "severity", "ip", "device_label", "created_at"})
