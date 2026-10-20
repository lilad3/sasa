from rest_framework.throttling import UserRateThrottle


class UserThrottle(UserRateThrottle):
    """Limite générale par compte ; sans compte, par IP réelle du visiteur (transmise par le BFF)."""

    def get_ident(self, request):
        return getattr(request, "client_ip", "") or super().get_ident(request)
