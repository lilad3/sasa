"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";
import type { CustomerDetail } from "@/lib/types";

const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);
// L'identifiant opaque d'un client : jamais un numéro de téléphone.
const CustomerId = z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);

export type VipState = { error?: FormError; fields?: Partial<Record<"phone" | "name", string>> };

/**
 * Nommer un client fidèle à la main, avec son numéro : un habitué de la boutique physique, par exemple.
 * Réservé au propriétaire (customers.vip, vérifié par Django). On arrive ensuite sur sa fiche.
 */
export async function nameVip(_previous: VipState, formData: FormData): Promise<VipState> {
  const parsed = z
    .object({
      slug: Slug,
      phone: z.string().trim().min(8, "Numéro à 10 chiffres, par exemple 07 07 12 34 56.").max(24),
      name: z.string().trim().max(120).optional(),
    })
    .safeParse({ slug: formData.get("slug"), phone: formData.get("phone") ?? "", name: formData.get("name") || undefined });
  if (!parsed.success) return { fields: { phone: z.flattenError(parsed.error).fieldErrors.phone?.[0] } };

  const { slug, phone, name } = parsed.data;
  const result = await authedMutation<CustomerDetail>(`shops/${slug}/customers/vip`, "POST", { phone, ...(name ? { name } : {}) });
  if (!result.ok) {
    const errors = result.problem.errors;
    if (errors?.phone || errors?.name) return { fields: { phone: errors.phone?.[0]?.message, name: errors.name?.[0]?.message } };
    return { error: describeProblem(result.problem) };
  }
  redirect(`/app/${slug}/clients/${result.data.id}`);
}

/** Retirer le statut de fidèle donné à la main. Le client reste fidèle s'il a assez de commandes livrées. */
export async function removeVip(formData: FormData) {
  const slug = Slug.safeParse(formData.get("slug"));
  const id = CustomerId.safeParse(formData.get("customer"));
  if (!slug.success || !id.success) return;
  await authedMutation(`shops/${slug.data}/customers/${id.data}/vip`, "DELETE");
  refresh();
}

export type ThresholdState = { done?: boolean; error?: FormError };

/** Le nombre de commandes livrées à partir duquel un client devient fidèle (customers.loyalty : propriétaire et gérant). */
export async function setLoyaltyThreshold(_previous: ThresholdState, formData: FormData): Promise<ThresholdState> {
  const parsed = z
    .object({ slug: Slug, threshold: z.coerce.number().int().min(1).max(50) })
    .safeParse({ slug: formData.get("slug"), threshold: formData.get("threshold") });
  if (!parsed.success) return { error: { code: "validation_error", message: "Entre 1 et 50 commandes livrées." } };

  const result = await authedMutation(`shops/${parsed.data.slug}/customers/settings`, "PATCH", { loyalty_threshold: parsed.data.threshold });
  if (!result.ok) return { error: describeProblem(result.problem) };
  refresh();
  return { done: true };
}
