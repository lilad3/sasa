"""
Logo de la boutique (docs/chantier-p4.md §G).

La lecture de l'envoi (format d'après le contenu, tailles) est commune avec les photos de produit
(images.py) ; le logo est ensuite redessiné en PNG de 512 px au plus.
"""

import hashlib
import io

from django.http import HttpResponse
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from audit.services import record

from .images import ImageResponseMixin, open_upload
from .models import ShopLogo
from .permissions import ShopScopedView
from .storefront import StorefrontView, storefront_shop

MAX_SIDE = 512


def clean_logo(upload):
    """Renvoie le PNG réencodé, ou lève une erreur au format du contrat."""
    with open_upload(upload, "logo") as image:
        picture = image.convert("RGBA")
    picture.thumbnail((MAX_SIDE, MAX_SIDE))
    out = io.BytesIO()
    picture.save(out, format="PNG", optimize=True)
    return out.getvalue()


class ShopLogoView(ShopScopedView):
    permission_by_method = {"POST": "storefront.edit", "DELETE": "storefront.edit"}
    parser_classes = [MultiPartParser]

    def post(self, request, slug):
        upload = request.FILES.get("logo")
        if upload is None:
            raise ValidationError({"logo": [ErrorDetail("Choisissez une image.", code="required")]})
        image = clean_logo(upload)
        version = hashlib.sha256(image).hexdigest()[:12]
        ShopLogo.objects.update_or_create(shop=self.shop, defaults={"image": image, "version": version})
        record("shop_logo_changed", request, actor=request.user, shop=self.shop, change="uploaded")
        return Response({"logo_version": version})

    def delete(self, request, slug):
        deleted, _ = ShopLogo.objects.filter(shop=self.shop).delete()
        if deleted:
            record("shop_logo_changed", request, actor=request.user, shop=self.shop, change="removed")
        return Response(status=status.HTTP_204_NO_CONTENT)


class StorefrontLogoView(ImageResponseMixin, StorefrontView):
    """Public (derrière le BFF) : le PNG réencodé, jamais le fichier d'origine."""

    def get(self, request, slug):
        shop = storefront_shop(slug)
        logo = ShopLogo.objects.filter(shop=shop).first()
        if logo is None:
            raise NotFound("Pas de logo.")
        response = HttpResponse(bytes(logo.image), content_type="image/png")
        response["X-Content-Type-Options"] = "nosniff"
        # L'adresse change avec la version (?v=…) : le navigateur peut garder l'image longtemps.
        response["Cache-Control"] = "public, max-age=31536000, immutable"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response
