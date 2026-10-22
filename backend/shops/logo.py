"""
Logo de la boutique (docs/chantier-p4.md §G).

Une image envoyée par un marchand n'est jamais servie telle quelle : son format est lu d'après
son contenu (pas d'après son nom ni le Content-Type annoncé), seuls PNG, JPEG et WebP passent,
et elle est entièrement redessinée en PNG de 512 px au plus. Le fichier servi ne garde donc ni
EXIF, ni position GPS, ni script caché dans un SVG ou un polyglotte.
"""

import hashlib
import io

from django.http import HttpResponse
from PIL import Image, UnidentifiedImageError
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from audit.services import record
from core.exceptions import ProblemError

from .models import ShopLogo
from .permissions import ShopScopedView
from .storefront import StorefrontView, storefront_shop

MAX_BYTES = 2 * 1024 * 1024
MAX_SIDE = 512
# Une image de 2 Mo peut annoncer des dimensions énormes (bombe de décompression) : refusée avant d'être décodée.
MAX_PIXELS = 25_000_000
ACCEPTED = {"PNG", "JPEG", "WEBP"}


def clean_logo(upload):
    """Renvoie le PNG réencodé, ou lève une erreur au format du contrat."""
    if upload.size > MAX_BYTES:
        raise ProblemError(413, "file_too_large", "Logo trop lourd : 2 Mo au maximum.")
    raw = upload.read(MAX_BYTES + 1)
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            kind = probe.format
            width, height = probe.size
        if kind not in ACCEPTED:
            raise ProblemError(415, "unsupported_file", "Logo en PNG, JPEG ou WebP seulement.")
        if width * height > MAX_PIXELS:
            raise ProblemError(415, "unsupported_file", "Cette image est trop grande pour un logo.")
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            picture = image.convert("RGBA")
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError):
        raise ProblemError(415, "unsupported_file", "Ce fichier n'est pas une image lisible.") from None
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


class StorefrontLogoView(StorefrontView):
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
