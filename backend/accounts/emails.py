"""E-mails du parcours d'authentification. En développement, ils s'affichent dans le terminal de Django."""

from django.conf import settings
from django.core.mail import send_mail
from django.utils import timezone

from core.devices import device_label

SIGNATURE = "\n\nL'équipe Akwaba"

# Alertes de sécurité : (sujet, ce qui s'est passé)
ALERTS = {
    "new_device": (
        "Nouvelle connexion à votre compte Akwaba",
        "Quelqu'un vient de se connecter à votre compte depuis un appareil que nous ne connaissions pas.",
    ),
    "refresh_reuse_detected": (
        "Une de vos sessions a été fermée par sécurité",
        "Une de vos sessions a été utilisée depuis deux endroits à la fois, ce qui indique un vol probable. "
        "Nous l'avons fermée.",
    ),
    "password_changed": (
        "Votre mot de passe Akwaba a été changé",
        "Le mot de passe de votre compte vient d'être changé. Vos autres sessions ont été fermées.",
    ),
    "password_reset": (
        "Votre mot de passe Akwaba a été réinitialisé",
        "Le mot de passe de votre compte vient d'être réinitialisé. Toutes vos sessions ont été fermées.",
    ),
    "mfa_disabled": (
        "Double authentification désactivée",
        "La double authentification vient d'être désactivée sur votre compte.",
    ),
    "api_key_created": (
        "Une clé API a été créée pour votre boutique",
        "Une clé API vient d'être créée. Elle permet à un autre logiciel de lire les données de votre boutique "
        "jusqu'à sa révocation.",
    ),
    "recovery_code_used": (
        "Un code de secours a été utilisé",
        "Un de vos codes de secours vient d'être utilisé. Il ne fonctionnera plus.",
    ),
}


def send_signup_link(email, first_name, token):
    link = f"{settings.FRONTEND_URL}/inscription/terminer?token={token}"
    send_mail(
        "Terminez votre inscription sur Akwaba",
        f"Bonjour {first_name},\n\n"
        f"Pour ouvrir votre boutique, choisissez votre mot de passe ici (lien valable 24 h) :\n{link}\n\n"
        "Si vous n'avez rien demandé, ignorez ce message : aucun compte n'a été créé."
        f"{SIGNATURE}",
        None,
        [email],
    )


def send_signup_existing(email):
    """Envoyé à la place du lien d'inscription : l'API, elle, répond pareil dans les deux cas."""
    send_mail(
        "Vous avez déjà un compte Akwaba",
        "Bonjour,\n\n"
        "Quelqu'un, peut-être vous, a voulu créer un compte Akwaba avec cette adresse. "
        "Elle a déjà un compte.\n\n"
        f"Se connecter : {settings.FRONTEND_URL}/connexion\n"
        f"Mot de passe oublié : {settings.FRONTEND_URL}/mot-de-passe-oublie\n\n"
        "Si ce n'était pas vous, ignorez ce message : rien n'a changé sur votre compte."
        f"{SIGNATURE}",
        None,
        [email],
    )


def send_password_reset(user, uid, token):
    link = f"{settings.FRONTEND_URL}/nouveau-mot-de-passe?uid={uid}&token={token}"
    send_mail(
        "Réinitialisez votre mot de passe Akwaba",
        f"Bonjour {user.first_name or ''},\n\n"
        f"Pour choisir un nouveau mot de passe, ouvrez ce lien (valable 30 min, une seule fois) :\n{link}\n\n"
        "Toutes vos sessions seront fermées après le changement.\n"
        "Si vous n'avez rien demandé, ignorez ce message : votre mot de passe actuel reste valable."
        f"{SIGNATURE}",
        None,
        [user.email],
    )


def send_account_locked(user, unlock_token):
    send_mail(
        "Votre compte Akwaba est bloqué pour 15 minutes",
        f"Bonjour {user.first_name or ''},\n\n"
        "Plusieurs tentatives de connexion ont échoué sur votre compte : nous l'avons bloqué pendant 15 minutes.\n\n"
        f"C'était vous ? Débloquez-le tout de suite (lien valable 1 h) :\n"
        f"{settings.FRONTEND_URL}/deverrouiller?token={unlock_token}\n\n"
        "Ce n'était pas vous ? Quelqu'un essaie peut-être d'entrer. Changez votre mot de passe :\n"
        f"{settings.FRONTEND_URL}/mot-de-passe-oublie"
        f"{SIGNATURE}",
        None,
        [user.email],
    )


def send_security_alert(user, action, request=None):
    subject, what = ALERTS[action]
    when = timezone.localtime().strftime("%d/%m/%Y à %H:%M")
    device = device_label(getattr(request, "client_ua", "")) or "inconnu"
    ip = getattr(request, "client_ip", "") or "inconnue"
    send_mail(
        subject,
        f"Bonjour {user.first_name or ''},\n\n{what}\n\n"
        f"Quand : {when} (heure d'Abidjan)\nAppareil : {device}\nAdresse IP : {ip}\n\n"
        "C'était vous ? Vous n'avez rien à faire.\n"
        "Ce n'était pas vous ? Changez votre mot de passe tout de suite, puis fermez vos autres sessions "
        f"depuis la page Sécurité :\n{settings.FRONTEND_URL}/mot-de-passe-oublie"
        f"{SIGNATURE}",
        None,
        [user.email],
    )
