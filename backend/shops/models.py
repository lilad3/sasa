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
    # Un client devient fidèle à partir de ce nombre de commandes livrées (réglable de 1 à 50).
    loyalty_threshold = models.PositiveSmallIntegerField("seuil de fidélité", default=3)
    # Mode vacances : la vitrine reste visible, mais les commandes sont fermées jusqu'à la date de retour.
    vacation_active = models.BooleanField("en vacances", default=False)
    vacation_message = models.CharField("message de vacances", max_length=280, blank=True)
    vacation_until = models.DateField("date de retour", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name

    def on_vacation(self, today=None):
        """Vrai tant que le mode vacances est actif et que la date de retour n'est pas arrivée."""
        if not self.vacation_active:
            return False
        today = today or timezone.localdate()
        return self.vacation_until is None or today < self.vacation_until


class Membership(models.Model):
    """Le lien entre un compte et une boutique, avec le rôle. Tous les droits partent d'ici."""

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="memberships")
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="memberships")
    role = models.CharField(max_length=10, choices=Role.choices)
    # Droits confiés à un gérant en plus des siens (permissions.GRANTABLE) ; ignorés pour les autres rôles.
    grants = models.JSONField("droits accordés", default=list, blank=True)
    # Avec le droit discounts.give, un gérant n'offre que des remises en %, jusqu'à ce plafond (1 à 90).
    discount_cap_percent = models.PositiveSmallIntegerField("plafond de remise (%)", null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["user", "shop"], name="unique_membership")]

    def __str__(self):
        return f"{self.user} · {self.shop} ({self.get_role_display()})"


class ShopScopedQuerySet(models.QuerySet):
    """Toute lecture de données marchandes passe par for_shop() : pas de filtre écrit à la main dans les vues."""

    def for_shop(self, shop):
        return self.filter(shop=shop)


class ProductStatus(models.TextChoices):
    DRAFT = "draft", "Brouillon"
    ACTIVE = "active", "Actif"
    ARCHIVED = "archived", "Archivé"


class Condition(models.TextChoices):
    NEW = "new", "Neuf"
    REFURBISHED = "refurbished", "Reconditionné"
    USED = "used", "Occasion"


class SoldBy(models.TextChoices):
    PIECE = "piece", "Pièce"
    KG = "kg", "Kilo"
    SACHET = "sachet", "Sachet"
    TAS = "tas", "Tas"
    LITRE = "litre", "Litre"


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
    # Sous ce seuil (inclus), le produit apparaît dans « Bientôt en rupture » et la vitrine annonce « derniers articles ».
    low_stock_threshold = models.PositiveIntegerField("seuil d'alerte de stock", default=5)
    # Statut de la fiche (docs/chantier-a2-produits.md §A2.1) : seul « active » est visible et commandable.
    status = models.CharField("statut", max_length=10, choices=ProductStatus.choices, default=ProductStatus.ACTIVE)
    # Ancienne colonne, gelée le temps du déploiement (supprimée par une migration ultérieure) : le code ne lit que `status`.
    legacy_is_active = models.BooleanField(default=True, db_column="is_active")
    # Prix avant réduction : affiché barré, jamais dans un calcul. Strictement supérieur au prix.
    compare_at_price = models.PositiveIntegerField("prix barré", null=True, blank=True)
    # Coût d'achat : réservé au propriétaire (droit products.cost), jamais publié.
    cost = models.PositiveIntegerField("coût d'achat", null=True, blank=True)
    # Vendre en rupture : la part au-delà du stock est une précommande, livrée sous `backorder_days`.
    allow_backorder = models.BooleanField("précommande", default=False)
    backorder_days = models.PositiveSmallIntegerField("délai de précommande (jours)", null=True, blank=True)
    # Plafond des unités en précommande en cours : la commande se passe sans compte.
    backorder_limit = models.PositiveIntegerField("plafond de précommandes", default=20)
    # Champs par secteur (tous facultatifs, listes fermées ; le serveur n'en dépend pas).
    condition = models.CharField("état", max_length=12, choices=Condition.choices, blank=True)
    warranty_months = models.PositiveSmallIntegerField("garantie (mois)", null=True, blank=True)
    sold_by = models.CharField("unité de vente", max_length=8, choices=SoldBy.choices, default=SoldBy.PIECE)
    one_of_a_kind = models.BooleanField("pièce unique", default=False)
    made_to_order = models.BooleanField("fabriqué sur commande", default=False)
    bulky = models.BooleanField("gros colis", default=False)
    image_url = models.URLField(blank=True)
    # Le produit de la couverture de la vitrine, choisi par la boutique (docs/chantier-p5.md §2.1).
    is_featured = models.BooleanField("à la une", default=False)
    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["shop", "sku"], name="unique_product_sku"),
            models.UniqueConstraint(fields=["shop", "slug"], name="unique_product_slug"),
            models.UniqueConstraint(fields=["shop"], condition=models.Q(is_featured=True), name="one_featured_product_per_shop"),
            models.CheckConstraint(condition=models.Q(compare_at_price__isnull=True) | models.Q(compare_at_price__gt=models.F("price")), name="compare_at_above_price"),
        ]
        indexes = [models.Index(fields=["shop", "status"], name="product_shop_status")]

    def __str__(self):
        return self.name

    @property
    def is_active(self):
        """Compatibilité des réponses d'API : lecture seule, dérivée du statut."""
        return self.status == ProductStatus.ACTIVE

    @property
    def orderable(self):
        return self.status == ProductStatus.ACTIVE and (self.stock > 0 or self.allow_backorder)

    def save(self, *args, **kwargs):
        # La colonne gelée suit le statut : un ancien code encore en ligne pendant le déploiement ne montre pas un brouillon.
        self.legacy_is_active = self.status == ProductStatus.ACTIVE
        if kwargs.get("update_fields") is not None and "status" in kwargs["update_fields"]:
            kwargs["update_fields"] = {*kwargs["update_fields"], "legacy_is_active"}
        super().save(*args, **kwargs)


