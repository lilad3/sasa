"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError, messageFor } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";
import type { DeliverySettings, Problem } from "@/lib/types";

const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);
const Id = z.uuid();

/** Texte brut, comme côté Django : ni balise ni caractère de contrôle. */
const PLAIN = /^[^<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/;
const NO_TAGS = "Les caractères < et > ne sont pas acceptés.";
const INVALID: FormError = { code: "validation_error", message: "Formulaire inattendu. Rechargez la page." };

export type DeliveryState = {
  error?: FormError;
  /** Erreurs par champ : `fee`, `delay_hours`, `city`… ou `zone.<id>.fee` pour une ligne de la liste. */
  fields?: Record<string, string>;
  done?: string;
};

/** « 1 500 », « 1500 » : un entier positif, sans centimes. */
function whole(raw: FormDataEntryValue | null) {
  const text = typeof raw === "string" ? raw.replace(/[\s  ]/g, "") : "";
  return /^\d{1,7}$/.test(text) ? Number(text) : null;
}

function failure(problem: Problem, rows?: string[]): DeliveryState {
  const fields: Record<string, string> = {};
  for (const [key, errors] of Object.entries(problem.errors ?? {})) {
    if (!errors[0]) continue;
    const row = /^zones\.(\d+)\.(fee|delay_hours)$/.exec(key);
    if (row && rows?.[Number(row[1])]) fields[`zone.${rows[Number(row[1])]}.${row[2]}`] = messageFor(errors[0].code, errors[0].message);
    else if (!row) fields[key] = messageFor(errors[0].code, errors[0].message);
  }
  if (problem.code === "plan_limit_reached" && problem.limit) {
    return { error: { code: problem.code, message: `Votre plan permet ${problem.limit} zones de livraison.` } };
  }
  if (problem.code === "zone_duplicate") fields.city = messageFor("zone_duplicate");
  if (problem.code === "too_many_requests") {
    return { error: { code: problem.code, message: "Trop de changements d’affilée. Réessayez dans quelques minutes." } };
  }
  return { error: describeProblem(problem), fields: Object.keys(fields).length ? fields : undefined };
}

/* ---------- Les zones modifiées, en une fois ---------- */

const Changes = z
  .array(z.object({ id: Id, fee: z.number().int().min(0), delay_hours: z.number().int().min(1), is_active: z.boolean() }))
  .min(1)
  .max(200);

/** Seules les lignes changées partent : frais, délai, actif. Rien n'est appliqué si une seule est refusée. */
export async function saveZones(_previous: DeliveryState, formData: FormData): Promise<DeliveryState> {
  const slug = Slug.safeParse(formData.get("slug"));
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(formData.get("zones") ?? "null"));
  } catch {
    raw = null;
  }
  const parsed = Changes.safeParse(raw);
  if (!slug.success || !parsed.success) return { error: INVALID };

  const result = await authedMutation<DeliverySettings>(`shops/${slug.data}/delivery/zones`, "PATCH", { zones: parsed.data });
  if (!result.ok) return failure(result.problem, parsed.data.map((zone) => zone.id));
  refresh();
  return { done: `${parsed.data.length} zone${parsed.data.length > 1 ? "s" : ""} enregistrée${parsed.data.length > 1 ? "s" : ""}.` };
}

/* ---------- Ajouter une zone ---------- */

const NewZone = z.object({
  slug: Slug,
  city: z.string().trim().min(1, "Indiquez la ville.").max(60, "60 caractères au maximum.").regex(PLAIN, NO_TAGS),
  commune: z.string().trim().max(60, "60 caractères au maximum.").regex(PLAIN, NO_TAGS),
});

