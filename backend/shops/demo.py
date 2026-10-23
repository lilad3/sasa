"""Données de démonstration : produits d'ici, clients d'ici, 180 jours de commandes en FCFA."""

import random
from datetime import datetime, time, timedelta

from django.db import transaction
from django.utils import timezone
from django.utils.text import slugify

from .delivery import DEFAULT_ZONES
from .models import REFERENCE_ALPHABET, Channel, DeliveryZone, Fulfillment, Order, OrderItem, OrderStatus, PaymentMethod, Product
from .payments import active_methods
from .services import seed_payment_methods, seed_zones

DEMO_DAYS = 180  # deux fois 90 jours : la période précédente existe aussi pour le filtre 90d

# (sku, nom, prix en FCFA, popularité, description)
CATALOG = [
    ("KAR-500", "Beurre de karité brut 500 g", 2500, 9, "Karité non raffiné, pressé à froid dans le Nord."),
    ("SAV-250", "Savon noir artisanal 250 g", 1000, 8, "Savon à l'huile de palme et à la cendre de cabosse."),
    ("CAF-250", "Café robusta de Man, moulu 250 g", 3000, 7, "Torréfaction moyenne, notes de cacao."),
    ("CAC-200", "Cacao pur en poudre 200 g", 2000, 6, "Fèves de Soubré, sans sucre ajouté."),
    ("BIS-500", "Fleurs de bissap séchées 500 g", 1500, 7, "Pour le jus de bissap ou l'infusion."),
    ("GIN-200", "Gingembre en poudre 200 g", 1200, 5, "Séché au soleil puis moulu finement."),
    ("HPR-1L", "Huile de palme rouge 1 L", 1800, 5, "Huile artisanale pour la sauce graine."),
    ("CHO-100", "Chocolat noir 70 % 100 g", 2500, 6, "Tablette fabriquée à Abidjan."),
    ("PAG-BAO", "Pagne baoulé tissé main", 35000, 2, "Bandes tissées à la main, assemblées en pagne de 2 m."),
    ("SAC-RAF", "Cabas en raphia tressé", 12000, 3, "Grand cabas solide, anses en cuir."),
    ("SAN-CUI", "Sandales en cuir", 8500, 3, "Cuir tanné à la main, semelle cousue."),
    ("PAN-ROT", "Panier en rotin avec couvercle", 9000, 2, "Rotin tressé, pour ranger ou offrir."),
]

FIRST_NAMES = [
    "Aya", "Adjoua", "Akissi", "Amenan", "Affoué", "Mariam", "Fatou", "Aminata", "Salimata", "Awa",
    "Christelle", "Marie-Laure", "Grâce", "Nadège", "Koffi", "Kouassi", "Yao", "Konan", "Kouadio",
    "Moussa", "Ibrahim", "Seydou", "Didier", "Serge", "Hervé", "Jean-Marc", "Arnaud", "Wilfried",
]
LAST_NAMES = [
    "Kouassi", "Konan", "N'Guessan", "Kouamé", "Yao", "Koné", "Traoré", "Coulibaly", "Bamba",
    "Diabaté", "Sanogo", "Touré", "Gnagne", "Yapi", "Brou", "Ahoussou", "Assi", "Kacou",
    "Diomandé", "Fofana", "Cissé", "Dosso", "Ehui", "Loukou",
]

# Poids de chaque zone de départ dans les commandes de démo ; une zone ajoutée par la boutique pèse 1.
ZONE_WEIGHTS = [14, 12, 7, 7, 5, 5, 5, 4, 3, 3, 4, 3, 2, 2, 2]
DEFAULT_WEIGHT = {(zone.city, zone.commune): weight for zone, weight in zip(DEFAULT_ZONES, ZONE_WEIGHTS, strict=True)}
PICKUP_SHARE = 0.10  # part des commandes en retrait quand la boutique le propose


def shop_locations(shop):
    """Les zones ACTIVES de la boutique : la démo respecte ses frais et ses délais, jamais une liste à part."""
    zones = DeliveryZone.objects.for_shop(shop)
    return [
        (zone.city, zone.commune, zone.fee, DEFAULT_WEIGHT.get((zone.city, zone.commune), 1), zone.delay_hours)
        for zone in zones.filter(is_active=True) or zones
    ]

# Rayon de chaque produit, affiché en vitrine.
CATEGORY_BY_SKU = {
    "KAR-500": "Beauté", "SAV-250": "Beauté",
    "CAF-250": "Épicerie", "CAC-200": "Épicerie", "BIS-500": "Épicerie", "GIN-200": "Épicerie",
    "HPR-1L": "Épicerie", "CHO-100": "Épicerie",
    "PAG-BAO": "Artisanat", "SAC-RAF": "Artisanat", "SAN-CUI": "Artisanat", "PAN-ROT": "Artisanat",
}

