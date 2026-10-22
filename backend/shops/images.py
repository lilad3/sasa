"""
Les images envoyées par une boutique : logo (docs/chantier-p4.md §G) et photos de produit (chantier-p5.md §2.2).

Une image n'est jamais servie telle quelle : son format est lu d'après son contenu (pas d'après son
nom ni le Content-Type annoncé), seuls PNG, JPEG et WebP passent, et elle est entièrement redessinée
par le serveur. Le fichier servi ne garde donc ni EXIF, ni position GPS, ni script caché dans un SVG
ou un polyglotte.
"""

import io

from PIL import Image, UnidentifiedImageError

from core.exceptions import ProblemError

MAX_BYTES = 2 * 1024 * 1024
# Une image de 2 Mo peut annoncer des dimensions énormes (bombe de décompression) : refusée avant d'être décodée.
MAX_PIXELS = 25_000_000
ACCEPTED = {"PNG", "JPEG", "WEBP"}

TEXTS = {
    "logo": {
        "heavy": "Logo trop lourd : 2 Mo au maximum.",
        "kind": "Logo en PNG, JPEG ou WebP seulement.",
        "huge": "Cette image est trop grande pour un logo.",
    },
    "photo": {
        "heavy": "Photo trop lourde : 2 Mo au maximum.",
        "kind": "Photo en PNG, JPEG ou WebP seulement.",
        "huge": "Cette image est trop grande pour une photo de produit.",
    },
}


def open_upload(upload, what):
    """L'image décodée, ou une erreur au format du contrat (413 ou 415)."""
    texts = TEXTS[what]
    if upload.size > MAX_BYTES:
        raise ProblemError(413, "file_too_large", texts["heavy"])
    raw = upload.read(MAX_BYTES + 1)
    try:
        with Image.open(io.BytesIO(raw)) as probe:
            kind = probe.format
            width, height = probe.size
        if kind not in ACCEPTED:
            raise ProblemError(415, "unsupported_file", texts["kind"])
        if width * height > MAX_PIXELS:
            raise ProblemError(415, "unsupported_file", texts["huge"])
        image = Image.open(io.BytesIO(raw))
        image.load()
        return image
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError, SyntaxError, ValueError):
        raise ProblemError(415, "unsupported_file", "Ce fichier n'est pas une image lisible.") from None


class ImageResponseMixin:
    """
    Pour une vue qui rend une image. Le BFF demande `Accept: image/png` ou `image/webp` : sans ceci,
    DRF, qui ne connaît que le JSON, répondrait 406 avant même d'appeler la vue. Les erreurs (404)
    restent en problem+json.
    """

    def perform_content_negotiation(self, request, force=False):
        return super().perform_content_negotiation(request, force=True)
