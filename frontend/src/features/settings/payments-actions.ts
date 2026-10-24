"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError, messageFor } from "@/lib/messages";
import { confirmIdentity } from "@/lib/server/reauth";
import { authedMutation } from "@/lib/server/session";
import type { PaymentMethod, PaymentSettings, Problem } from "@/lib/types";

const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

/** L'ordre des moyens envoyés à Django : les cinq, chacun une fois (contrat A2 §3.2). */
const PAYMENT_IDS = ["cash_on_delivery", "orange_money", "mtn_momo", "moov_money", "wave"] as const satisfies readonly PaymentMethod[];

/** Texte brut, comme côté Django : ni balise ni caractère de contrôle. */
const PLAIN = /^[^<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/;

const Row = z.object({
  enabled: z.boolean(),
  payout_number: z.string().trim().max(24, "24 caractères au maximum.").regex(PLAIN, "Les caractères < et > ne sont pas acceptés."),
  payout_name: z.string().trim().max(40, "40 caractères au maximum.").regex(PLAIN, "Les caractères < et > ne sont pas acceptés."),
});

export type PaymentsState = {
  error?: FormError;
  /** Erreur par moyen : `wave.number`, `wave.name`. */
  fields?: Record<string, string>;
  /** Django demande la confirmation : le formulaire montre le bloc, sans perdre la saisie. */
  reauth?: boolean;
  reauthError?: string;
  /** « Enregistré à 14 h 32. » */
  done?: string;
};

/** « 14 h 32 », à l'heure d'Abidjan (UTC, sans heure d'été). */
function nowInAbidjan() {
  const date = new Date();
  return `${String(date.getUTCHours()).padStart(2, "0")} h ${String(date.getUTCMinutes()).padStart(2, "0")}`;
}

/** « 3 min », « 5 h » : le délai avant de pouvoir réessayer (la limite est de 3 changements de numéro par jour). */
function waitText(seconds: number) {
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return minutes >= 120 ? `${Math.ceil(minutes / 60)} h` : `${minutes} min`;
}

/** Les erreurs de champ de Django (`methods.2.payout_number`) deviennent `wave.number`. */
function fieldErrors(problem: Problem) {
  const fields: Record<string, string> = {};
  for (const [key, errors] of Object.entries(problem.errors ?? {})) {
    const match = /^methods\.(\d+)\.payout_(number|name)$/.exec(key);
    const method = match ? PAYMENT_IDS[Number(match[1])] : undefined;
    if (match && method && errors[0]) fields[`${method}.${match[2]}`] = messageFor(errors[0].code, errors[0].message);
  }
  return Object.keys(fields).length ? fields : undefined;
}

/**
 * Remplace les 5 réglages d'un coup. Le serveur juge tout : au moins un moyen actif, numéro valide,
 * confirmation d'identité pour un numéro ou un nom, attente de 24 h pour un numéro qui en remplace un autre.
 */
export async function savePayments(_previous: PaymentsState, formData: FormData): Promise<PaymentsState> {
  const slug = Slug.safeParse(formData.get("slug"));
  if (!slug.success) return { error: { code: "validation_error", message: "Formulaire inattendu. Rechargez la page." } };

  const fields: Record<string, string> = {};
  const methods: { method: PaymentMethod; enabled: boolean; payout_number: string; payout_name: string }[] = [];
  for (const method of PAYMENT_IDS) {
    const parsed = Row.safeParse({
      enabled: formData.get(`${method}_enabled`) === "on",
      payout_number: formData.get(`${method}_number`) ?? "",
      payout_name: formData.get(`${method}_name`) ?? "",
    });
    if (!parsed.success) {
      const flat = z.flattenError(parsed.error).fieldErrors;
      if (flat.payout_number?.[0]) fields[`${method}.number`] = flat.payout_number[0];
      if (flat.payout_name?.[0]) fields[`${method}.name`] = flat.payout_name[0];
      continue;
    }
    methods.push({ method, ...parsed.data });
  }
  if (Object.keys(fields).length) return { fields };

  // Preuve d'identité jointe au formulaire : on ouvre la fenêtre de confirmation avant l'appel.
  const identity = await confirmIdentity(formData);
  if (!identity.ok) return { reauth: true, reauthError: identity.fieldError, error: identity.error };

  const result = await authedMutation<PaymentSettings>(`shops/${slug.data}/payment-settings`, "PUT", { methods });
  if (!result.ok) {
    const { problem } = result;
    if (problem.code === "reauth_required") return { reauth: true, error: describeProblem(problem) };
    if (problem.code === "demo_restricted") return { error: { code: problem.code, message: "Cette action est désactivée sur le compte de démonstration." } };
    if (problem.code === "too_many_requests") {
      return { error: { code: problem.code, message: `Trop de changements d’affilée. Réessayez dans ${waitText(problem.retry_after ?? 3600)}.` } };
    }
    return { error: describeProblem(problem), fields: fieldErrors(problem) };
  }
  refresh();
  return { done: `Enregistré à ${nowInAbidjan()}.` };
}

export type CancelState = { error?: FormError; done?: string };

const Cancel = z.object({ slug: Slug, method: z.enum(PAYMENT_IDS) });

/** Annuler l'attente d'un nouveau numéro : annuler protège, donc aucune confirmation n'est demandée. */
export async function cancelPendingNumber(_previous: CancelState, formData: FormData): Promise<CancelState> {
  const parsed = Cancel.safeParse({ slug: formData.get("slug"), method: formData.get("method") });
  if (!parsed.success) return { error: { code: "validation_error", message: "Formulaire inattendu. Rechargez la page." } };
  const result = await authedMutation<PaymentSettings>(`shops/${parsed.data.slug}/payment-settings/${parsed.data.method}/pending`, "DELETE");
  if (!result.ok) {
    // 404 : l'attente a pris fin entre-temps (le nouveau numéro sert déjà) ou a déjà été annulée.
    if (result.problem.status === 404) {
      refresh();
      return { error: { code: "not_found", message: "Il n’y a plus de changement en attente. La page est à jour." } };
    }
    return { error: describeProblem(result.problem) };
  }
  refresh();
  return { done: "Changement annulé. Vos clients gardent le numéro actuel." };
}