class OrderStatus(models.TextChoices):
    PENDING = "pending", "En attente"
    CONFIRMED = "confirmed", "Confirmée"
    SHIPPED = "shipped", "Expédiée"
    DELIVERED = "delivered", "Livrée"
    CANCELLED = "cancelled", "Annulée"


# Le champ horaire que remplit chaque statut.
STATUS_TIMESTAMP = {
    OrderStatus.CONFIRMED: "confirmed_at",
    OrderStatus.SHIPPED: "shipped_at",
    OrderStatus.DELIVERED: "delivered_at",
}

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


class Channel(models.TextChoices):
    """D'où vient une commande (lien ?via= de la vitrine). Liste fermée : jamais de texte libre."""

    WHATSAPP = "whatsapp", "WhatsApp"
    FACEBOOK = "facebook", "Facebook"
    INSTAGRAM = "instagram", "Instagram"
    TIKTOK = "tiktok", "TikTok"
    SMS = "sms", "SMS"
    DIRECT = "direct", "Direct"
    OTHER = "autre", "Autre"


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
    # Remise d'un code personnel : total = sous-total − remise + livraison (docs/chantier-p5.md §1.1).
    discount = models.ForeignKey("Discount", on_delete=models.SET_NULL, null=True, blank=True, related_name="orders")
    discount_code = models.CharField(max_length=9, blank=True)
    discount_amount = models.PositiveIntegerField(default=0)
    delivery_fee = models.PositiveIntegerField(default=0)
    total = models.PositiveIntegerField()
    channel = models.CharField("canal", max_length=10, choices=Channel.choices, default=Channel.DIRECT)
    is_demo = models.BooleanField(default=False)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    # Remplis au passage dans chaque statut, une seule fois (docs/chantier-p5.md §4.2).
    confirmed_at = models.DateTimeField(null=True, blank=True)
    shipped_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

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
    # La part prélevée sur le stock ; le reste est de la précommande, promise sous `backorder_days` (copié à la commande).
    from_stock = models.PositiveSmallIntegerField(default=0)
    backorder_days = models.PositiveSmallIntegerField(default=0)

    def __str__(self):
        return f"{self.quantity} × {self.name}"


class OrderNote(models.Model):
    """Note interne sur une commande (« client injoignable, rappeler à 18 h »). Le client ne la voit jamais."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    order = models.ForeignKey(Order, on_delete=models.CASCADE, related_name="notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    # Copie du nom : la note reste signée même si le compte disparaît.
    author_name = models.CharField(max_length=160)
    body = models.CharField(max_length=500)
    created_at = models.DateTimeField(default=timezone.now)

    class Meta:
        ordering = ["created_at"]


class NoteAudience(models.TextChoices):
    ALL = "all", "Toute l'équipe"
    MANAGERS = "managers", "Les gérants"
    SELLERS = "sellers", "Les vendeurs"
    MEMBER = "member", "Une personne"


class TeamNote(models.Model):
    """
    Le mot du patron : une consigne du propriétaire ou d'un gérant à son équipe.
    Chaque destinataire a un accusé de lecture, créé à l'envoi : l'auteur voit qui a lu, et quand.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="team_notes")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    author_name = models.CharField(max_length=160)
    author_role = models.CharField(max_length=10, choices=Role.choices)
    body = models.TextField(max_length=1000)
    urgent = models.BooleanField(default=False)
    audience = models.CharField(max_length=10, choices=NoteAudience.choices)
    # « goal » : message écrit par Akwaba quand le propriétaire fixe l'objectif du mois.
    kind = models.CharField(max_length=10, choices=[("message", "Message"), ("goal", "Objectif")], default="message")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    # Retirée par son auteur ou le propriétaire : elle ne s'affiche plus en haut des pages.
    withdrawn_at = models.DateTimeField(null=True, blank=True)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]


