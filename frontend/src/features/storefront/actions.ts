"use server";

import { z } from "zod";

import { messageFor } from "@/lib/messages";
import { callApi } from "@/lib/server/api";
import { requestContext } from "@/lib/server/session";
import type { PlacedOrder } from "@/lib/types";

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
