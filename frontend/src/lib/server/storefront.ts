import "server-only";

import { connection } from "next/server";

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
  return callApi<PublicProduct[]>(`storefront/${encodeURIComponent(slug)}/products`, { context: await requestContext() });
}
