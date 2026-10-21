"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { type FormError, describeProblem } from "@/lib/messages";
import { confirmIdentity } from "@/lib/server/reauth";
import { authedMutation, authedText } from "@/lib/server/session";
import type { Order } from "@/lib/types";

export type OrderActionState = { error?: FormError; done?: string };

// Le slug et l'identifiant finissent dans l'adresse de l'API : on n'accepte que leur forme attendue.
const StatusChange = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
  order: z.uuid(),
  status: z.enum(["confirmed", "shipped", "delivered", "cancelled"]),
});

const DONE: Record<z.infer<typeof StatusChange>["status"], string> = {
  confirmed: "Commande confirmée. Préparez le colis.",
  shipped: "Commande marquée comme expédiée.",
  delivered: "Commande livrée. Bravo.",
  cancelled: "Commande annulée. Elle ne compte plus dans votre chiffre d’affaires.",
};

/** Fait avancer une commande. Django vérifie le rôle et la transition ; le front ne fait que proposer. */
export async function changeOrderStatus(_previous: OrderActionState, formData: FormData): Promise<OrderActionState> {
  const parsed = StatusChange.safeParse({ slug: formData.get("slug"), order: formData.get("order"), status: formData.get("status") });
  if (!parsed.success) return { error: { code: "validation_error", message: "Action inconnue. Rechargez la page." } };

  const { slug, order, status } = parsed.data;
  const result = await authedMutation<Order>(`shops/${slug}/orders/${order}`, "PATCH", { status });
  if (!result.ok) {
    // Quelqu'un d'autre a pu traiter la commande entre-temps : on remet la page à jour.
    if (result.problem.code === "invalid_transition") refresh();
    return { error: describeProblem(result.problem) };
  }
  refresh();
  return { done: DONE[status] };
}

/* ---------- Notes internes ---------- */

export type OrderNoteState = { error?: FormError; field?: string; done?: boolean };

const OrderNoteInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
  order: z.uuid(),
  body: z.string().trim().min(2, "Écrivez la note.").max(500, "500 caractères au maximum."),
});

/** Note interne sur une commande, pour se passer le relais. Le client ne la voit jamais. */
export async function addOrderNote(_previous: OrderNoteState, formData: FormData): Promise<OrderNoteState> {
  const parsed = OrderNoteInput.safeParse({ slug: formData.get("slug"), order: formData.get("order"), body: formData.get("body") ?? "" });
  if (!parsed.success) return { field: z.flattenError(parsed.error).fieldErrors.body?.[0] ?? "Note invalide." };
  const { slug, order, body } = parsed.data;
  const result = await authedMutation(`shops/${slug}/orders/${order}/notes`, "POST", { body });
  if (!result.ok) return { error: describeProblem(result.problem) };
  refresh();
  return { done: true };
}

/* ---------- Export des ventes ---------- */

export type ExportState = { reauth?: boolean; reauthError?: string; error?: FormError; csv?: string; filename?: string };

const ExportInput = z
  .object({
    slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine((data) => data.from <= data.to, { path: ["from"], message: "La date de début est après la date de fin." });

/**
 * Export CSV des ventes. Toute la clientèle sort d'un coup : Django exige une confirmation renforcée.
 * Le fichier revient au navigateur, qui le télécharge ; Django a déjà noté l'export dans le journal.
 */
export async function exportOrders(_previous: ExportState, formData: FormData): Promise<ExportState> {
  const parsed = ExportInput.safeParse({ slug: formData.get("slug"), from: formData.get("from"), to: formData.get("to") });
  if (!parsed.success) return { error: { code: "validation_error", message: parsed.error.issues[0]?.message ?? "Dates invalides." } };

  const identity = await confirmIdentity(formData);
  if (!identity.ok) return { reauth: true, reauthError: identity.fieldError, error: identity.error };

  const { slug, from, to } = parsed.data;
  const result = await authedText(`shops/${slug}/orders/export?from=${from}&to=${to}`);
  if (!result.ok) {
    if (result.problem.code === "reauth_required") return { reauth: true };
    return { error: describeProblem(result.problem) };
  }
  return { csv: result.data, filename: `akwaba-${slug}-${from}-${to}.csv` };
}
