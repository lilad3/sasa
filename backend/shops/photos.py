"""
Photos de produit et produit à la une (docs/chantier-p5.md, lot 2).

Les photos suivent la chaîne du logo (images.py) : lues d'après leur contenu, redessinées en WebP
de 1 200 px au plus, sans métadonnées. Trois au plus par produit. Choisir le produit de la
couverture relève de la vitrine (storefront.edit), pas du catalogue.
"""

import hashlib
import io

from django.db import IntegrityError, transaction
from django.http import HttpResponse
from PIL import ImageOps
from rest_framework import status
from rest_framework.exceptions import ErrorDetail, NotFound, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from audit.services import record
from core.exceptions import ProblemError
from core.ratelimit import enforce

from .images import ImageResponseMixin, open_upload
from .models import Product, ProductPhoto
from .permissions import ShopScopedView
from .storefront import StorefrontView, photos_payload, storefront_shop

MAX_SIDE = 1200
UPLOAD_LIMIT = (60, 3600)  # par membre


def clean_photo(upload):
    """Le WebP réencodé : orientation de l'appareil appliquée, puis plus aucune métadonnée."""
    with open_upload(upload, "photo") as image:
        upright = ImageOps.exif_transpose(image)
        picture = upright.convert("RGBA" if upright.has_transparency_data else "RGB")
    picture.thumbnail((MAX_SIDE, MAX_SIDE))
    picture.info = {}
    out = io.BytesIO()
    picture.save(out, format="WEBP", quality=80, method=4)
    return out.getvalue()


class ProductScopedView(ShopScopedView):
    def product(self, product_id):
        product = Product.objects.for_shop(self.shop).filter(pk=product_id).first()
        if product is None:
            raise NotFound("Produit introuvable.")
        return product

    def photo(self, product, photo_id):
        photo = ProductPhoto.objects.for_shop(self.shop).filter(product=product, pk=photo_id).defer("image").first()
        if photo is None:
            raise NotFound("Photo introuvable.")
        return photo


class ProductPhotoListView(ProductScopedView):
    permission_by_method = {"POST": "products.write"}
    parser_classes = [MultiPartParser]

    def post(self, request, slug, product_id):
        product = self.product(product_id)
        upload = request.FILES.get("photo")
        if upload is None:
            raise ValidationError({"photo": [ErrorDetail("Choisissez une image.", code="required")]})
        # Avant le décodage : la limite protège aussi le serveur du travail de Pillow.
        enforce("product_photo:member", str(self.membership.pk), UPLOAD_LIMIT)
        image = clean_photo(upload)
        taken = set(product.photos.values_list("position", flat=True))
        free = [position for position in range(ProductPhoto.MAX_PER_PRODUCT) if position not in taken]
        if not free:
            raise ProblemError(409, "photo_limit", f"{ProductPhoto.MAX_PER_PRODUCT} photos au plus par produit : retirez-en une d'abord.")
        try:
            with transaction.atomic():
                photo = ProductPhoto.objects.create(
                    shop=self.shop, product=product, position=free[0], image=image,
                    version=hashlib.sha256(image).hexdigest()[:12], created_by=request.user,
                )
        except IntegrityError:  # un autre envoi a pris la place au même instant
            raise ProblemError(409, "photo_limit", "Une autre photo vient d'être ajoutée : actualisez la page.") from None
        return Response({"id": str(photo.pk), "version": photo.version, "position": photo.position}, status=status.HTTP_201_CREATED)


class ProductPhotoDetailView(ProductScopedView):
    permission_by_method = {"DELETE": "products.write"}

    def delete(self, request, slug, product_id, photo_id):
        product = self.product(product_id)
        with transaction.atomic():
            self.photo(product, photo_id).delete()
            # Les suivantes remontent d'un rang, une à une et dans l'ordre : la contrainte (produit, rang) tient.
            for position, photo in enumerate(product.photos.only("id", "position").order_by("position")):
                if photo.position != position:
                    ProductPhoto.objects.filter(pk=photo.pk).update(position=position)
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProductPhotoMainView(ProductScopedView):
    permission_by_method = {"PUT": "products.write"}

    def put(self, request, slug, product_id, photo_id):
        product = self.product(product_id)
        main = self.photo(product, photo_id)
        with transaction.atomic():
            others = [photo for photo in product.photos.only("id", "position").order_by("position") if photo.pk != main.pk]
            ordered = [main, *others]
            # D'abord hors de la plage 0-2, puis à leur place : jamais deux photos au même rang.
            for photo in ordered:
                ProductPhoto.objects.filter(pk=photo.pk).update(position=photo.position + 100)
            for position, photo in enumerate(ordered):
                ProductPhoto.objects.filter(pk=photo.pk).update(position=position)
        return Response(photos_payload(product))


class ProductFeaturedView(ProductScopedView):
    permission_by_method = {"PUT": "storefront.edit", "DELETE": "storefront.edit"}

    def put(self, request, slug, product_id):
        product = self.product(product_id)
        if not product.is_active:
            raise ProblemError(409, "product_inactive", "Ce produit n'est pas en vente : remettez-le en vente avant de le mettre à la une.")
        if not product.is_featured:
            try:
                with transaction.atomic():
                    Product.objects.for_shop(self.shop).filter(is_featured=True).update(is_featured=False)
                    Product.objects.filter(pk=product.pk).update(is_featured=True)
            except IntegrityError:  # une autre une posée au même instant : la contrainte n'en garde qu'une
                raise ProblemError(409, "conflict", "La une vient de changer : actualisez la page.") from None
            record("product_featured", request, actor=request.user, shop=self.shop, target=("product", product.pk, product.name), change="set")
        return Response({"id": str(product.pk), "is_featured": True})

    def delete(self, request, slug, product_id):
        product = self.product(product_id)
        if product.is_featured:
            Product.objects.filter(pk=product.pk).update(is_featured=False)
            record("product_featured", request, actor=request.user, shop=self.shop, target=("product", product.pk, product.name), change="removed")
        return Response({"id": str(product.pk), "is_featured": False})


class StorefrontPhotoView(ImageResponseMixin, StorefrontView):
    """
    Public (derrière le BFF) : le WebP réencodé. L'identifiant est un UUID aléatoire, publié seulement
    pour les produits en vente ; pour un produit masqué, seule l'équipe le connaît.
    """

    def get(self, request, slug, photo_id):
        shop = storefront_shop(slug)
        photo = ProductPhoto.objects.for_shop(shop).filter(pk=photo_id).only("image").first()
        if photo is None:
            raise NotFound("Photo introuvable.")
        response = HttpResponse(bytes(photo.image), content_type="image/webp")
        response["X-Content-Type-Options"] = "nosniff"
        # L'adresse change avec la version (?v=…) : le navigateur peut garder l'image longtemps.
        response["Cache-Control"] = "public, max-age=31536000, immutable"
        response["Content-Security-Policy"] = "default-src 'none'; sandbox"
        return response
