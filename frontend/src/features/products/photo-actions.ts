"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";

import { PHOTO_PROBLEMS as PROBLEMS } from "./photo-files";

// Le slug et les identifiants finissent dans l'adresse de l'API : on n'accepte que leur forme attendue.
const Target = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,60}$/),
  product: z.uuid(),
});
const PhotoTarget = Target.extend({ photo: z.uuid() });

// Une Server Action accepte 1 Mo : le navigateur a déjà réduit la photo (photo-files.ts).
const MAX_BYTES = 1024 * 1024;

export type PhotoState = { done?: string; error?: FormError };

function failure(problem: Parameters<typeof describeProblem>[0]): PhotoState {
  const message = PROBLEMS[problem.code];
  return { error: message ? { code: problem.code, message } : describeProblem(problem) };
}

/**
 * Ajoute une photo au produit (products.write). Django la relit d'après son contenu, la redessine
 * en WebP et retire les métadonnées : ce qui part d'ici n'est jamais servi tel quel.
 */
export async function uploadPhoto(_previous: PhotoState, formData: FormData): Promise<PhotoState> {
  const target = Target.safeParse({ slug: formData.get("slug"), product: formData.get("product") });
  const file = formData.get("photo");
  if (!target.success || !(file instanceof File) || file.size === 0) return { error: { code: "validation_error", message: "Choisissez une image." } };
  if (file.size > MAX_BYTES) return { error: { code: "file_too_large", message: PROBLEMS.file_too_large } };

  const body = new FormData();
  body.append("photo", file, "photo");
  const { slug, product } = target.data;
  const result = await authedMutation<{ id: string }>(`shops/${slug}/products/${product}/photos`, "POST", body);
  if (!result.ok) return failure(result.problem);
  refresh();
  return { done: "Photo ajoutée : elle s’affiche déjà sur la vitrine." };
}

export async function removePhoto(_previous: PhotoState, formData: FormData): Promise<PhotoState> {
  const target = PhotoTarget.safeParse({ slug: formData.get("slug"), product: formData.get("product"), photo: formData.get("photo") });
  if (!target.success) return { error: { code: "validation_error", message: "Photo introuvable." } };
  const { slug, product, photo } = target.data;
  const result = await authedMutation(`shops/${slug}/products/${product}/photos/${photo}`, "DELETE");
  if (!result.ok) return failure(result.problem);
  refresh();
  return { done: "Photo retirée." };
}

export async function makeMainPhoto(_previous: PhotoState, formData: FormData): Promise<PhotoState> {
  const target = PhotoTarget.safeParse({ slug: formData.get("slug"), product: formData.get("product"), photo: formData.get("photo") });
  if (!target.success) return { error: { code: "validation_error", message: "Photo introuvable." } };
  const { slug, product, photo } = target.data;
  const result = await authedMutation(`shops/${slug}/products/${product}/photos/${photo}/main`, "PUT");
  if (!result.ok) return failure(result.problem);
  refresh();
  return { done: "C’est maintenant la photo principale." };
}

/** Met le produit à la une de la vitrine, ou l'en retire (storefront.edit). */
export async function setFeatured(_previous: PhotoState, formData: FormData): Promise<PhotoState> {
  const target = Target.safeParse({ slug: formData.get("slug"), product: formData.get("product") });
  const on = formData.get("featured") === "on";
  if (!target.success) return { error: { code: "validation_error", message: "Produit introuvable." } };
  const { slug, product } = target.data;
  const result = await authedMutation(`shops/${slug}/products/${product}/featured`, on ? "PUT" : "DELETE");
  if (!result.ok) return failure(result.problem);
  refresh();
  return { done: on ? "set" : "removed" };
}
