"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";

export type GoalState = { done?: boolean; error?: FormError };

const GoalForm = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
  amount: z.coerce.number().int().min(1000).max(2_000_000_000),
});

/**
 * Fixer l'objectif du mois. Seul le propriétaire en a le droit : Django le vérifie (goals.manage)
 * et prévient l'équipe par un message, sans montant pour les vendeurs.
 */
export async function setGoal(_previous: GoalState, formData: FormData): Promise<GoalState> {
  const parsed = GoalForm.safeParse({ slug: formData.get("slug"), amount: formData.get("amount") });
  if (!parsed.success) return { error: { code: "validation_error", message: "Montant entre 1 000 F et 2 milliards de F." } };

  const result = await authedMutation(`shops/${parsed.data.slug}/goal`, "PUT", { amount: parsed.data.amount });
  if (!result.ok) return { error: describeProblem(result.problem) };
  refresh();
  return { done: true };
}
