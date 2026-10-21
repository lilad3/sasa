import "server-only";

import { authed } from "@/lib/server/session";
import type { Paginated } from "@/lib/types";

import type { Product, ProductFilters, ProductOverview } from "./types";

export async function getProducts(slug: string, { q, category, stock, page }: ProductFilters) {
  const query = new URLSearchParams({ page: String(page), page_size: "25" });
  if (q) query.set("q", q);
  if (category) query.set("category", category);
  if (stock) query.set("stock", stock);
  return authed<Paginated<Product>>(`shops/${encodeURIComponent(slug)}/products?${query}`);
}

export async function getProductOverview(slug: string) {
  return authed<ProductOverview>(`shops/${encodeURIComponent(slug)}/products/overview`);
}

export async function getProduct(slug: string, id: string) {
  return authed<Product>(`shops/${encodeURIComponent(slug)}/products/${encodeURIComponent(id)}`);
}
