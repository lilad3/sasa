"""
Zones et frais de livraison, en FCFA. Le serveur seul décide des frais : le front affiche
cette liste, et le checkout recalcule le montant à partir de la zone choisie.
"""

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
        """Le délai de livraison promis, de la commande à la remise au client (docs/chantier-p5.md §4.3)."""
        return promised_hours(self.city)


ZONES = [
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

_BY_PLACE = {(zone.city.casefold(), zone.commune.casefold()): zone for zone in ZONES}


def find_zone(city, commune=""):
    return _BY_PLACE.get(((city or "").strip().casefold(), (commune or "").strip().casefold()))


GRAND_ABIDJAN_HOURS = 24
NEAR_ABIDJAN = {"bingerville", "grand-bassam"}


def promised_hours(city, commune=""):
    """24 h dans le Grand Abidjan, 48 h à Bingerville et Grand-Bassam, 72 h ailleurs (et pour un lieu inconnu)."""
    place = (city or "").strip().casefold()
    if place == "abidjan":
        return GRAND_ABIDJAN_HOURS
    if place in NEAR_ABIDJAN:
        return 48
    return 72
