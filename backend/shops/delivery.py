"""
Zones et frais de livraison, en FCFA, propres à chaque boutique (docs/chantier-a2-paiements-livraison.md §1.2).
Le serveur seul décide des frais : le front affiche les zones actives, et le checkout recalcule le montant
à partir de la zone choisie.

DEFAULT_ZONES n'est que la liste de départ d'une NOUVELLE boutique : elle est copiée une fois à la création.
"""

import re
import unicodedata
from dataclasses import dataclass


@dataclass(frozen=True)
class Zone:
    city: str
    commune: str
    fee: int

    @property
    def id(self):
        return f"{self.city}|{self.commune}" if self.commune else self.city

    @property
    def label(self):
        return f"{self.commune}, {self.city}" if self.commune else self.city

    @property
    def delay_hours(self):
        return promised_hours(self.city)


DEFAULT_ZONES = [
    Zone("Abidjan", "Cocody", 1500),
    Zone("Abidjan", "Yopougon", 1500),
    Zone("Abidjan", "Marcory", 1500),
    Zone("Abidjan", "Abobo", 1500),
    Zone("Abidjan", "Plateau", 1500),
    Zone("Abidjan", "Treichville", 1500),
    Zone("Abidjan", "Koumassi", 1500),
    Zone("Abidjan", "Port-Bouët", 2000),
    Zone("Bingerville", "", 2000),
    Zone("Grand-Bassam", "", 2500),
    Zone("Bouaké", "", 3000),
    Zone("Yamoussoukro", "", 3000),
    Zone("Daloa", "", 3000),
    Zone("San-Pédro", "", 3500),
    Zone("Korhogo", "", 3500),
]

GRAND_ABIDJAN_HOURS = 24
NEAR_ABIDJAN = {"bingerville", "grand-bassam"}


def promised_hours(city, commune=""):
    """Délai de départ d'une zone : 24 h dans le Grand Abidjan, 48 h à Bingerville et Grand-Bassam, 72 h ailleurs."""
    place = (city or "").strip().casefold()
    if place == "abidjan":
        return GRAND_ABIDJAN_HOURS
    if place in NEAR_ABIDJAN:
        return 48
    return 72


def zone_key(city, commune=""):
    """Clé de doublon : minuscules, sans accents, tirets et espaces écrasés. « Port-Bouët » = « port bouet »."""

    def clean(text):
        text = unicodedata.normalize("NFKD", text or "")
        text = "".join(char for char in text if not unicodedata.combining(char))
        return re.sub(r"[\s\-_'’]+", " ", text.casefold()).strip()

    return f"{clean(city)}|{clean(commune)}"


def find_zone(shop, city, commune=""):
    """La zone ACTIVE de cette boutique (et d'aucune autre) qui correspond au lieu, ou None."""
    from .models import DeliveryZone

    return DeliveryZone.objects.for_shop(shop).filter(is_active=True, key=zone_key(city, commune)).first()
