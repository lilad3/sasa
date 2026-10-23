import json
from unittest import mock

import sentry_sdk
from django.db import IntegrityError
from django.test import SimpleTestCase

from core import sentry
from core.testing import ApiTestCase


def raw_event():
    """Un événement tel que Sentry le fabrique pour une requête qui plante, bourré de données personnelles."""
    return {
        "user": {"id": "42", "email": "adjoua@example.ci", "ip_address": "203.0.113.10"},
        "server_name": "serveur-prive",
        "request": {
            "url": "https://api.akwaba.test/api/v1/auth/login?token=SECRETJETON&email=adjoua@example.ci",
            "method": "POST",
            "query_string": "token=SECRETJETON",
            "cookies": {"akwaba_admin": "SESSIONSECRETE"},
            "data": {"phone": "+225 07 07 00 00 01", "password": "pirogue-lagune-mangue"},
            "env": {"REMOTE_ADDR": "198.51.100.7"},
            "headers": {
                "Authorization": "Bearer JWTSECRET",
                "Cookie": "akwaba_admin=SESSIONSECRETE",
                "X-Akwaba-Bff": "BFFSECRET",
                "X-Client-IP": "203.0.113.10",
                "X-Client-UA": "Mozilla/5.0",
                "X-Device-Id": "dev_telephone_aya_0001",
                "Idempotency-Key": "IDEMPOTENCE",
                "Content-Type": "application/json",
            },
        },
        "exception": {
            "values": [
                {
                    "type": "IntegrityError",
                    "value": 'duplicate key value violates unique constraint\nDETAIL:  Key (email)=(adjoua@example.ci) already exists.',
                    "stacktrace": {"frames": [{"function": "login", "vars": {"password": "pirogue-lagune-mangue"}}]},
                },
                {"type": "ValueError", "value": "numéro 0707000001 invalide pour fatou@example.ci"},
            ]
        },
        "breadcrumbs": {
            "values": [
                {"category": "query", "message": "SELECT * FROM accounts_user WHERE email = 'adjoua@example.ci'"},
                {"category": "logging", "message": "login de adjoua@example.ci"},
                {"category": "console", "message": "x"},
                {"type": "http", "category": "httplib", "data": {"url": "https://x.test/?token=SECRETJETON"}},
                {"category": "navigation", "message": "/api/v1/me"},
            ]
        },
        "tags": {"request_id": "req_abcdefghijklmnop"},
        "extra": {"note": "+2250707000001"},
    }


class ScrubTests(SimpleTestCase):
    def setUp(self):
        self.event = sentry.before_send(raw_event(), {})
        self.dump = json.dumps(self.event, ensure_ascii=False)

    def test_no_personal_value_survives(self):
        for secret in (
            "adjoua@example.ci", "fatou@example.ci", "SECRETJETON", "SESSIONSECRETE", "pirogue-lagune-mangue",
            "JWTSECRET", "BFFSECRET", "203.0.113.10", "198.51.100.7", "dev_telephone_aya_0001", "IDEMPOTENCE",
            "+225 07 07", "0707000001", "+2250707000001", "serveur-prive", "Mozilla",
        ):
            self.assertNotIn(secret, self.dump, secret)

    def test_request_keeps_only_what_helps_debugging(self):
        request = self.event["request"]
        self.assertEqual(request["url"], "https://api.akwaba.test/api/v1/auth/login")
        self.assertEqual(request["method"], "POST")
        self.assertEqual(request["headers"], {"Content-Type": "application/json"})
        for key in ("data", "cookies", "query_string", "env"):
            self.assertNotIn(key, request)
        self.assertNotIn("user", self.event)

    def test_database_error_text_is_replaced_by_its_type(self):
        first, second = self.event["exception"]["values"]
        self.assertEqual(first["value"], "IntegrityError")
        self.assertNotIn("vars", first["stacktrace"]["frames"][0])
        self.assertEqual(second["value"], "numéro [retiré] invalide pour [retiré]")

    def test_sql_logging_and_http_breadcrumbs_are_dropped(self):
        crumbs = self.event["breadcrumbs"]["values"]
        self.assertEqual([c["category"] for c in crumbs], ["navigation"])
        self.assertIsNone(sentry.before_breadcrumb({"category": "query"}, {}))

    def test_request_id_is_kept(self):
        self.assertEqual(self.event["tags"]["request_id"], "req_abcdefghijklmnop")

    def test_scrubbing_an_event_without_request_or_breadcrumbs(self):
        self.assertEqual(sentry.before_send({"message": "ok"}, {})["message"], "ok")


class SentryOffTests(SimpleTestCase):
    def test_without_dsn_sentry_is_never_initialised(self):
        with mock.patch("sentry_sdk.init") as init:
            self.assertFalse(sentry.init_sentry(""))
        init.assert_not_called()
        self.assertFalse(sentry_sdk.get_client().is_active())

    def test_tests_run_with_sentry_off(self):
        # Le .env de test n'a pas de SENTRY_DSN.
        self.assertFalse(sentry_sdk.get_client().is_active())
        sentry.capture_failure("backup_db")  # sans effet, sans erreur


class SentryEndToEndTests(ApiTestCase):
    """Un vrai client Sentry, un faux transport : ce qui « part » ne contient rien de personnel."""

    def setUp(self):
        self.sent = []
        sentry.init_sentry("https://clef@o0.ingest.de.sentry.io/1", "test", transport=self.sent.append)
        self.addCleanup(lambda: sentry_sdk.get_global_scope().set_client(None))

    def test_a_crashing_request_leaves_only_the_request_id(self):
        email = "adjoua@example.ci"
        with mock.patch("accounts.views.MeView.get", side_effect=IntegrityError(f"Key (email)=({email}) already exists.")):
            from core.testing import make_user

            self.authenticate(make_user(email))
            self.client.raise_request_exception = False
            response = self.client.get("/api/v1/me", HTTP_X_REQUEST_ID="req_abcdefghijklmnop")
        sentry_sdk.flush()

        self.assertEqual(response.status_code, 500)
        self.assertTrue(self.sent)
        dump = json.dumps(self.sent, default=str, ensure_ascii=False)
        for secret in (email, "Bearer ", "X-Akwaba-Bff", "203.0.113.10", "dev_telephone_aya_0001"):
            self.assertNotIn(secret, dump, secret)
        self.assertEqual(self.sent[0]["tags"]["request_id"], "req_abcdefghijklmnop")
        self.assertEqual(self.sent[0]["environment"], "test")
        self.assertEqual(self.sent[0]["exception"]["values"][0]["value"], "IntegrityError")
