import re
import time
from unittest import mock

from django.contrib.auth.hashers import make_password
from django.contrib.auth.password_validation import validate_password
from django.core import mail, signing
from django.core.exceptions import ValidationError
from django.test import SimpleTestCase, override_settings

from accounts.models import User
from accounts.views import SIGNUP_SALT
from core.testing import PASSWORD, ApiTestCase, make_user, without_request_id
from shops.models import Membership

SIGNUP_URL = "/api/v1/auth/signup"
COMPLETE_URL = "/api/v1/auth/signup/complete"
FORGOT_URL = "/api/v1/auth/password/forgot"
RESET_URL = "/api/v1/auth/password/reset"
CHANGE_URL = "/api/v1/me/password"
NEW_PASSWORD = "mangrove-baobab-tambour"


def signup_payload(email):
    return {"email": email, "first_name": "Aya", "last_name": "Koné", "shop_name": "Chez Aya"}


def link_token(message):
    return re.search(r"token=(\S+)", message.body).group(1)


@override_settings(SIGNUP_EMAIL_VERIFICATION=True)
class SignupTests(ApiTestCase):
    """Inscription en deux temps, avec lien de confirmation par e-mail (SIGNUP_EMAIL_VERIFICATION=1)."""

    def test_mode_is_announced_to_the_front(self):
        self.assertEqual(self.client.get(SIGNUP_URL).json(), {"email_verification": True})

    def test_password_sent_too_early_is_never_kept(self):
        # Le formulaire en une étape enverrait un mot de passe : en mode e-mail, il est ignoré
        # et ne finit jamais dans le jeton du lien (lisible par qui a la boîte mail).
        response = self.client.post(SIGNUP_URL, {**signup_payload("aya@example.ci"), "password": PASSWORD})

        self.assertEqual(response.status_code, 202)
        pending = signing.loads(link_token(mail.outbox[0]), salt=SIGNUP_SALT)
        self.assertNotIn("password", pending)
        self.assertFalse(User.objects.filter(email="aya@example.ci").exists())

    def test_signup_answers_the_same_for_free_and_taken_emails(self):
        make_user("pris@example.ci")
        free = self.client.post(SIGNUP_URL, signup_payload("libre@example.ci"))
        taken = self.client.post(SIGNUP_URL, signup_payload("pris@example.ci"))

        self.assertEqual(free.status_code, 202)
        self.assertEqual(without_request_id(free), without_request_id(taken))
        # Seul l'e-mail diffère, et il part vers la boîte du titulaire de l'adresse.
        self.assertIn("/inscription/terminer?token=", mail.outbox[0].body)
        self.assertIn("/connexion", mail.outbox[1].body)
        self.assertIn("/mot-de-passe-oublie", mail.outbox[1].body)
        self.assertNotIn("token=", mail.outbox[1].body)
        self.assertFalse(User.objects.filter(email="libre@example.ci").exists())

    def test_complete_creates_account_shop_and_session(self):
        self.client.post(SIGNUP_URL, signup_payload("aya@example.ci"))
        response = self.client.post(COMPLETE_URL, {"token": link_token(mail.outbox[0]), "password": PASSWORD})

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["status"], "authenticated")
        self.assertEqual(body["user"]["email"], "aya@example.ci")
        self.assertEqual(body["shops"][0]["role"], "owner")
        self.assertEqual(body["shops"][0]["slug"], "chez-aya")
        self.assertTrue(Membership.objects.filter(user__email="aya@example.ci", role="owner").exists())

    def test_link_works_only_once(self):
        self.client.post(SIGNUP_URL, signup_payload("aya@example.ci"))
        token = link_token(mail.outbox[0])
        self.client.post(COMPLETE_URL, {"token": token, "password": PASSWORD})

        again = self.client.post(COMPLETE_URL, {"token": token, "password": PASSWORD})
        self.assertProblem(again, 400, "token_invalid_or_expired")

    def test_link_expires_after_24_hours(self):
        self.client.post(SIGNUP_URL, signup_payload("aya@example.ci"))
        token = link_token(mail.outbox[0])

        with mock.patch("django.core.signing.time.time", return_value=time.time() + 25 * 3600):
            response = self.client.post(COMPLETE_URL, {"token": token, "password": PASSWORD})
        self.assertProblem(response, 400, "token_invalid_or_expired")

    def test_forged_link_is_refused(self):
        response = self.client.post(COMPLETE_URL, {"token": "pas-un-vrai-jeton", "password": PASSWORD})
        self.assertProblem(response, 400, "token_invalid_or_expired")

    def test_weak_password_is_refused_with_its_code(self):
        self.client.post(SIGNUP_URL, signup_payload("aya@example.ci"))
        response = self.client.post(COMPLETE_URL, {"token": link_token(mail.outbox[0]), "password": "abidjan2026"})

        self.assertProblem(response, 400, "validation_error")
        codes = [error["code"] for error in response.json()["errors"]["password"]]
        self.assertIn("password_local_pattern", codes)


