"""
La liste des Paramètres : une ligne par rubrique, avec son état (docs/chantier-a2-parametres.md §3.2 et §4.1) et la page
« Qui peut faire quoi ». Le texte de chaque état est fabriqué ici, une seule fois : le front l'affiche tel quel.
Rien n'y figure qui soit du chiffre d'affaires, un nom ou un téléphone de client, un e-mail, un nom de clé ou un appareil.
"""

from rest_framework.response import Response

from accounts.models import TOTPDevice
from core.ratelimit import enforce

from . import plans
from .models import ApiKey, Membership, Product, Role, ShopLogo
from .permissions import ANY_MEMBER, ShopScopedView, permissions_matrix

SUMMARY_LIMIT = (120, 60)  # par membre
# Rubriques dont la page existe. Les autres (paiements, livraison, notifications…) n'en font jamais partie tant que leur
# chantier ne l'a pas ajoutée : ni ligne, ni mot-clé, même pour le propriétaire.
IMPLEMENTED = ("general", "forfait", "utilisateurs", "clients", "securite", "avance")
NEAR_LIMIT = 0.9
MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."]


def normal(text):
    return {"text": text, "tone": "normal"}


def attention(text):
    return {"text": text, "tone": "attention"}


def francs(amount):
    """Même chaîne que `formatFcfa` du front (Intl fr-FR) : « 9 900 F », milliers séparés par U+202F. Le front fait foi."""
    return f"{amount:,}".replace(",", " ") + " F"


def count(number, one, many):
    return f"{number} {one if number == 1 else many}"


def day_label(day):
    return f"{day.day} {MONTHS[day.month - 1]}"


class Facts:
    """Les chiffres dont les états ont besoin, lus une fois chacun (jamais une requête par membre)."""

    def __init__(self, shop, membership):
        self.shop = shop
        self.membership = membership

    def _cached(self, name, compute):
        if name not in self.__dict__:
            self.__dict__[name] = compute()
        return self.__dict__[name]

    @property
    def members(self):
        return self._cached("_members", lambda: Membership.objects.filter(shop=self.shop).count())

    @property
    def pending_members(self):
        return self._cached(
            "_pending", lambda: Membership.objects.filter(shop=self.shop, user__must_change_password=True).count()
        )

    @property
    def products(self):
        return self._cached("_products", lambda: Product.objects.for_shop(self.shop).count())

    @property
    def active_keys(self):
        return self._cached("_keys", lambda: ApiKey.objects.for_shop(self.shop).filter(revoked_at__isnull=True).count())

    @property
    def has_logo(self):
        return self._cached("_logo", lambda: ShopLogo.objects.filter(shop=self.shop).exists())

    @property
    def mfa_enabled(self):
        return self._cached(
            "_mfa", lambda: TOTPDevice.objects.filter(user=self.membership.user, confirmed_at__isnull=False).exists()
        )


def state_general(facts, scope):
    shop = facts.shop
    if scope == "logo":
        return normal("Logo en place") if facts.has_logo else attention("Logo manquant")
    if shop.on_vacation():
        return attention(f"En vacances jusqu'au {day_label(shop.vacation_until)}" if shop.vacation_until else "En vacances")
    if not facts.has_logo:
        return attention("Logo manquant")
    return normal(f"{shop.name} · {shop.city}" if shop.city else shop.name)


def state_forfait(facts):
    spec = plans.spec(facts.shop)
    label = f"{spec.name} · {francs(spec.price)} par mois" if spec.price else spec.name
    # On ne signale que les limites que le serveur applique ; un plan à une seule personne est toujours « plein ».
    for used, limit, unit in (
        (facts.products, spec.products, ("produit", "produits")),
        (facts.members, spec.members if (spec.members or 0) > 1 else None, ("personne", "personnes")),
    ):
        if limit is not None and used >= limit * NEAR_LIMIT:
            return attention(f"{spec.name} · {used} {unit[0] if used == 1 else unit[1]} sur {limit}")
    return normal(label)


def state_utilisateurs(facts, manages_shop):
    text = count(facts.members, "personne", "personnes")
    pending = facts.pending_members if manages_shop else 0
    if pending:
        who = "n'a pas encore choisi son" if pending == 1 else "n'ont pas encore choisi leur"
        return attention(f"{text} · {pending} {who} mot de passe")
    return normal(text)


def state_clients(facts):
    threshold = facts.shop.loyalty_threshold
    return normal(f"Fidèle dès {count(threshold, 'commande', 'commandes')}")


def state_securite(facts):
    return normal("Double authentification active") if facts.mfa_enabled else attention("Activez la double authentification")


def state_avance(facts):
    if not plans.spec(facts.shop).api_keys:
        return normal("Réservé au plan Pro")
    keys = facts.active_keys
    return normal("Aucune clé" if keys == 0 else count(keys, "clé active", "clés actives"))


def entries_for(shop, membership, permissions):
    """Les rubriques que cette personne a le droit de voir et dont la page existe, dans l'ordre de la liste."""
    facts = Facts(shop, membership)
    manages = "shop.manage" in permissions
    found = []

    def add(entry_id, state, scope=None):
        if entry_id in IMPLEMENTED:
            row = {"id": entry_id, "state": state}
            if scope:
                row["scope"] = scope
            found.append(row)

    if manages:
        add("general", state_general(facts, "full"), "full")
    elif "storefront.edit" in permissions:
        add("general", state_general(facts, "logo"), "logo")
    if manages:
        add("forfait", state_forfait(facts))
    if "team.view" in permissions and membership.role != Role.SELLER:
        add("utilisateurs", state_utilisateurs(facts, manages))
    if "customers.loyalty" in permissions:
        add("clients", state_clients(facts))
    add("securite", state_securite(facts), "full" if manages else "account")
    if manages:
        add("avance", state_avance(facts))
    return found


class SettingsSummaryView(ShopScopedView):
    # Lecture seule, ouverte à tout membre : c'est la liste elle-même qui est filtrée, ligne par ligne, selon les droits.
    permission_by_method = {"GET": ANY_MEMBER}

    def get(self, request, slug):
        enforce("settings_summary", str(self.membership.pk), SUMMARY_LIMIT)
        return Response({"entries": entries_for(self.shop, self.membership, self.permissions)})


class PermissionsView(ShopScopedView):
    """
    « Qui peut faire quoi » : les règles de chaque rôle, lisibles par tout membre (vendeur compris). Ce sont les règles
    de la plateforme, pas des secrets de la boutique : le serveur les applique de toute façon, les montrer ne donne aucun
    accès. Rien n'est dit des droits accordés aux autres (permissions.permissions_matrix).
    """

    permission_by_method = {"GET": ANY_MEMBER}

    def get(self, request, slug):
        return Response(permissions_matrix(self.membership))
