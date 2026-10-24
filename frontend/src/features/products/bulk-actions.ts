"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { confirmIdentity } from "@/lib/server/reauth";
import { authedMutation } from "@/lib/server/session";

import type { BulkAction } from "./types";

const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

export type BulkFailure = { product_id: string; sku: string; code: string; message: string };

export type BulkState = {
  error?: FormError;
  /** Les produits qui empêchent l'action : rien n'a été modifié. */
  failed?: BulkFailure[];
  /** Baisser des prix demande une confirmation renforcée (une session volée ne doit pas casser les prix). */
  reauth?: boolean;
  reauthError?: string;
  done?: number;
};

const Whole = z.string().transform((value) => value.replace(/[\s  ]/g, "")).pipe(z.string().regex(/^-?\d+$/, "Un nombre entier.").transform(Number));

const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("price"), mode: z.enum(["set", "percent"]), value: Whole }),
  z.object({
    type: z.literal("stock"),
    mode: z.enum(["add", "set"]),
    value: Whole,
    reason: z.enum(["received", "returned", "damaged", "correction"], "Choisissez la raison."),
  }),
  z.object({ type: z.literal("status"), status: z.enum(["draft", "active", "archived"]) }),
  z.object({ type: z.literal("tag_add"), label: z.string().trim().min(1, "Écrivez l’étiquette.").max(30, "30 caractères au maximum.") }),
  z.object({ type: z.literal("tag_remove"), label: z.string().trim().min(1, "Écrivez l’étiquette.").max(30, "30 caractères au maximum.") }),
]);

/**
 * Modifie jusqu'à 100 produits d'un coup, tout ou rien. Django décide : droit, appartenance de chaque identifiant
 * (un identifiant étranger fait tout échouer, comme un inconnu), règles de chaque produit, confirmation renforcée si un prix baisse.
 */
export async function bulkUpdate(_previous: BulkState, formData: FormData): Promise<BulkState> {
  const slug = Slug.safeParse(formData.get("slug"));
  const ids = z.array(z.uuid()).min(1).max(100).safeParse(formData.getAll("ids"));
  const field = (name: string) => formData.get(name) ?? undefined;
  const action = Action.safeParse({
    type: field("type"), mode: field("mode"), value: field("value"), reason: field("reason"), status: field("status"), label: field("label"),
  });
  if (!slug.success || !ids.success) return { error: { code: "invalid_selection", message: "La sélection n’est plus valide. Actualisez la liste." } };
  if (!action.success) return { error: { code: "validation_error", message: action.error.issues[0]?.message ?? "Vérifiez les champs." } };

  const identity = await confirmIdentity(formData);
  if (!identity.ok) return { reauth: true, reauthError: identity.fieldError, error: identity.error };

  const body: { ids: string[]; action: BulkAction } = { ids: ids.data, action: action.data as BulkAction };
  const result = await authedMutation<{ count: number }>(`shops/${slug.data}/products/bulk`, "POST", body);
  if (!result.ok) {
    const { problem } = result;
    if (problem.code === "reauth_required") return { reauth: true };
    if (problem.code === "bulk_failed" && Array.isArray(problem.errors)) return { failed: problem.errors as unknown as BulkFailure[], error: describeProblem(problem) };
    return { error: describeProblem(problem) };
  }
  refresh();
  return { done: result.data.count };
}