class TeamNoteReceipt(models.Model):
    note = models.ForeignKey(TeamNote, on_delete=models.CASCADE, related_name="receipts")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="team_note_receipts")
    read_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["note", "user"], name="unique_note_receipt")]


class ApiKey(models.Model):
    """
    Clé de l'API publique (contrat §2.12). On garde l'identifiant en clair, pour la retrouver,
    et l'empreinte SHA-256 du secret : la clé complète n'apparaît qu'une fois, à sa création.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="api_keys")
    name = models.CharField(max_length=60)
    key_id = models.CharField(max_length=8, unique=True)
    secret_hash = models.CharField(max_length=64)
    scopes = models.JSONField(default=list)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)
    expires_at = models.DateTimeField(null=True, blank=True)
    last_used_at = models.DateTimeField(null=True, blank=True)
    last_used_ip = models.GenericIPAddressField(null=True, blank=True)
    revoked_at = models.DateTimeField(null=True, blank=True)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.name} (akw_live_{self.key_id}_…)"


def new_public_id():
    return secrets.token_urlsafe(16)


class Customer(models.Model):
    """
    Un client de la boutique, reconnu à son téléphone. Ses chiffres se calculent sur ses commandes ;
    la fiche garde ce qui n'en découle pas : le nom de fidèle donné à la main par le propriétaire.
    Le numéro ne sort jamais dans une adresse : la fiche se désigne par `public_id`, aléatoire.
    """

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="customers")
    phone = models.CharField(max_length=16)
    public_id = models.CharField(max_length=32, unique=True, default=new_public_id)
    name = models.CharField(max_length=120, blank=True)
    is_vip = models.BooleanField("fidèle nommé", default=False)
    vip_set_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    vip_set_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["shop", "phone"], name="unique_customer_phone")]

    def __str__(self):
        return self.name or self.public_id


class DiscountKind(models.TextChoices):
    PERCENT = "percent", "En %"
    AMOUNT = "amount", "En francs"


class Discount(models.Model):
    """
    Un code de réduction personnel, offert à un client et valable avec son seul téléphone.
    Le code seul ne sert à rien : il faut aussi le numéro exact du client (docs/chantier-p5.md §1.2).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="discounts")
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="discounts")
    code = models.CharField(max_length=9)
    kind = models.CharField(max_length=10, choices=DiscountKind.choices)
    value = models.PositiveIntegerField()
    ends_on = models.DateField("valable jusqu'au")
    max_uses = models.PositiveSmallIntegerField(default=1)
    uses = models.PositiveSmallIntegerField(default=0)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_by_name = models.CharField(max_length=160, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    revoked_at = models.DateTimeField(null=True, blank=True)
    revoked_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["shop", "code"], name="unique_discount_code")]

    def __str__(self):
        return self.code

    def status(self, today=None):
        """Annulée › utilisée › expirée › en cours : calculé à chaque lecture, jamais stocké."""
        if self.revoked_at is not None:
            return "revoked"
        if self.uses >= self.max_uses:
            return "used"
        if self.ends_on < (today or timezone.localdate()):
            return "expired"
        return "active"

    def amount_for(self, subtotal):
        """La remise sur le sous-total des articles, jamais sur la livraison, arrondie au franc inférieur."""
        if self.kind == DiscountKind.PERCENT:
            return subtotal * self.value // 100
        return min(self.value, subtotal)


class ShopGoal(models.Model):
    """L'objectif de chiffre d'affaires d'un mois, fixé par le propriétaire."""

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="goals")
    month = models.DateField(help_text="Le 1er du mois.")
    amount = models.PositiveBigIntegerField(help_text="En FCFA.")
    set_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    set_by_name = models.CharField(max_length=160)
    set_by_role = models.CharField(max_length=10, choices=Role.choices, default=Role.OWNER)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        constraints = [models.UniqueConstraint(fields=["shop", "month"], name="unique_goal_month")]


class ShopLogo(models.Model):
    """
    Le logo, réencodé en PNG par le serveur (sans métadonnées). Gardé en base, à part de la boutique :
    aucun nom de fichier venu de l'extérieur, et les lectures de Shop ne chargent pas l'image.
    """

    shop = models.OneToOneField(Shop, on_delete=models.CASCADE, related_name="logo")
    image = models.BinaryField()
    version = models.CharField(max_length=12)
    updated_at = models.DateTimeField(auto_now=True)


