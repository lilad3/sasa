"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { designSchema } from "@/lib/design";
import { describeProblem } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";
import type { DesignVersion, Problem, StorefrontDesign } from "@/lib/types";

// « Ma boutique » (docs/chantier-p5.md §3.3). Django revalide tout et vérifie le plan ; zod écarte ici
// ce qui n'a pas la forme attendue avant même l'appel.

export type DesignResult = { ok: true; message: string; config?: StorefrontDesign } | { ok: false; message: string };

const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

function failure(problem: Problem): DesignResult {
  // Le refus du plan dit précisément ce qui coince (« Le thème Beauté est compris à partir du plan Pro »).
  if (problem.code === "plan_limit_reached" && problem.detail) return { ok: false, message: problem.detail };
  if (problem.code === "too_many_requests") return { ok: false, message: "Beaucoup d’enregistrements en peu de temps : réessayez dans un instant." };
  return { ok: false, message: describeProblem(problem).message };
}

async function save(slug: string, design: unknown) {
  const parsed = designSchema.safeParse(design);
  if (!Slug.safeParse(slug).success || !parsed.success) return { ok: false as const, problem: { status: 400, code: "validation_error", detail: "Réglages invalides." } as Problem };
  const result = await authedMutation<DesignVersion>(`shops/${slug}/storefront/draft`, "PUT", { config: parsed.data });
  return result.ok ? { ok: true as const, draft: result.data } : { ok: false as const, problem: result.problem };
}

export async function saveDesign(slug: string, design: unknown): Promise<DesignResult> {
  const saved = await save(slug, design);
  if (!saved.ok) return failure(saved.problem);
  refresh();
  return { ok: true, message: "Brouillon enregistré. Vos clients voient toujours la version en ligne." };
}

/** Enregistre ce qui est à l'écran, puis le met en ligne. */
export async function publishDesign(slug: string, design: unknown): Promise<DesignResult> {
  const saved = await save(slug, design);
  if (!saved.ok) return failure(saved.problem);
  const published = await authedMutation<DesignVersion>(`shops/${slug}/storefront/publish`, "POST");
  if (!published.ok) return failure(published.problem);
  refresh();
  return { ok: true, message: "C’est en ligne : vos clients voient la nouvelle vitrine." };
}

export async function discardDesign(slug: string): Promise<DesignResult> {
  if (!Slug.safeParse(slug).success) return { ok: false, message: "Boutique introuvable." };
  const result = await authedMutation(`shops/${slug}/storefront/draft`, "DELETE");
  if (!result.ok) return failure(result.problem);
  refresh();
  return { ok: true, message: "Brouillon abandonné." };
}

export async function restoreDesign(slug: string, number: number): Promise<DesignResult> {
  if (!Slug.safeParse(slug).success || !Number.isInteger(number) || number < 1) return { ok: false, message: "Version introuvable." };
  const result = await authedMutation<DesignVersion>(`shops/${slug}/storefront/versions/${number}/restore`, "POST");
  if (!result.ok) return failure(result.problem);
  refresh();
  return { ok: true, message: `La version ${number} est reprise dans le brouillon : publiez-la pour la remettre en ligne.`, config: result.data.config };
}
