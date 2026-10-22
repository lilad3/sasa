"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";

export type LogoState = { done?: string; error?: FormError };

const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);
const MAX_BYTES = 2 * 1024 * 1024;

const PROBLEMS: Record<string, string> = {
  file_too_large: "Image trop lourde : 2 Mo au maximum.",
  unsupported_file: "Image refusée : PNG, JPEG ou WebP seulement (pas de SVG ni de GIF).",
};

/**
 * Envoie le logo de la boutique. Le navigateur l'a déjà réduit à 512 px ; Django le revérifie
 * d'après son contenu, le réencode en PNG et retire les métadonnées (storefront.edit).
 */
export async function uploadLogo(_previous: LogoState, formData: FormData): Promise<LogoState> {
  const slug = Slug.safeParse(formData.get("slug"));
  const file = formData.get("logo");
  if (!slug.success || !(file instanceof File) || file.size === 0) return { error: { code: "validation_error", message: "Choisissez une image." } };
  if (file.size > MAX_BYTES) return { error: { code: "file_too_large", message: PROBLEMS.file_too_large } };

  const body = new FormData();
  body.append("logo", file, "logo.png");
  const result = await authedMutation<{ logo_version: string }>(`shops/${slug.data}/logo`, "POST", body);
  if (!result.ok) {
    const message = PROBLEMS[result.problem.code];
    return { error: message ? { code: result.problem.code, message } : describeProblem(result.problem) };
  }
  refresh();
  return { done: "Logo enregistré : il s’affiche déjà sur votre vitrine." };
}

export async function removeLogo(formData: FormData) {
  const slug = Slug.safeParse(formData.get("slug"));
  if (!slug.success) return;
  await authedMutation(`shops/${slug.data}/logo`, "DELETE");
  refresh();
}