class ProductPhoto(models.Model):
    """
    Une photo de produit, réencodée en WebP par le serveur (docs/chantier-p5.md §2.2). Trois au plus
    par produit : la contrainte (produit, rang) empêche deux envois simultanés de dépasser la limite.
    """

    MAX_PER_PRODUCT = 3

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="product_photos")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="photos")
    position = models.PositiveSmallIntegerField()
    image = models.BinaryField()
    version = models.CharField(max_length=12)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    created_at = models.DateTimeField(default=timezone.now)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        ordering = ["position"]
        constraints = [models.UniqueConstraint(fields=["product", "position"], name="unique_photo_position")]


class StorefrontVersion(models.Model):
    """
    Une version de la vitrine (docs/chantier-p5.md §3.3) : la configuration choisie dans « Ma boutique ».
    Un seul brouillon et une seule version en ligne par boutique ; les anciennes sont archivées,
    dans la limite du plan.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Brouillon"
        PUBLISHED = "published", "En ligne"
        ARCHIVED = "archived", "Archivée"

    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="storefront_versions")
    number = models.PositiveIntegerField()
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    config = models.JSONField()
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, related_name="+")
    created_by_name = models.CharField(max_length=150, blank=True)
    updated_at = models.DateTimeField(auto_now=True)
    published_at = models.DateTimeField(null=True, blank=True)
    published_by_name = models.CharField(max_length=150, blank=True)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        ordering = ["-number"]
        constraints = [
            models.UniqueConstraint(fields=["shop", "number"], name="unique_storefront_version_number"),
            models.UniqueConstraint(fields=["shop"], condition=models.Q(status="draft"), name="one_storefront_draft"),
            models.UniqueConstraint(fields=["shop"], condition=models.Q(status="published"), name="one_storefront_published"),
        ]


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


class ProductTag(models.Model):
    """Une étiquette de rangement (docs/chantier-a2-produits.md §A2.6). `key` sert à comparer : sans accents ni casse."""

    MAX_PER_PRODUCT = 10

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="product_tags")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="tags")
    label = models.CharField(max_length=30)
    key = models.CharField(max_length=60)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        ordering = ["key"]
        constraints = [models.UniqueConstraint(fields=["product", "key"], name="unique_product_tag")]
        indexes = [models.Index(fields=["shop", "key"], name="tag_shop_key")]


class StockReason(models.TextChoices):
    INITIAL = "initial", "Stock de départ"
    RECEIVED = "received", "Réception"
    SOLD = "sold", "Vendu"
    CANCELLED = "cancelled", "Annulation"
    RETURNED = "returned", "Retour client"
    DAMAGED = "damaged", "Casse ou perte"
    CORRECTION = "correction", "Correction"
    IMPORT = "import", "Import"


class StockMovement(models.Model):
    """
    Une variation de stock, en ajout seul (docs/chantier-a2-produits.md §A2.7). Invariant : pour tout produit,
    stock == somme des delta. Un produit qui a un historique autre que « initial » ne se supprime pas : on l'archive.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey(Shop, on_delete=models.CASCADE, related_name="stock_movements")
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="movements")
    # P08 en fera une clé étrangère vers sa table de variantes (la contrainte unique des ventes devra alors l'inclure).
    variant_id = models.UUIDField(null=True, blank=True)
    delta = models.IntegerField()
    stock_after = models.PositiveIntegerField()
    reason = models.CharField(max_length=12, choices=StockReason.choices)
    order = models.ForeignKey(Order, on_delete=models.SET_NULL, null=True, blank=True, related_name="stock_movements")
    order_reference = models.CharField(max_length=7, blank=True)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    actor_name = models.CharField(max_length=160, blank=True)
    note = models.CharField(max_length=200, blank=True)
    created_at = models.DateTimeField(default=timezone.now)

    objects = ShopScopedQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["shop", "product", "-created_at"], name="movement_product_date")]
        constraints = [
            models.CheckConstraint(condition=~models.Q(delta=0), name="movement_delta_not_zero"),
            # Une vente et une remise au plus par ligne de commande.
            models.UniqueConstraint(
                fields=["order", "product", "reason"],
                condition=models.Q(reason__in=["sold", "cancelled"]),
                name="unique_order_product_reason",
            ),
        ]

    def save(self, *args, **kwargs):
        if not self._state.adding:
            raise RuntimeError("Un mouvement de stock ne se modifie pas.")
        super().save(*args, **kwargs)