export async function addZone(_previous: DeliveryState, formData: FormData): Promise<DeliveryState> {
  const parsed = NewZone.safeParse({ slug: formData.get("slug"), city: formData.get("city") ?? "", commune: formData.get("commune") ?? "" });
  const fee = whole(formData.get("fee"));
  const delay = whole(formData.get("delay_hours"));
  const fields: Record<string, string> = {};
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    if (flat.city?.[0]) fields.city = flat.city[0];
    if (flat.commune?.[0]) fields.commune = flat.commune[0];
    if (flat.slug) return { error: INVALID };
  }
  if (fee === null || fee > 100_000) fields.fee = "Les frais vont de 0 à 100 000 F.";
  if (delay === null || delay < 1 || delay > 240) fields.delay_hours = "Le délai va de 1 à 240 h.";
  if (!parsed.success || Object.keys(fields).length) return { fields };

  const { slug, ...body } = parsed.data;
  const result = await authedMutation(`shops/${slug}/delivery/zones`, "POST", { ...body, fee, delay_hours: delay });
  if (!result.ok) return failure(result.problem);
  refresh();
  return { done: `Zone ajoutée : ${[body.commune, body.city].filter(Boolean).join(", ")}.` };
}

/* ---------- Supprimer, ordonner ---------- */

const ZoneRef = z.object({ slug: Slug, id: Id });

/** Le serveur refuse (409 zone_in_use) une zone qui a déjà servi : le bouton n'existe pas pour elle, mais on ne s'y fie pas. */
export async function deleteZone(_previous: DeliveryState, formData: FormData): Promise<DeliveryState> {
  const parsed = ZoneRef.safeParse({ slug: formData.get("slug"), id: formData.get("id") });
  if (!parsed.success) return { error: INVALID };
  const result = await authedMutation(`shops/${parsed.data.slug}/delivery/zones/${parsed.data.id}`, "DELETE");
  if (!result.ok) {
    if (result.problem.status === 404) refresh();
    return failure(result.problem);
  }
  refresh();
  return { done: "Zone supprimée." };
}

const Order = z.object({ slug: Slug, ids: z.array(Id).min(1).max(500) });

export async function reorderZones(_previous: DeliveryState, formData: FormData): Promise<DeliveryState> {
  let raw: unknown = null;
  try {
    raw = JSON.parse(String(formData.get("ids") ?? "null"));
  } catch {
    raw = null;
  }
  const parsed = Order.safeParse({ slug: formData.get("slug"), ids: raw });
  if (!parsed.success) return { error: INVALID };
  const result = await authedMutation(`shops/${parsed.data.slug}/delivery/zones/order`, "PUT", { ids: parsed.data.ids });
  if (!result.ok) {
    // La liste a changé entre-temps (autre onglet) : on recharge plutôt que d'insister.
    if (result.problem.code === "order_mismatch") refresh();
    return failure(result.problem);
  }
  refresh();
  return { done: "Ordre enregistré." };
}

/* ---------- Retrait sur place ---------- */

const Pickup = z.object({
  slug: Slug,
  enabled: z.boolean(),
  address: z.string().trim().max(200, "200 caractères au maximum.").regex(PLAIN, NO_TAGS),
  hours: z.string().trim().max(160, "160 caractères au maximum.").regex(PLAIN, NO_TAGS),
});

export async function savePickup(_previous: DeliveryState, formData: FormData): Promise<DeliveryState> {
  const parsed = Pickup.safeParse({
    slug: formData.get("slug"),
    enabled: formData.get("enabled") === "on",
    address: formData.get("address") ?? "",
    hours: formData.get("hours") ?? "",
  });
  const prep = whole(formData.get("prep_hours"));
  const fields: Record<string, string> = {};
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    if (flat.slug) return { error: INVALID };
    if (flat.address?.[0]) fields.address = flat.address[0];
    if (flat.hours?.[0]) fields.hours = flat.hours[0];
  } else if (parsed.data.enabled && !parsed.data.address) {
    fields.address = messageFor("pickup_address_required");
  }
  if (prep === null || prep < 1 || prep > 168) fields.prep_hours = "La préparation va de 1 à 168 h.";
  if (!parsed.success || Object.keys(fields).length) return { fields };

  const { slug, ...body } = parsed.data;
  const result = await authedMutation(`shops/${slug}/delivery/pickup`, "PUT", { ...body, prep_hours: prep });
  if (!result.ok) return failure(result.problem);
  refresh();
  return { done: body.enabled ? "Le retrait sur place est proposé à vos clients." : "Le retrait sur place n’est plus proposé." };
}
