"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";

export type DemoState = { error?: FormError };

/** Remplit une boutique vide avec 180 jours de ventes fictives. Réservé au propriétaire (vérifié par Django). */
export async function generateDemoData(_previous: DemoState, formData: FormData): Promise<DemoState> {
  const slug = z.string().regex(/^[a-z0-9-]{1,60}$/).safeParse(formData.get("slug"));
  if (!slug.success) return { error: { code: "validation_error", message: "Boutique inconnue. Rechargez la page." } };

  const result = await authedMutation(`shops/${slug.data}/demo-data`, "POST");
  if (!result.ok) return { error: describeProblem(result.problem) };
  refresh();
  return {};
}