LANDMARKS = [
    "Près de la pharmacie du quartier",
    "Derrière le grand marché",
    "Face à l'église catholique",
    "À côté de la station-service",
    "Près de l'école primaire publique",
    "Après le carrefour, portail bleu",
    "En face du maquis",
    "Près de la mosquée",
    "Au-dessus du salon de coiffure",
    "Deuxième rue après le terminus des gbaka",
]

# (heure, poids) : un pic à la pause de midi, un autre le soir après le travail.
ORDER_HOURS = [
    (7, 2), (8, 3), (9, 4), (10, 5), (11, 6), (12, 9), (13, 9), (14, 6),
    (15, 4), (16, 4), (17, 5), (18, 7), (19, 10), (20, 10), (21, 7), (22, 3),
]

# D'où viennent les commandes d'une boutique ivoirienne : WhatsApp d'abord, puis Facebook et Instagram.
CHANNELS = [
    (Channel.WHATSAPP, 44),
    (Channel.FACEBOOK, 20),
    (Channel.INSTAGRAM, 13),
    (Channel.DIRECT, 11),
    (Channel.TIKTOK, 8),
    (Channel.SMS, 3),
    (Channel.OTHER, 1),
]

PAYMENTS = [
    (PaymentMethod.WAVE, 35),
    (PaymentMethod.ORANGE_MONEY, 30),
    (PaymentMethod.CASH_ON_DELIVERY, 20),
    (PaymentMethod.MTN_MOMO, 10),
    (PaymentMethod.MOOV_MONEY, 5),
]


@transaction.atomic
def generate_demo_data(shop):
    """Remplace les données de démo de la boutique. Les données réelles ne sont jamais touchées."""
    rng = random.Random(shop.pk.int)  # même boutique, mêmes données : la démo est reproductible
    # Un tirage à part pour les canaux : ajouter les canaux ne change aucune autre donnée de démo.
    channel_rng = random.Random(shop.pk.int + 1)
    # Les horaires des étapes ont leur propre tirage : le reste de la démo ne change pas (chantier-p5.md §4.4).
    timing_rng = random.Random(shop.pk.int + 2)
    pickup_rng = random.Random(shop.pk.int + 3)
    # Une boutique sans réglages en reçoit comme une boutique neuve ; la démo n'écrit aucun numéro de réception.
    seed_payment_methods(shop)
    seed_zones(shop)
    locations = shop_locations(shop)
    allowed = set(active_methods(shop))
    payments = [(method, weight) for method, weight in PAYMENTS if method in allowed]
    pickup = shop.pickup_enabled
    Order.objects.for_shop(shop).filter(is_demo=True).delete()
    Product.objects.for_shop(shop).filter(is_demo=True).delete()

    taken = set(Product.objects.for_shop(shop).values_list("sku", flat=True))
    entries = [entry for entry in CATALOG if entry[0] not in taken]
    products = Product.objects.bulk_create(
        [
            Product(
                shop=shop,
                sku=sku,
                slug=slugify(name),
                name=name,
                description=description,
                category=CATEGORY_BY_SKU.get(sku, ""),
                price=price,
                stock=rng.choice([0, 2, 4]) if rng.random() < 0.15 else rng.randint(12, 80),
                is_demo=True,
            )
            for sku, name, price, _, description in entries
        ]
    )
    if not products:
        return {"products": 0, "orders": 0, "days": DEMO_DAYS}
    weights = [entry[3] for entry in entries]
    # Un noyau de 40 habitués qui reviennent souvent, et beaucoup de clients d'une ou deux commandes.
    customers = [_customer(rng, locations) for _ in range(260)]
    loyalty = [6] * 40 + [1] * 220

    today = timezone.localdate()
    tz = timezone.get_current_timezone()
    now = timezone.now()
    orders, items, references = [], [], set()
    for age in range(DEMO_DAYS - 1, -1, -1):
        day = today - timedelta(days=age)
        per_day = 1.6 + 2.4 * (DEMO_DAYS - age) / DEMO_DAYS  # la boutique grandit : ~1,6 → 4 commandes/jour
        per_day *= {5: 1.4, 6: 0.7}.get(day.weekday(), 1.0)  # samedi chargé, dimanche calme
        for _ in range(max(0, round(rng.gauss(per_day, 1.0)))):
            hour = rng.choices([h for h, _ in ORDER_HOURS], weights=[w for _, w in ORDER_HOURS])[0]
            created_at = datetime.combine(day, time(hour, rng.randint(0, 59)), tzinfo=tz)
            if created_at > now:
                created_at = now - timedelta(minutes=rng.randint(1, 90))
            customer = rng.choices(customers, weights=loyalty)[0]
            lines = _lines(rng, products, weights)
            subtotal = sum(product.price * quantity for product, quantity in lines)
            picked_up = pickup and pickup_rng.random() < PICKUP_SHARE
            fee = 0 if picked_up else customer["fee"]
            order = Order(
                shop=shop,
                reference=_reference(rng, references),
                status=_status(rng, age),
                payment_method=rng.choices([p for p, _ in payments], weights=[w for _, w in payments])[0],
                customer_name=customer["name"],
                customer_phone=customer["phone"],
                customer_city="" if picked_up else customer["city"],
                customer_commune="" if picked_up else customer["commune"],
                customer_landmark="" if picked_up else customer["landmark"],
                subtotal=subtotal,
                delivery_fee=fee,
                total=subtotal + fee,
                fulfillment=Fulfillment.PICKUP if picked_up else Fulfillment.DELIVERY,
                promised_hours=None if picked_up else customer["delay"],
                channel=channel_rng.choices([c for c, _ in CHANNELS], weights=[w for _, w in CHANNELS])[0],
                is_demo=True,
                created_at=created_at,
            )
            _stamp(order, timing_rng, now, shop)
            orders.append(order)
            items.extend(
                OrderItem(
                    order=order,
                    product=product,
                    name=product.name,
                    unit_price=product.price,
                    quantity=quantity,
                    line_total=product.price * quantity,
                )
                for product, quantity in lines
            )

    Order.objects.bulk_create(orders, batch_size=500)
    OrderItem.objects.bulk_create(items, batch_size=1000)
    return {"products": len(products), "orders": len(orders), "days": DEMO_DAYS}


