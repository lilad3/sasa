"""Catalogue des événements du journal : catégorie, gravité et libellé lisible."""

from django.db import models


class Category(models.TextChoices):
    SECURITY = "security", "Sécurité"
    BUSINESS = "business", "Activité des boutiques"
    ADMIN = "admin", "Administration"


class Severity(models.TextChoices):
    INFO = "info", "Info"
    WARNING = "warning", "À surveiller"
    CRITICAL = "critical", "Critique"


S, B, A = Category.SECURITY, Category.BUSINESS, Category.ADMIN
INFO, WARNING, CRITICAL = Severity.INFO, Severity.WARNING, Severity.CRITICAL

ACTIONS = {
    # Sécurité des comptes
    "login_succeeded": (S, INFO, "Connexion réussie"),
    "login_failed": (S, WARNING, "Connexion échouée"),
    "account_locked": (S, WARNING, "Compte verrouillé"),
    "account_unlocked": (S, INFO, "Compte débloqué"),
    "new_device": (S, INFO, "Connexion depuis un nouvel appareil"),
    "refresh_reuse_detected": (S, CRITICAL, "Vol de session détecté"),
    "logged_out": (S, INFO, "Déconnexion"),
    "session_revoked": (S, INFO, "Session fermée"),
    "password_changed": (S, WARNING, "Mot de passe changé"),
    "password_reset": (S, WARNING, "Mot de passe réinitialisé"),
    "mfa_enabled": (S, INFO, "Double authentification activée"),
    "mfa_disabled": (S, WARNING, "Double authentification désactivée"),
    # Un code 2FA faux veut dire que le mot de passe, lui, était juste.
    "mfa_failed": (S, WARNING, "Code de double authentification refusé"),
    "recovery_code_used": (S, WARNING, "Code de secours utilisé"),
    "recovery_codes_regenerated": (S, WARNING, "Codes de secours régénérés"),
    "reauth_succeeded": (S, INFO, "Identité confirmée"),
    "reauth_failed": (S, WARNING, "Confirmation d'identité refusée"),
    "signup_completed": (S, INFO, "Compte créé"),
    # Le champ piège du checkout a été rempli : un robot, pas un client.
    "checkout_bot_blocked": (S, WARNING, "Commande de robot bloquée"),
    # Accès aux données d'une boutique : qui entre, avec quels droits, et ce qui sort.
    "member_added": (S, WARNING, "Membre ajouté à la boutique"),
    "member_role_changed": (S, WARNING, "Rôle d'un membre modifié"),
    "member_removed": (S, INFO, "Membre retiré de la boutique"),
    "member_password_reset": (S, WARNING, "Nouveau mot de passe provisoire"),
    "member_grants_changed": (S, WARNING, "Droits d'un gérant modifiés"),
    # De l'argent sort de la boutique : les réductions vont dans la catégorie Sécurité (vue « Sensible »).
    "discount_created": (S, WARNING, "Réduction offerte"),
    "discount_revoked": (S, INFO, "Réduction annulée"),
    "api_key_created": (S, WARNING, "Clé API créée"),
    "api_key_revoked": (S, INFO, "Clé API révoquée"),
    "orders_exported": (S, WARNING, "Ventes exportées"),
    "customers_exported": (S, WARNING, "Clients exportés"),
    # Activité des boutiques
    "shop_created": (B, INFO, "Boutique créée"),
    "order_placed": (B, INFO, "Commande passée en boutique"),
    "order_status_changed": (B, INFO, "Statut de commande modifié"),
    "demo_data_generated": (B, INFO, "Données de démo générées"),
    "products_imported": (B, INFO, "Produits importés"),
    "plan_changed": (B, INFO, "Plan changé"),
    "shop_updated": (B, INFO, "Boutique modifiée"),
    "team_note_sent": (B, INFO, "Message envoyé à l'équipe"),
    "goal_set": (B, INFO, "Objectif du mois fixé"),
    "customer_vip_set": (B, INFO, "Client nommé fidèle"),
    "customer_vip_removed": (B, INFO, "Client retiré des fidèles"),
    "loyalty_threshold_changed": (B, INFO, "Seuil de fidélité modifié"),
    "shop_logo_changed": (B, INFO, "Logo de la boutique modifié"),
    "product_featured": (B, INFO, "Produit mis à la une"),
    "storefront_published": (B, INFO, "Vitrine publiée"),
    "storefront_restored": (B, INFO, "Ancienne version de la vitrine reprise"),
    # Administration de la plateforme
    "admin_login_succeeded": (A, INFO, "Connexion à l'administration"),
    "admin_login_failed": (A, WARNING, "Connexion à l'administration refusée"),
    "audit_exported": (A, INFO, "Journal exporté"),
    "audit_verified": (A, INFO, "Intégrité du journal vérifiée"),
}

ACTION_CHOICES = [(action, label) for action, (_, _, label) in ACTIONS.items()]