@override_settings(SIGNUP_EMAIL_VERIFICATION=False)
class DirectSignupTests(ApiTestCase):
    """Inscription en une étape, sans e-mail (SIGNUP_EMAIL_VERIFICATION=0, à activer seulement sans serveur d'e-mails)."""

    def payload(self, email="aya@example.ci", password=PASSWORD):
        return {**signup_payload(email), "password": password}

    def test_mode_is_announced_to_the_front(self):
        self.assertEqual(self.client.get(SIGNUP_URL).json(), {"email_verification": False})

    def test_creates_account_shop_and_session_without_any_email(self):
        response = self.client.post(SIGNUP_URL, self.payload())

        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["status"], "authenticated")
        self.assertEqual(body["shops"][0]["slug"], "chez-aya")
        self.assertEqual(body["shops"][0]["role"], "owner")
        self.assertEqual(mail.outbox, [])
        self.assertTrue(User.objects.get(email="aya@example.ci").check_password(PASSWORD))

    def test_taken_email_is_refused(self):
        make_user("aya@example.ci")
        response = self.client.post(SIGNUP_URL, self.payload())

        self.assertProblem(response, 409, "email_taken")
        self.assertEqual(Membership.objects.filter(user__email="aya@example.ci").count(), 0)

    def test_password_is_required(self):
        response = self.client.post(SIGNUP_URL, signup_payload("aya@example.ci"))

        self.assertProblem(response, 400, "validation_error")
        self.assertIn("password", response.json()["errors"])

    def test_weak_password_is_refused_and_costs_no_attempt(self):
        for _ in range(6):
            weak = self.client.post(SIGNUP_URL, self.payload(password="abidjan2026"))
            self.assertProblem(weak, 400, "validation_error")
        codes = [error["code"] for error in weak.json()["errors"]["password"]]
        self.assertIn("password_local_pattern", codes)
        # Six refus pour mot de passe faible, et la personne peut toujours s'inscrire.
        self.assertEqual(self.client.post(SIGNUP_URL, self.payload()).status_code, 201)

    def test_probing_addresses_is_rate_limited_per_ip(self):
        for i in range(5):
            self.client.post(SIGNUP_URL, self.payload(email=f"essai{i}@example.ci"))
        response = self.client.post(SIGNUP_URL, self.payload(email="essai5@example.ci"))

        self.assertProblem(response, 429, "too_many_requests")
        self.assertFalse(User.objects.filter(email="essai5@example.ci").exists())


class PasswordResetTests(ApiTestCase):
    def setUp(self):
        self.user = make_user("awa@example.ci")
        self.tokens = self.login("awa@example.ci").json()

    def reset_link(self):
        self.assertEqual(self.client.post(FORGOT_URL, {"email": "awa@example.ci"}).status_code, 202)
        self.assertIn("/nouveau-mot-de-passe?uid=", mail.outbox[-1].body)
        uid, token = re.search(r"uid=([\w-]+)&token=([\w-]+)", mail.outbox[-1].body).groups()
        return {"uid": uid, "token": token}

    def test_reset_closes_every_session_and_works_once(self):
        link = self.reset_link()
        self.assertEqual(self.client.post(RESET_URL, {**link, "password": NEW_PASSWORD}).status_code, 204)

        self.client.bearer(self.tokens["access"])
        self.assertProblem(self.client.get("/api/v1/me"), 401, "session_revoked")
        self.client.credentials()
        self.assertEqual(self.login("awa@example.ci", NEW_PASSWORD).status_code, 200)
        again = self.client.post(RESET_URL, {**link, "password": "encore-un-autre-mot"})
        self.assertProblem(again, 400, "token_invalid_or_expired")

    def test_forgot_password_does_not_reveal_accounts(self):
        known = self.client.post(FORGOT_URL, {"email": "awa@example.ci"})
        unknown = self.client.post(FORGOT_URL, {"email": "personne@example.ci"})

        self.assertEqual(without_request_id(known), without_request_id(unknown))
        self.assertEqual(len(mail.outbox), 1)

    def test_demo_accounts_get_no_reset_email(self):
        make_user("demo@example.ci", is_demo=True)
        self.client.post(FORGOT_URL, {"email": "demo@example.ci"})
        self.assertEqual(len(mail.outbox), 0)


