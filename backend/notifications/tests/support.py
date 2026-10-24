import time
import uuid

from django.core import mail
from django.core.mail.backends.locmem import EmailBackend as LocmemBackend
from django.test import override_settings

from core.testing import ApiTestCase, make_member, make_shop
from shops.models import Membership, Product

BASE = "/api/v1/storefront/maison-adjoua"
NOTIFS = "/api/v1/shops/maison-adjoua/notifications"

# Un test d'e-mails active l'envoi ; le backend de test est « locmem » (mail.outbox).
enabled = override_settings(NOTIFICATIONS_ENABLED=True)


class BrokenBackend(LocmemBackend):
    """Un serveur d'e-mail en panne : la connexion échoue."""

    opened = 0

    def open(self):
        type(self).opened += 1
        raise ConnectionRefusedError("jean.dupont@exemple.ci refusé")


class SlowClock:
    """Une horloge que l'envoi fait avancer : chaque message « coûte » `step` secondes."""

    now = 0.0
    step = 0.0


class SlowBackend(LocmemBackend):
    def send_messages(self, messages):
        SlowClock.now += SlowClock.step
        return super().send_messages(messages)


def fake_monotonic():
    return SlowClock.now


@enabled
class NotifTestCase(ApiTestCase):
    def setUp(self):
        mail.outbox.clear()
        BrokenBackend.opened = 0
        SlowClock.now, SlowClock.step = 0.0, 0.0
        self.shop = make_shop("maison-adjoua", "Maison Adjoua")
        self.shop.plan = "business"
        self.shop.save()
        self.owner = make_member("adjoua@exemple.ci", self.shop, "owner", first_name="Adjoua")
        self.manager = make_member("fatou@exemple.ci", self.shop, "manager", first_name="Fatou")
        self.seller = make_member("koffi@exemple.ci", self.shop, "seller", first_name="Koffi")
        self.karite = Product.objects.create(
            shop=self.shop, sku="KAR", slug="karite", name="Beurre de karité brut 500 g", price=2500, stock=10, low_stock_threshold=5
        )
        self.savon = Product.objects.create(
            shop=self.shop, sku="SAV", slug="savon", name="Savon noir artisanal 250 g", price=1500, stock=3, low_stock_threshold=2
        )

    def order_body(self, product=None, quantity=2, **overrides):
        product = product or self.karite
        body = {
            "items": [{"product_id": str(product.pk), "quantity": quantity}],
            "customer": {"name": "Aya Koné", "phone": "07 07 12 34 56", "city": "Abidjan", "commune": "Cocody", "landmark": "Près de la pharmacie"},
            "payment_method": "cash_on_delivery",
            "expected_total": quantity * product.price + 1500,
            "website": "",
        }
        body.update(overrides)
        return body

    def place(self, body=None, key=None):
        """Passe une commande depuis la vitrine et exécute les callbacks de fin de transaction."""
        with self.captureOnCommitCallbacks(execute=True):
            return self.client.post(f"{BASE}/orders", body or self.order_body(), HTTP_IDEMPOTENCY_KEY=str(key or uuid.uuid4()))

    def membership(self, user):
        return Membership.objects.get(user=user, shop=self.shop)

    def recipients_of(self, messages=None):
        return sorted(address for message in (messages if messages is not None else mail.outbox) for address in message.to)

    def age_windows(self, minutes=11):
        from datetime import timedelta

        from django.utils import timezone

        from notifications.models import NotificationState

        NotificationState.objects.exclude(last_sent_at=None).update(last_sent_at=timezone.now() - timedelta(minutes=minutes))
