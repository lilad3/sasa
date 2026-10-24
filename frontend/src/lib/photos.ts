import type { ProductPhoto } from "./types";

/**
 * L'adresse d'une photo de produit, relayée par Next depuis Django (docs/chantier-p5.md §2.2).
 * ?v= change avec l'image : le navigateur peut la garder en cache sans limite.
 */
export function photoUrl(slug: string, photo: ProductPhoto) {
  return `/boutique/${encodeURIComponent(slug)}/photo/${photo.id}?v=${photo.version}`;
}

/** L'image principale d'un produit : la première photo envoyée, sinon l'adresse externe, sinon rien. */
export function mainImage(slug: string, product: { photos: ProductPhoto[]; image_url: string | null }) {
  const [first] = product.photos;
  return first ? photoUrl(slug, first) : product.image_url || null;
}

/**
 * La photo d'un produit pour l'équipe, relayée par /app/[shop]/photo/[id] : seule route qui montre la photo d'un
 * brouillon ou d'un archivé (la route publique ne sert que les produits en vente).
 */
export function memberPhotoUrl(slug: string, productId: string, photo: ProductPhoto) {
  return `/app/${encodeURIComponent(slug)}/photo/${photo.id}?p=${productId}&v=${photo.version}`;
}
