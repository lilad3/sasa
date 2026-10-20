from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts import lockout, mfa
from accounts.models import User
from shops.demo import generate_demo_data
from shops.models import Membership, Plan, Role, Shop

DEMO_PASSWORD = "Demo-Vitrine-2026"

# Secrets TOTP publics (README) : n'importe qui peut générer les codes. Démo uniquement.
DEMO_TOTP_SECRETS = {
    "ibrahim@akwaba.test": "MBNM5GZTHXLVVEGZM4BKEEE4I6OQNQCK",
    "admin@akwaba.test": "DQAYDJNECMCHH7BTOVXVR6NVCFAJWDQL",
}

# Deux boutiques : la seconde sert à vérifier qu'aucun compte ne voit les données d'une autre.
DEMO_SHOPS = [
    ("maison-adjoua", "Maison Adjoua", Plan.PRO, [
        ("adjoua@akwaba.test", "Adjoua", "Konan", Role.OWNER),
        ("fatou@akwaba.test", "Fatou", "Diabaté", Role.MANAGER),
        ("koffi@akwaba.test", "Koffi", "Yao", Role.SELLER),
    ]),
    ("comptoir-fofana", "Comptoir Fofana", Plan.FREE, [
        ("ibrahim@akwaba.test", "Ibrahim", "Fofana", Role.OWNER),
    ]),
]

# Ce que les clients voient en vitrine (/boutique/<slug> côté front).
DEMO_STOREFRONTS = {
    "maison-adjoua": {
        "description": "Karité, cacao, café de Man et artisanat tissé main : le meilleur d'ici, livré en 24 h dans le Grand Abidjan.",
        "city": "Cocody, Abidjan",
        "accent": "orange",
    },
    "comptoir-fofana": {
        "description": "Épicerie et cosmétiques naturels du Nord, sélectionnés à Korhogo.",
        "city": "Korhogo",
        "accent": "indigo",
    },
}

# L'exploitant de la plateforme : il consulte le journal d'audit dans l'admin Django.
DEMO_ADMIN = ("admin@akwaba.test", "Awa", "Koné")


class Command(BaseCommand):
    help = "Crée ou remet à zéro les boutiques et les comptes de démonstration (développement uniquement)."

    @transaction.atomic
    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError(
                "Les comptes de démo ont des mots de passe et des secrets 2FA publics : "
                "seed_demo ne tourne qu'en développement (DJANGO_DEBUG=1)."
            )

        recovery = {}
        for slug, name, plan, accounts in DEMO_SHOPS:
            shop, _ = Shop.objects.update_or_create(
                slug=slug, defaults={"name": name, "plan": plan, **DEMO_STOREFRONTS[slug]}
            )
            for email, first_name, last_name, role in accounts:
                user = self._demo_user(email, first_name, last_name, recovery)
                Membership.objects.update_or_create(user=user, shop=shop, defaults={"role": role})
            summary = generate_demo_data(shop)
            self.stdout.write(f"{name} : {summary['products']} produits, {summary['orders']} commandes sur {summary['days']} jours")

        admin_user = self._demo_user(*DEMO_ADMIN, recovery)
        User.objects.filter(pk=admin_user.pk).update(is_staff=True, is_superuser=True)

        self.stdout.write(self.style.SUCCESS(f"\nComptes de démo (mot de passe : {DEMO_PASSWORD})"))
        for _, name, _, accounts in DEMO_SHOPS:
            for email, _, _, role in accounts:
                self.stdout.write(f"  {email:<24} {Role(role).label:<13} {name}")
        self.stdout.write(f"  {DEMO_ADMIN[0]:<24} {'Admin':<13} administration de la plateforme (/{settings.ADMIN_URL})")
        self.stdout.write("\nComptes avec 2FA (secret à saisir dans une application d'authentification) :")
        for email, secret in DEMO_TOTP_SECRETS.items():
            self.stdout.write(f"  {email:<24} {secret}   codes de secours : {', '.join(recovery[email][:3])}…")

    def _demo_user(self, email, first_name, last_name, recovery):
        user = User.objects.filter(email=email).first() or User(email=email)
        user.first_name, user.last_name, user.is_demo = first_name, last_name, True
        user.set_password(DEMO_PASSWORD)
        user.save()
        lockout.clear(email)
        if email in DEMO_TOTP_SECRETS:
            recovery[email] = mfa.enable_with_secret(user, DEMO_TOTP_SECRETS[email])
        return user