class PasswordChangeTests(ApiTestCase):
    def test_change_closes_the_other_sessions_only(self):
        make_user("awa@example.ci")
        laptop = self.login("awa@example.ci").json()
        phone = self.login("awa@example.ci").json()

        self.client.bearer(laptop["access"])
        response = self.client.post(CHANGE_URL, {"current_password": PASSWORD, "password": NEW_PASSWORD})
        self.assertEqual(response.status_code, 204)
        self.assertEqual(self.client.get("/api/v1/me").status_code, 200)
        self.client.bearer(phone["access"])
        self.assertProblem(self.client.get("/api/v1/me"), 401, "session_revoked")

    def test_change_requires_the_current_password(self):
        self.authenticate(make_user("awa@example.ci"))
        response = self.client.post(CHANGE_URL, {"current_password": "pas-le-bon", "password": NEW_PASSWORD})

        self.assertProblem(response, 400, "validation_error")
        self.assertIn("current_password", response.json()["errors"])

    def test_demo_accounts_cannot_change_password(self):
        self.authenticate(make_user("demo@example.ci", is_demo=True))
        response = self.client.post(CHANGE_URL, {"current_password": PASSWORD, "password": NEW_PASSWORD})
        self.assertProblem(response, 403, "demo_restricted")


class PasswordPolicyTests(SimpleTestCase):
    def codes(self, password, user=None):
        try:
            validate_password(password, user)
        except ValidationError as exc:
            return {error.code for error in exc.error_list}
        return set()

    def test_local_patterns_are_refused(self):
        for password in ["abidjan2026", "Babi-225-225", "Cocody@2025", "orange2026!!", "AKWABA-akwaba-2026"]:
            with self.subTest(password=password):
                self.assertIn("password_local_pattern", self.codes(password))

    def test_short_local_password_breaks_two_rules(self):
        self.assertEqual(self.codes("akwaba123") & {"password_too_short", "password_local_pattern"},
                         {"password_too_short", "password_local_pattern"})

    def test_long_passphrases_are_accepted(self):
        for password in [PASSWORD, "abidjan sous la pluie de juin"]:
            with self.subTest(password=password):
                self.assertEqual(self.codes(password), set())

    def test_too_long_password_is_refused(self):
        self.assertIn("password_too_long", self.codes("lagune-" * 20))

    def test_passwords_are_stored_with_argon2id(self):
        self.assertTrue(make_password(PASSWORD).startswith("argon2$argon2id$"))

    def test_password_close_to_shop_name_is_refused(self):
        user = User(email="adjoua@example.ci")
        user.shop_name = "Maison Adjoua"
        self.assertIn("password_too_similar", self.codes("maisonadjoua", user))


class SignupPlanTests(ApiTestCase):
    """Plan choisi à l'inscription (docs/chantier-p4.md §F) ; la confirmation par e-mail est le mode par défaut."""

    def test_default_mode_does_not_reveal_accounts(self):
        from django.conf import settings

        self.assertTrue(settings.SIGNUP_EMAIL_VERIFICATION)

    @override_settings(SIGNUP_EMAIL_VERIFICATION=True)
    def test_plan_travels_in_the_signed_link(self):
        self.client.post(SIGNUP_URL, {**signup_payload("aya@example.ci"), "plan": "pro"})
        response = self.client.post(COMPLETE_URL, {"token": link_token(mail.outbox[0]), "password": PASSWORD})
        self.assertEqual(response.json()["shops"][0]["plan"], "pro")

    @override_settings(SIGNUP_EMAIL_VERIFICATION=False)
    def test_direct_signup_applies_the_plan_and_rejects_unknown_ones(self):
        body = self.client.post(SIGNUP_URL, {**signup_payload("aya@example.ci"), "password": PASSWORD, "plan": "business"}).json()
        self.assertEqual(body["shops"][0]["plan"], "business")
        refused = self.client.post(SIGNUP_URL, {**signup_payload("awa@example.ci"), "password": PASSWORD, "plan": "gratuit-a-vie"})
        self.assertProblem(refused, 400, "validation_error")
