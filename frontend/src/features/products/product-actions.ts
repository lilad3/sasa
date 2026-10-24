"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";

import { getMovements } from "./data";
import type { MovementPage, Product, StockMovement } from "./types";

const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);
const ProductId = z.uuid();
const bad = (): { error: FormError } => ({ error: { code: "validation_error", message: "Fiche inconnue. Rechargez la page." } });

/* ---------- Dupliquer, archiver ---------- */

export type ActionState = { error?: FormError };

/** Crée une copie en brouillon (stock à 0, ni à la une) puis ouvre sa fiche. Django applique la limite du plan. */
export async function duplicateProduct(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const slug = Slug.safeParse(formData.get("slug"));
  const id = ProductId.safeParse(formData.get("product"));
  if (!slug.success || !id.success) return bad();
  const result = await authedMutation<Product>(`shops/${slug.data}/products/${id.data}/duplicate`, "POST");
  if (!result.ok) return { error: describeProblem(result.problem) };
  redirect(`/app/${slug.data}/produits/${result.data.id}?ok=copie`);
}

/** Change le statut (archiver, ranger en brouillon, remettre en vente). Django retire la une et vérifie le plan. */
export async function setProductStatus(_previous: ActionState, formData: FormData): Promise<ActionState> {
  const slug = Slug.safeParse(formData.get("slug"));
  const id = ProductId.safeParse(formData.get("product"));
  const status = z.enum(["draft", "active", "archived"]).safeParse(formData.get("status"));
  if (!slug.success || !id.success || !status.success) return bad();
  const result = await authedMutation<Product>(`shops/${slug.data}/products/${id.data}`, "PATCH", { status: status.data });
  if (!result.ok) return { error: describeProblem(result.problem) };
  refresh();
  return {};
}

/* ---------- Ajuster le stock ---------- */

export type StockState = {
  error?: FormError;
  fields?: Partial<Record<"quantity" | "reason" | "note", string>>;
  /** Le stock après l'ajustement : la feuille se ferme et la page se rafraîchit. */
  done?: { stock: number };
};

const REASONS = ["received", "returned", "damaged", "correction"] as const;

/**
 * « Ajouter ou retirer » (mode add) ou « J'ai compté » (mode count). La raison est obligatoire pour ajouter ou retirer ;
 * Django décide de tout (signe de la raison, jamais sous zéro) et écrit le mouvement.
 */
export async function adjustStock(_previous: StockState, formData: FormData): Promise<StockState> {
  const slug = Slug.safeParse(formData.get("slug"));
  const id = ProductId.safeParse(formData.get("product"));
  if (!slug.success || !id.success) return bad();
  const mode = formData.get("mode") === "count" ? "count" : "add";
  const note = String(formData.get("note") ?? "").trim();
  if (note.length > 200) return { fields: { note: "200 caractères au maximum." } };

  const raw = String(formData.get("quantity") ?? "").replace(/[\s\u00a0\u202f]/g, "");
  if (!/^-?\d+$/.test(raw)) return { fields: { quantity: mode === "count" ? "Indiquez la quantité comptée." : "Indiquez la quantité à ajouter ou à retirer." } };
  const quantity = Number(raw);

  const body: Record<string, unknown> = { ...(note ? { note } : {}) };
  if (mode === "count") {
    if (quantity < 0) return { fields: { quantity: "Quantité entière, 0 ou plus." } };
    body.count = quantity;
  } else {
    const reason = z.enum(REASONS).safeParse(formData.get("reason"));
    if (!reason.success) return { fields: { reason: "Choisissez la raison." } };
    if (quantity === 0) return { fields: { quantity: "Indiquez la quantité à ajouter ou à retirer." } };
    body.delta = quantity;
    body.reason = reason.data;
  }

  const result = await authedMutation<{ movement: StockMovement | null; stock: number }>(`shops/${slug.data}/products/${id.data}/stock`, "POST", body);
  if (!result.ok) {
    const first = (field: string) => result.problem.errors?.[field]?.[0]?.message;
    if (result.problem.code === "stock_below_zero" && typeof result.problem.available === "number") {
      return { fields: { quantity: `Il n’y en a que ${result.problem.available}.` } };
    }
    if (first("reason")) return { fields: { reason: first("reason") } };
    if (first("delta")) return { fields: { quantity: first("delta") } };
    return { error: describeProblem(result.problem) };
  }
  refresh();
  return { done: { stock: result.data.stock } };
}

/** « Voir plus » : les mouvements plus anciens que `before`. */
export async function moreMovements(slug: string, productId: string, before: string): Promise<MovementPage | null> {
  if (!Slug.safeParse(slug).success || !ProductId.safeParse(productId).success || Number.isNaN(Date.parse(before))) return null;
  const result = await getMovements(slug, productId, before);
  return result.ok ? result.data : null;
}
