from django.conf import settings
from django.contrib import admin
from django.urls import include, path, re_path

from core.exceptions import not_found_view

# L'admin Django est l'interface de l'exploitant de la plateforme, pas celle des marchands.
admin.site.site_header = "Akwaba · Plateforme"
admin.site.site_title = "Akwaba · Plateforme"
admin.site.index_title = "Administration de la plateforme"
admin.site.site_url = settings.FRONTEND_URL

urlpatterns = [
    path(settings.ADMIN_URL, admin.site.urls),
    path("api/v1/", include("accounts.urls")),
    path("api/v1/", include("shops.urls")),
    # Même en DEBUG, une route d'API inconnue répond en JSON : le BFF ne reçoit jamais de page HTML.
    re_path(r"^api/", not_found_view),
]

handler404 = "core.exceptions.not_found_view"
handler500 = "core.exceptions.server_error_view"
