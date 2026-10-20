import re
import unicodedata

from django.core.exceptions import ValidationError


class MaximumLengthValidator:
    """Borne haute : hacher un « mot de passe » d'un mégaoctet coûterait cher au serveur."""

    def __init__(self, max_length=128):
        self.max_length = max_length

    def validate(self, password, user=None):
        if len(password) > self.max_length:
            raise ValidationError(
                "Le mot de passe ne doit pas dépasser %(max_length)d caractères.",
                code="password_too_long",
                params={"max_length": self.max_length},
            )

    def get_help_text(self):
        return f"Au plus {self.max_length} caractères."


# Ce qu'un attaquant essaie en premier contre un marchand ivoirien : la ville, l'opérateur,
# le nom de la plateforme… suivis d'une année ou de « 225 ».
LOCAL_WORDS = (
    "akwaba", "abidjan", "babi", "ivoire", "cotedivoire", "civ", "ci", "elephant", "elephants",
    "cocody", "yopougon", "yop", "plateau", "treichville", "marcory", "abobo", "adjame",
    "koumassi", "portbouet", "bingerville", "bassam", "bouake", "yamoussoukro", "yakro",
    "sanpedro", "korhogo", "daloa", "orange", "wave", "mtn", "moov", "momo", "mobilemoney",
    "attieke", "alloco", "garba", "gbaka", "zouglou", "boutique", "vendeur", "marchand",
    "azerty", "motdepasse", "bonjour", "soleil", "jetaime",
)
LOCAL_PATTERN = re.compile(rf"(?:{'|'.join(sorted(LOCAL_WORDS, key=len, reverse=True))})+")


class LocalPatternValidator:
    """Refuse « mot local évident + chiffres », par exemple abidjan2026, Akwaba@123 ou babi225."""

    def validate(self, password, user=None):
        normalized = unicodedata.normalize("NFKD", password.lower())
        letters_and_digits = "".join(c for c in normalized if c.isalnum() and c.isascii())
        core = letters_and_digits.strip("0123456789")
        if core and LOCAL_PATTERN.fullmatch(core):
            raise ValidationError(
                "Ce mot de passe repose sur un mot trop facile à deviner ici (ville, opérateur, Akwaba…). "
                "Assemblez plutôt plusieurs mots sans rapport entre eux.",
                code="password_local_pattern",
            )

    def get_help_text(self):
        return "Pas de mot local évident suivi de chiffres (abidjan2026, akwaba123…)."
