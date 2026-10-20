import secrets
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    OWNER = "owner", "Propriétaire"
    MANAGER = "manager", "Gérant"
    SELLER = "seller", "Vendeur"


class Plan(models.TextChoices):
    FREE = "free", "Gratuit"
    PRO = "pro", "Pro"
    BUSINESS = "business", "Business"


class Accent(models.TextChoices):
    """
    Couleur de la vitrine. Une liste fermée plutôt qu'un code couleur libre : le front associe
    chaque nom à une couleur lisible de sa palette, et aucune valeur saisie n'atterrit dans du CSS.
    """

    ORANGE = "orange", "Orange"
    INDIGO = "indigo", "Indigo"
    OCRE = "ocre", "Ocre"
    LAGUNE = "lagune", "Lagune"
    CORAIL = "corail", "Corail"


class Shop(models.Model):
    """Une boutique Akwaba. Un compte peut en avoir plusieurs, avec un rôle dans chacune."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    slug = models.SlugField(max_length=60, unique=True)
    name = models.CharField(max_length=60)
    plan = models.CharField(max_length=10, choices=Plan.choices, default=Plan.FREE)
    # Vitrine publique
    description = models.CharField(max_length=280, blank=True)
    city = models.CharField("ville", max_length=60, blank=True)
    accent = models.CharField("couleur de la vitrine", max_length=10, choices=Accent.choices, default=Accent.ORANGE)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Membership(models.Model):
    """Le lien entre un compte et une boutique, avec le rôle. Tous les droits partent d'ici."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=Role.choices)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "shop"], name="unique_membership")]

    def __str__(self):
        return f"{self.user} · {self.shop} ({self.get_role_display()})"


class ShopScopedQuerySet(models.QuerySet):
    """Toute lecture de données marchandes passe par for_shop() : pas de filtre écrit à la main dans les vues."""

    def for_shop(self, shop):
        return self.filter(shop=shop)


class Product(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="products")
    sku = models.CharField(max_length=40)
    slug = models.SlugField(max_length=80)
    name = models.CharField(max_length=120)
    description = models.TextField(max_length=2000, blank=True)
    category = models.CharField("catégorie", max_length=40, blank=True)
    price = models.PositiveIntegerField(help_text="En FCFA, sans centimes.")
    stock = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)
    image_url = models.URLField(blank=True)
    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["shop", "sku"], name="unique_product_sku"),
            models.UniqueConstraint(fields=["shop", "slug"], name="unique_product_slug"),
        ]

    def __str__(self):
        return self.name


class OrderStatus(models.TextChoices):
    PENDING = "pending", "En attente"
    CONFIRMED = "confirmed", "Confirmée"
    SHIPPED = "shipped", "Expédiée"
    DELIVERED = "delivered", "Livrée"
    CANCELLED = "cancelled", "Annulée"


ORDER_TRANSITIONS = {
    OrderStatus.PENDING: {OrderStatus.CONFIRMED, OrderStatus.CANCELLED},
    OrderStatus.CONFIRMED: {OrderStatus.SHIPPED, OrderStatus.CANCELLED},
    OrderStatus.SHIPPED: {OrderStatus.DELIVERED},
    OrderStatus.DELIVERED: set(),
    OrderStatus.CANCELLED: set(),
}


class PaymentMethod(models.TextChoices):
    CASH_ON_DELIVERY = "cash_on_delivery", "Paiement à la livraison"
    ORANGE_MONEY = "orange_money", "Orange Money"
    MTN_MOMO = "mtn_momo", "MTN MoMo"
    MOOV_MONEY = "moov_money", "Moov Money"
    WAVE = "wave", "Wave"


# Sans 0/O, 1/I/L ni U : une référence se dicte au téléphone sans confusion.
REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789"


def new_reference():
    chars = [secrets.choice(REFERENCE_ALPHABET) for _ in range(6)]
    return f"{''.join(chars[:3])}-{''.join(chars[3:])}"


class Order(models.Model):
    """
    Une commande. La référence est aléatoire et non séquentielle : un client ne peut pas
    en déduire le volume de ventes de la boutique.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="orders")
    reference = models.CharField(max_length=7, default=new_reference)
    status = models.CharField(max_length=10, choices=OrderStatus.choices, default=OrderStatus.PENDING)
    payment_method = models.CharField(max_length=20, choices=PaymentMethod.choices)
    customer_name = models.CharField(max_length=120)
    customer_phone = models.CharField(max_length=16, help_text="Format +225XXXXXXXXXX.")
    customer_city = models.CharField(max_length=60)
    customer_commune = models.CharField(max_length=60, blank=True)
    customer_landmark = models.CharField("repère", max_length=160, blank=True)
    subtotal = models.PositiveIntegerField()
    delivery_fee = models.PositiveIntegerField(default=0)
    total = models.PositiveIntegerField()
    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["shop", "reference"], name="unique_order_reference")]
        indexes = [
            models.Index(fields=["shop", "created_at"]),
            models.Index(fields=["shop", "status"]),
        ]

    def __str__(self):
        return self.reference

    def can_become(self, status):
        return status in ORDER_TRANSITIONS[self.status]


class OrderItem(models.Model):
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="items")
    product = models.ForeignKey(Product, on_delete=models.SET_NULL, null=True, related_name="order_items")
    name = models.CharField(max_length=120, help_text="Copie du nom au moment de la commande.")
    unit_price = models.PositiveIntegerField()
    quantity = models.PositiveSmallIntegerField()
    line_total = models.PositiveIntegerField()

    def __str__(self):
        return f"{self.quantity} × {self.name}"


class IdempotencyRecord(models.Model):
    """
    Une commande déjà traitée pour une clé Idempotency-Key, gardée 24 h.

    Sur un réseau mobile instable, le navigateur peut renvoyer la même commande. Avec la même clé
    et le même contenu, on renvoie la réponse déjà donnée au lieu de créer une deuxième commande.
    """

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="idempotency_records")
    key = models.UUIDField()
    request_hash = models.CharField(max_length=64, help_text="SHA-256 du contenu validé de la commande.")
    response = models.JSONField()
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["shop", "key"], name="unique_idempotency_key")]
        indexes = [models.Index(fields=["created_at"])]
