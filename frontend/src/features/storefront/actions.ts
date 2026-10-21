"use server";

import { z } from "zod";

import { formatWait, messageFor } from "@/lib/messages";
import { callApi } from "@/lib/server/api";
import { requestContext } from "@/lib/server/session";
import type { PlacedOrder, TrackedOrder } from "@/lib/types";

// Ce que le navigateur envoie. Une Server Action est une route publique : on revalide tout ici,
// puis Django revalide encore (prix, stock, zone). Ce schéma ne fait que filtrer les envois absurdes.
const checkoutSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
  idempotencyKey: z.uuid(),
  items: z
    .array(z.object({ product_id: z.uuid(), quantity: z.number().int().min(1).max(99) }))
    .min(1)
    .max(30),
  customer: z.object({
    name: z.string().trim().max(120),
    phone: z.string().trim().max(24),
    city: z.string().max(60),
    commune: z.string().max(60),
    landmark: z.string().trim().max(160),
  }),
  payment_method: z.enum(["cash_on_delivery", "orange_money", "mtn_momo", "moov_money", "wave"]),
  expected_total: z.number().int().min(0),
  website: z.string().max(200),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export type CheckoutResult =
  | { ok: true; order: PlacedOrder }
  | {
      ok: false;
      code: string;
      message: string;
      /** Erreurs par champ, avec les clés de l'API : « customer.phone », « items.0.quantity »… */
      fields?: Record<string, string>;
      /** Stock restant par ligne du panier (index → quantité), sur out_of_stock. */
      available?: Record<number, number>;
      /** Nouveau total, sur price_changed. */
      total?: number;
      retryAfter?: number;
    };

export async function placeOrder(input: CheckoutInput): Promise<CheckoutResult> {
  const parsed = checkoutSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "validation_error", message: messageFor("validation_error") };
  const { slug, idempotencyKey, ...body } = parsed.data;

  const result = await callApi<PlacedOrder>(`storefront/${slug}/orders`, {
    method: "POST",
    body,
    idempotencyKey,
    context: await requestContext(),
  });
  if (result.ok) return { ok: true, order: result.data };

  const { problem } = result;
  const fields: Record<string, string> = {};
  const available: Record<number, number> = {};
  for (const [key, errors] of Object.entries(problem.errors ?? {})) {
    if (errors[0]) fields[key] = errors[0].message;
    const line = /^items\.(\d+)\.quantity$/.exec(key);
    if (line && typeof errors[0]?.available === "number") available[Number(line[1])] = errors[0].available;
  }
  return {
    ok: false,
    code: problem.code,
    message: messageFor(problem.code, problem.detail),
    fields: Object.keys(fields).length ? fields : undefined,
    available: Object.keys(available).length ? available : undefined,
    total: problem.total,
    retryAfter: problem.retry_after,
  };
}

/* ---------- Suivi de commande ---------- */

export type TrackState = {
  order?: TrackedOrder;
  error?: string;
  fields?: Partial<Record<"reference" | "phone_last4", string>>;
};

const trackSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
  // « k7f 92q », « K7F-92Q » : Django normalise aussi, ceci évite seulement un aller-retour.
  reference: z
    .string()
    .transform((value) => value.replace(/[^A-Za-z0-9]/g, "").toUpperCase())
    .pipe(z.string().length(6, "La référence a 6 caractères, par exemple K7F-92Q.")),
  phone_last4: z
    .string()
    .transform((value) => value.replace(/\D/g, ""))
    .pipe(z.string().length(4, "Les 4 derniers chiffres du numéro donné à la commande.")),
});

/**
 * Le client retrouve sa commande avec la référence et la fin de son numéro, sans compte.
 * Django limite les essais (5 par heure et par référence) et répond pareil pour une référence inconnue
 * et un numéro faux : impossible de deviner si une référence existe.
 */
export async function trackOrder(_previous: TrackState, formData: FormData): Promise<TrackState> {
  const parsed = trackSchema.safeParse({
    slug: formData.get("slug"),
    reference: formData.get("reference") ?? "",
    phone_last4: formData.get("phone_last4") ?? "",
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return { fields: { reference: flat.reference?.[0], phone_last4: flat.phone_last4?.[0] } };
  }
  const { slug, reference, phone_last4 } = parsed.data;
  const result = await callApi<TrackedOrder>(`storefront/${slug}/track`, {
    method: "POST",
    body: { reference: `${reference.slice(0, 3)}-${reference.slice(3)}`, phone_last4 },
    context: await requestContext(),
  });
  if (result.ok) return { order: result.data };

  const { problem } = result;
  if (problem.status === 404) return { error: "Aucune commande ne correspond à cette référence et à ce numéro. Vérifiez la référence reçue à la commande." };
  if (problem.code === "too_many_requests") {
    return { error: `Trop d’essais pour cette commande.${problem.retry_after ? ` Réessayez dans ${formatWait(problem.retry_after)}.` : " Réessayez plus tard."}` };
  }
  return { error: messageFor(problem.code, problem.detail) };
}
