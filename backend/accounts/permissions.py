from rest_framework.permissions import BasePermission

from core.exceptions import ProblemError


class PasswordChosen(BasePermission):
    """
    Un compte créé par le propriétaire d'une boutique arrive avec un mot de passe provisoire,
    que le propriétaire a vu. Tant qu'il ne l'a pas remplacé, ce compte ne peut que lire son
    profil et choisir son mot de passe : `allowed_with_temporary_password` sur la vue.
    """

    def has_permission(self, request, view):
        if getattr(request.user, "must_change_password", False) and not getattr(view, "allowed_with_temporary_password", False):
            raise ProblemError(403, "password_change_required", "Choisissez votre mot de passe avant de continuer.")
        return True
