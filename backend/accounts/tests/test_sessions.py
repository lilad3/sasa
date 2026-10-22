from datetime import timedelta

from django.utils import timezone
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from accounts.models import UserSession
from audit.models import AuditEvent
from core.testing import ApiTestCase, make_user

ME_URL = "/api/v1/me"
LOGOUT_URL = "/api/v1/auth/logout"


class RefreshRotationTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.tokens = self.login("awa@example.ci").json()

    def test_refresh_gives_a_new_pair(self):
        response = self.refresh(self.tokens["refresh"])

        self.assertEqual(response.status_code, 200)
        self.assertNotEqual(response.json()["refresh"], self.tokens["refresh"])

    def test_reused_refresh_revokes_the_whole_session(self):
        rotated = self.refresh(self.tokens["refresh"]).json()
        UserSession.objects.update(rotated_at=timezone.now() - timedelta(seconds=30))  # fenêtre de grâce passée

        self.assertProblem(self.refresh(self.tokens["refresh"]), 401, "session_revoked")
        # Le voleur est coupé, et le refresh légitime aussi : il faut se reconnecter.
        self.assertProblem(self.refresh(rotated["refresh"]), 401, "session_revoked")
        self.client.bearer(rotated["access"])
        self.assertProblem(self.client.get(ME_URL), 401, "session_revoked")
        self.assertEqual(UserSession.objects.get().revoked_reason, "refresh_reuse")
        self.assertTrue(AuditEvent.objects.filter(action="refresh_reuse_detected").exists())

    def test_parallel_refresh_within_grace_gets_the_current_refresh(self):
        first = self.refresh(self.tokens["refresh"]).json()
        second = self.refresh(self.tokens["refresh"])

        self.assertEqual(second.status_code, 200)
        self.assertIn("access", second.json())
        # Le même refresh courant que la requête gagnante (même identifiant) : voir test_refresh_race.py.
        current = UserSession.objects.get().refresh_jti
        self.assertEqual(RefreshToken(second.json()["refresh"])["jti"], current)
        self.assertEqual(RefreshToken(first["refresh"])["jti"], current)
        self.assertIsNone(UserSession.objects.get().revoked_at)


class RevocationTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.tokens = self.login("awa@example.ci").json()

    def test_logout_cuts_access_immediately(self):
        self.client.bearer(self.tokens["access"])
        self.assertEqual(self.client.get(ME_URL).status_code, 200)

        self.assertEqual(self.client.post(LOGOUT_URL).status_code, 204)
        # L'access token n'a pas expiré, mais sa session est fermée.
        self.assertProblem(self.client.get(ME_URL), 401, "session_revoked")

    def test_logout_with_refresh_only(self):
        self.assertEqual(self.client.post(LOGOUT_URL, {"refresh": self.tokens["refresh"]}).status_code, 204)
        self.assertProblem(self.refresh(self.tokens["refresh"]), 401, "session_revoked")

    def test_logout_twice_is_not_an_error(self):
        self.client.post(LOGOUT_URL, {"refresh": self.tokens["refresh"]})
        self.assertEqual(self.client.post(LOGOUT_URL, {"refresh": self.tokens["refresh"]}).status_code, 204)


class SharedDeviceTests(ApiTestCase):
    def test_shared_session_is_short_and_dies_when_idle(self):
        make_user("awa@example.ci")
        tokens = self.login("awa@example.ci", shared_device=True).json()
        self.assertLessEqual(tokens["refresh_expires_in"], 8 * 3600)

        UserSession.objects.update(last_seen_at=timezone.now() - timedelta(minutes=16))
        self.assertProblem(self.refresh(tokens["refresh"]), 401, "session_expired")
        self.client.bearer(tokens["access"])
        self.assertProblem(self.client.get(ME_URL), 401, "session_expired")

    def test_normal_session_survives_idle_time(self):
        make_user("awa@example.ci")
        tokens = self.login("awa@example.ci").json()

        UserSession.objects.update(last_seen_at=timezone.now() - timedelta(hours=3))
        self.assertEqual(self.refresh(tokens["refresh"]).status_code, 200)


class TokenIntegrityTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.tokens = self.login("awa@example.ci").json()

    def test_refresh_token_is_not_an_access_token(self):
        self.client.bearer(self.tokens["refresh"])
        self.assertProblem(self.client.get(ME_URL), 401, "token_invalid")

    def test_access_token_is_not_a_refresh_token(self):
        self.assertProblem(self.refresh(self.tokens["access"]), 401, "token_invalid")

    def test_tampered_token_is_rejected(self):
        self.client.bearer(self.tokens["access"][:-4] + "abcd")
        self.assertProblem(self.client.get(ME_URL), 401, "token_invalid")

    def test_expired_access_token_says_so(self):
        session = UserSession.objects.get()
        token = AccessToken()
        token.set_exp(from_time=timezone.now() - timedelta(minutes=10), lifetime=timedelta(minutes=5))
        token["sub"], token["sid"] = str(self.user.pk), str(session.pk)

        self.client.bearer(str(token))
        response = self.client.get(ME_URL)
        self.assertProblem(response, 401, "token_expired")
        self.assertIn("Bearer", response["WWW-Authenticate"])

    def test_no_token_means_not_authenticated(self):
        self.assertProblem(self.client.get(ME_URL), 401, "not_authenticated")
