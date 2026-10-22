import "server-only";

import { connection } from "next/server";

import { mainImage } from "@/lib/photos";
import type { PublicProduct, Storefront } from "@/lib/types";
import { callApi } from "./api";
import { requestContext } from "./session";

// Vitrine publique : aucun token, mais l'IP réelle du visiteur part quand même vers Django (limitation).
// connection() : stock et prix changent à tout moment, ces données ne sont jamais pré-rendues.

export async function getStorefront(slug: string) {
  await connection();
  return callApi<Storefront>(`storefront/${encodeURIComponent(slug)}`, { context: await requestContext() });
}

export async function getStorefrontProducts(slug: string) {
  await connection();
  const result = await callApi<PublicProduct[]>(`storefront/${encodeURIComponent(slug)}/products`, { context: await requestContext() });
  if (!result.ok) return result;
  // La photo envoyée passe avant l'adresse externe : les composants de la vitrine n'ont qu'une adresse à lire.
  return { ...result, data: result.data.map((product) => ({ ...product, image_url: mainImage(slug, product) })) };
}
