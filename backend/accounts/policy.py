"""
Politique de sécurité d'Akwaba, au même endroit (docs/contrat-api.md §2).
La durée de l'access token (5 min) et du refresh standard (7 j) est dans SIMPLE_JWT (settings.py).
"""

from datetime import timedelta

# Sessions
SESSION_MAX_AGE = timedelta(days=30)  # même rafraîchie en continu, une session finit par mourir
SHARED_SESSION_MAX_AGE = timedelta(hours=8)  # mode appareil partagé
SHARED_REFRESH_TOKEN_LIFETIME = timedelta(hours=8)
SHARED_IDLE_TIMEOUT = timedelta(minutes=15)
REFRESH_GRACE_PERIOD = timedelta(seconds=10)  # deux requêtes parallèles qui rafraîchissent en même temps
LAST_SEEN_UPDATE_INTERVAL = timedelta(seconds=60)  # évite une écriture en base à chaque requête

# Verrouillage du login, par e-mail (que le compte existe ou non)
LOGIN_LOCK_THRESHOLD = 5
LOGIN_LOCK_DURATION = timedelta(minutes=15)
LOGIN_FAILURE_MEMORY = timedelta(hours=1)
LOGIN_WARNING_FROM = 3  # attempts_remaining n'apparaît qu'à partir de 3 essais restants

# Double authentification
MFA_TOKEN_MAX_AGE = timedelta(minutes=5)
MFA_TOKEN_ATTEMPTS = 3  # au-delà, retour à l'étape mot de passe
# Les codes 2FA faux comptent dans le même verrou que les mots de passe faux.
# Un mot de passe juste ne remet pas le compteur à zéro tant que la 2FA n'est pas passée.

# Confirmation renforcée avant une action grave
REAUTH_WINDOW = timedelta(minutes=10)

# Page « Sécurité » du marchand : ses événements des 90 derniers jours
SECURITY_EVENTS_VISIBLE_FOR = timedelta(days=90)

# Lien « Débloquer mon compte » de l'e-mail de verrou
UNLOCK_TOKEN_MAX_AGE = timedelta(hours=1)

# Limites de débit : (nombre, fenêtre en secondes)
LOGIN_IP_LIMIT = (20, 600)
LOGIN_MFA_IP_LIMIT = (20, 600)
REAUTH_SESSION_LIMIT = (5, 900)
MFA_MANAGE_SESSION_LIMIT = (5, 900)
UNLOCK_IP_LIMIT = (10, 3600)
SIGNUP_EMAIL_LIMIT = (3, 3600)
SIGNUP_IP_LIMIT = (5, 3600)
SIGNUP_COMPLETE_IP_LIMIT = (10, 3600)
FORGOT_EMAIL_LIMIT = (3, 3600)
FORGOT_IP_LIMIT = (10, 3600)
RESET_IP_LIMIT = (20, 3600)
REFRESH_SESSION_LIMIT = (30, 60)
PASSWORD_CHANGE_SESSION_LIMIT = (5, 900)

# Liens envoyés par e-mail (la réinitialisation du mot de passe : PASSWORD_RESET_TIMEOUT, 30 min)
SIGNUP_TOKEN_MAX_AGE = timedelta(hours=24)