def _customer(rng, locations):
    city, commune, fee, _, delay = rng.choices(locations, weights=[loc[3] for loc in locations])[0]
    return {
        "name": f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}",
        "phone": f"+225{rng.choice(['07', '05', '01'])}{rng.randint(0, 99_999_999):08d}",
        "city": city,
        "commune": commune,
        "fee": fee,
        "delay": delay,
        "landmark": rng.choice(LANDMARKS),
    }


def _lines(rng, products, weights):
    wanted = min(rng.choices([1, 2, 3], weights=[55, 32, 13])[0], len(products))
    chosen = set()
    while len(chosen) < wanted:
        chosen.add(rng.choices(range(len(products)), weights=weights)[0])
    lines = []
    for index in sorted(chosen):
        product = products[index]
        quantity = 1 if product.price >= 5000 else rng.choices([1, 2, 3], weights=[60, 30, 10])[0]
        lines.append((product, quantity))
    return lines


def _stamp(order, rng, now, shop):
    """Confirmée dans les heures, expédiée dans la journée, livrée à temps environ 85 fois sur 100."""
    steps = {
        OrderStatus.CONFIRMED: ("confirmed_at",),
        OrderStatus.SHIPPED: ("confirmed_at", "shipped_at"),
        OrderStatus.DELIVERED: ("confirmed_at", "shipped_at", "delivered_at"),
    }.get(order.status, ())
    if not steps:
        return
    promised = order.promised_hours if order.promised_hours is not None else shop.pickup_prep_hours
    total = promised * (rng.uniform(0.35, 0.95) if rng.random() < 0.85 else rng.uniform(1.05, 1.6))
    offsets = {"confirmed_at": rng.uniform(0.2, 3.0), "shipped_at": total * rng.uniform(0.3, 0.6), "delivered_at": total}
    previous = order.created_at
    for field in steps:
        # Jamais dans le futur, toujours après l'étape précédente.
        moment = min(order.created_at + timedelta(hours=offsets[field]), now - timedelta(minutes=1))
        moment = max(moment, previous + timedelta(minutes=1))
        setattr(order, field, moment)
        previous = moment


def _status(rng, age):
    if rng.random() < 0.06:
        return OrderStatus.CANCELLED
    if age >= 5:
        return OrderStatus.DELIVERED
    if age >= 2:
        return rng.choice([OrderStatus.CONFIRMED, OrderStatus.SHIPPED, OrderStatus.DELIVERED])
    return rng.choice([OrderStatus.PENDING, OrderStatus.PENDING, OrderStatus.CONFIRMED])


def _reference(rng, taken):
    while True:
        chars = "".join(rng.choice(REFERENCE_ALPHABET) for _ in range(6))
        reference = f"{chars[:3]}-{chars[3:]}"
        if reference not in taken:
            taken.add(reference)
            return reference
