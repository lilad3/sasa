"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { confirmIdentity } from "@/lib/server/reauth";
import { authedMutation, authedText } from "@/lib/server/session";
import type { CreatedDiscount, CustomerDetail } from "@/lib/types";

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

/* ---------- Réductions personnelles (docs/chantier-p5.md §1.3 et §1.4) ---------- */

export type GiveDiscountState = {
  reauth?: boolean;
  reauthError?: string;
  error?: FormError;
  fields?: Partial<Record<"value" | "ends_on" | "max_uses", string>>;
  created?: CreatedDiscount;
};

const GiveDiscount = z.object({
  slug: Slug,
  customer: CustomerId,
  kind: z.enum(["percent", "amount"]),
  value: z.coerce.number("Indiquez un nombre.").int("Un nombre entier.").min(1, "Au moins 1.").max(1_000_000, "Trop élevé."),
  ends_on: z.iso.date("Choisissez une date."),
  max_uses: z.coerce.number().int().min(1, "Au moins 1 fois.").max(10, "10 fois au plus."),
});

/**
 * Offrir une réduction à un client. Django décide : droit discounts.give, plafond du gérant, valeurs permises.
 * Offrir demande une confirmation renforcée (une session volée ne doit pas distribuer de codes).
 */
export async function giveDiscount(_previous: GiveDiscountState, formData: FormData): Promise<GiveDiscountState> {
  const parsed = GiveDiscount.safeParse({
    slug: formData.get("slug"),
    customer: formData.get("customer"),
    kind: formData.get("kind"),
    value: formData.get("value"),
    ends_on: formData.get("ends_on"),
    max_uses: formData.get("max_uses") ?? "1",
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    if (flat.slug || flat.customer || flat.kind) return { error: { code: "validation_error", message: "Formulaire inattendu. Rechargez la page." } };
    return { fields: { value: flat.value?.[0], ends_on: flat.ends_on?.[0], max_uses: flat.max_uses?.[0] } };
  }

  const identity = await confirmIdentity(formData);
  if (!identity.ok) return { reauth: true, reauthError: identity.fieldError, error: identity.error };

  const { slug, customer, ...body } = parsed.data;
  const result = await authedMutation<CreatedDiscount>(`shops/${slug}/customers/${customer}/discounts`, "POST", body);
  if (!result.ok) {
    const { problem } = result;
    if (problem.code === "reauth_required") return { reauth: true };
    if (problem.code === "discount_cap_exceeded" && problem.limit) {
      return { fields: { value: `Votre plafond est de ${problem.limit} %.` } };
    }
    const errors = problem.errors;
    if (errors?.value || errors?.ends_on || errors?.max_uses) {
      return { fields: { value: errors.value?.[0]?.message, ends_on: errors.ends_on?.[0]?.message, max_uses: errors.max_uses?.[0]?.message } };
    }
    return { error: describeProblem(problem) };
  }
  refresh();
  return { created: result.data };
}

/** Annuler une réduction : définitif, sans confirmation renforcée (annuler protège la boutique). */
export async function revokeDiscount(formData: FormData) {
  const slug = Slug.safeParse(formData.get("slug"));
  const id = z.uuid().safeParse(formData.get("discount"));
  if (!slug.success || !id.success) return;
  await authedMutation(`shops/${slug.data}/discounts/${id.data}`, "DELETE");
  refresh();
}

/* ---------- Export des clients ---------- */

export type CustomerExportState = { reauth?: boolean; reauthError?: string; error?: FormError; csv?: string; filename?: string };

const SEGMENTS = ["all", "loyal", "new", "win_back", "at_risk"] as const;

/**
 * Export CSV des clients, téléphones en clair (customers.export). Django exige une confirmation
 * renforcée et note l'export dans le journal ; le navigateur télécharge le fichier.
 */
export async function exportCustomers(_previous: CustomerExportState, formData: FormData): Promise<CustomerExportState> {
  const parsed = z.object({ slug: Slug, segment: z.enum(SEGMENTS) }).safeParse({ slug: formData.get("slug"), segment: formData.get("segment") });
  if (!parsed.success) return { error: { code: "validation_error", message: "Choisissez les clients à exporter." } };

  const identity = await confirmIdentity(formData);
  if (!identity.ok) return { reauth: true, reauthError: identity.fieldError, error: identity.error };

  const { slug, segment } = parsed.data;
  const result = await authedText(`shops/${slug}/customers/export?segment=${segment}`);
  if (!result.ok) {
    if (result.problem.code === "reauth_required") return { reauth: true };
    if (result.problem.code === "too_many_requests") return { error: { code: "too_many_requests", message: "Trop d’exports en une heure. Réessayez un peu plus tard." } };
    return { error: describeProblem(result.problem) };
  }
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Abidjan" }).format(new Date());
  return { csv: result.data, filename: `akwaba-${slug}-clients-${day}.csv` };
}
