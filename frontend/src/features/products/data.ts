import "server-only";

import { authed } from "@/lib/server/session";
import type { Paginated } from "@/lib/types";

import type { MovementPage, Product, ProductFilters, ProductOverview } from "./types";

export async function getProducts(slug: string, { q, category, stock, status, tag, page }: ProductFilters) {
  const query = new URLSearchParams({ page: String(page), page_size: "25" });
  if (q) query.set("q", q);
  if (category) query.set("category", category);
  if (stock) query.set("stock", stock);
  if (status) query.set("status", status);
  if (tag) query.set("tag", tag);
  return authed<Paginated<Product>>(`shops/${encodeURIComponent(slug)}/products?${query}`);
}

export async function getProductOverview(slug: string) {
  return authed<ProductOverview>(`shops/${encodeURIComponent(slug)}/products/overview`);
}

export async function getProduct(slug: string, id: string) {
  return authed<Product>(`shops/${encodeURIComponent(slug)}/products/${encodeURIComponent(id)}`);
}

export async function getMovements(slug: string, id: string, before?: string) {
  const query = before ? `?${new URLSearchParams({ before })}` : "";
  return authed<MovementPage>(`shops/${encodeURIComponent(slug)}/products/${encodeURIComponent(id)}/stock-movements${query}`);
}

export async function getTagSuggestions(slug: string, q: string) {
  return authed<{ label: string; count: number }[]>(`shops/${encodeURIComponent(slug)}/products/tags?${new URLSearchParams({ q })}`);
}
