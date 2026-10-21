"""Outils de test : un client qui se présente comme le BFF Next, et quelques fabriques."""

from datetime import timedelta

from django.conf import settings
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient, APITestCase

CLIENT_IP = "203.0.113.10"
CLIENT_UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36"
DEVICE_ID = "dev_telephone_aya_0001"
PASSWORD = "pirogue-lagune-mangue"
LOGIN_URL = "/api/v1/auth/login"
REFRESH_URL = "/api/v1/auth/token/refresh"


class BffClient(APIClient):
    def __init__(self, **defaults):
        defaults.setdefault("HTTP_X_AKWABA_BFF", settings.BFF_SHARED_SECRET)
        defaults.setdefault("HTTP_X_CLIENT_IP", CLIENT_IP)
        defaults.setdefault("HTTP_X_CLIENT_UA", CLIENT_UA)
        defaults.setdefault("HTTP_X_DEVICE_ID", DEVICE_ID)
        super().__init__(**defaults)

    def bearer(self, access):
        self.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")


# Argon2 est lent exprès : en production c'est voulu, dans les tests d'API c'est du temps perdu.
# La vraie configuration est vérifiée à part (accounts.tests.test_signup_and_passwords).
@override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"])
class ApiTestCase(APITestCase):
    client_class = BffClient

    def assertProblem(self, response, status_code, code):
        self.assertEqual(response.status_code, status_code, response.content)
        self.assertEqual(response["Content-Type"], "application/problem+json")
        self.assertEqual(response.json()["code"], code)

    def login(self, email, password=PASSWORD, **extra):
        return self.client.post(LOGIN_URL, {"email": email, "password": password, **extra})

    def refresh(self, refresh_token):
        return self.client.post(REFRESH_URL, {"refresh": refresh_token})

    def authenticate(self, user, **session_options):
        """Ouvre une session sans passer par le hachage du mot de passe (tests plus rapides)."""
        from accounts.sessions import open_session

        _, tokens = open_session(user, None, **session_options)
        self.client.bearer(tokens["access"])
        return tokens


def without_request_id(response):
    return {key: value for key, value in response.json().items() if key != "request_id"}


def make_user(email, password=PASSWORD, **fields):
    from accounts.models import User

    return User.objects.create_user(email=email, password=password, **fields)


def make_member(email, shop, role, **fields):
    from shops.models import Membership

    user = make_user(email, **fields)
    Membership.objects.create(user=user, shop=shop, role=role)
    return user


def make_shop(slug, name=None):
    from shops.models import Shop

    return Shop.objects.create(slug=slug, name=name or slug.replace("-", " ").title())


def make_order(shop, *, total=10_000, status="pending", age=None, phone="+2250707000001", product=None, quantity=1, **fields):
    from shops.models import Order, OrderItem

    defaults = {"payment_method": "wave", "customer_name": "Aya Koné", "customer_city": "Abidjan", "customer_commune": "Cocody"}
    order = Order.objects.create(
        shop=shop,
        status=status,
        customer_phone=phone,
        subtotal=total,
        total=total,
        created_at=timezone.now() - (age or timedelta()),
        **{**defaults, **fields},
    )
    if product is not None:
        OrderItem.objects.create(
            order=order,
            product=product,
            name=product.name,
            unit_price=product.price,
            quantity=quantity,
            line_total=product.price * quantity,
        )
    return order


def enable_mfa(user):
    """Active la 2FA avec un secret connu du test. Renvoie (secret, codes de secours)."""
    import pyotp

    from accounts import mfa

    secret = pyotp.random_base32()
    return secret, mfa.enable_with_secret(user, secret)


def totp(secret, steps_ahead=0):
    """Code TOTP valable maintenant ; steps_ahead=1 donne celui du pas suivant (toléré par le serveur)."""
    import time

    import pyotp

    generator = pyotp.TOTP(secret)
    return generator.generate_otp(int(time.time()) // generator.interval + steps_ahead)


def wrong_code(secret):
    """Un code à 6 chiffres qui n'est valable dans aucune des fenêtres acceptées par le serveur."""
    valid = {totp(secret, steps) for steps in (-1, 0, 1)}
    return next(code for code in ("000000", "111111", "222222", "333333") if code not in valid)
