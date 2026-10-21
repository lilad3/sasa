"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";
import type { Problem } from "@/lib/types";

import type { ImportReport, Product } from "./types";

/* ---------- Fiche produit ---------- */

export type ProductField = "name" | "sku" | "price" | "stock" | "low_stock_threshold" | "category" | "description" | "image_url";

export type ProductFormState = { error?: FormError; fields?: Partial<Record<ProductField, string>>; done?: string };

// Le slug et l'identifiant finissent dans l'adresse de l'API : on n'accepte que leur forme attendue.
const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

/** Nombre entier saisi à la main : « 12 500 », « 12500 F » ou « 12 500 FCFA ». */
function whole(min: number, max: number, message: string) {
  return z
    .string()
    .transform((value) => value.replace(/[\s  ]/g, "").replace(/f(cfa)?$/i, ""))
    .pipe(z.string().regex(/^\d+$/, message).transform(Number).pipe(z.number().min(min, message).max(max, message)));
}

// Les mêmes règles que ProductSerializer : Django reste juge, ceci évite seulement un aller-retour.
const ProductInput = z.object({
  name: z.string().trim().min(2, "Au moins 2 caractères.").max(120, "120 caractères au maximum."),
  sku: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/, "Lettres, chiffres, point, tiret ou soulignement, 40 au plus."),
  price: whole(1, 100_000_000, "Prix en francs CFA, sans centimes."),
  stock: whole(0, 1_000_000, "Quantité entière, 0 ou plus."),
  low_stock_threshold: whole(0, 10_000, "Nombre entier, 0 ou plus."),
  category: z.string().trim().max(40, "40 caractères au maximum."),
  description: z.string().trim().max(2000, "2 000 caractères au maximum."),
  image_url: z
    .string()
    .trim()
    .max(200, "200 caractères au maximum.")
    .refine((value) => value === "" || /^https:\/\/\S+$/i.test(value), "Adresse d’image en https:// attendue."),
  is_active: z.boolean(),
});

const FIELDS: ProductField[] = ["name", "sku", "price", "stock", "low_stock_threshold", "category", "description", "image_url"];

/** Les erreurs de Django par champ, avec son message (déjà en français). */
function fieldErrors(problem: Problem): ProductFormState["fields"] {
  const fields: ProductFormState["fields"] = {};
  for (const field of FIELDS) {
    const first = problem.errors?.[field]?.[0];
    if (first) fields[field] = first.message;
  }
  return Object.keys(fields).length ? fields : undefined;
}

/** Crée ou modifie un produit. Django vérifie le rôle et la limite du plan ; le front ne fait que proposer. */
export async function saveProduct(_previous: ProductFormState, formData: FormData): Promise<ProductFormState> {
  const slug = Slug.safeParse(formData.get("slug"));
  const productId = formData.get("product");
  const id = productId ? z.uuid().safeParse(productId) : null;
  if (!slug.success || (id && !id.success)) return { error: { code: "validation_error", message: "Fiche inconnue. Rechargez la page." } };

  const text = (name: string) => String(formData.get(name) ?? "");
  const parsed = ProductInput.safeParse({
    name: text("name"),
    sku: text("sku"),
    price: text("price"),
    stock: text("stock"),
    low_stock_threshold: text("low_stock_threshold"),
    category: text("category"),
    description: text("description"),
    image_url: text("image_url"),
    is_active: formData.get("is_active") === "on",
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return { fields: Object.fromEntries(FIELDS.flatMap((field) => (flat[field]?.[0] ? [[field, flat[field][0]]] : []))) };
  }

  const base = `shops/${slug.data}/products`;
  const result = id
    ? await authedMutation<Product>(`${base}/${id.data}`, "PATCH", parsed.data)
    : await authedMutation<Product>(base, "POST", parsed.data);
  if (!result.ok) {
    const fields = fieldErrors(result.problem);
    return fields ? { fields } : { error: describeProblem(result.problem) };
  }
  if (!id) redirect(`/app/${slug.data}/produits?ok=ajoute`);
  refresh();
  return { done: "Modifications enregistrées. La vitrine est à jour." };
}

export type DeleteState = { error?: FormError };

/** Supprime un produit. Les commandes passées gardent son nom et son prix. */
export async function deleteProduct(_previous: DeleteState, formData: FormData): Promise<DeleteState> {
  const slug = Slug.safeParse(formData.get("slug"));
  const id = z.uuid().safeParse(formData.get("product"));
  if (!slug.success || !id.success) return { error: { code: "validation_error", message: "Fiche inconnue. Rechargez la page." } };

  const result = await authedMutation(`shops/${slug.data}/products/${id.data}`, "DELETE");
  // Déjà supprimé ailleurs : le résultat est le même pour le marchand.
  if (!result.ok && result.problem.status !== 404) return { error: describeProblem(result.problem) };
  redirect(`/app/${slug.data}/produits?ok=supprime`);
}

/* ---------- Import CSV ---------- */

export type ImportState = { report?: ImportReport; fileName?: string; error?: FormError };

const MAX_BYTES = 512 * 1024;

/**
 * Envoie le CSV à Django. `dry_run` ne fait qu'un aperçu ; l'import réel est tout ou rien.
 * Le fichier lui-même est validé par Django (taille, format, colonnes) : ces contrôles évitent seulement un envoi inutile.
 */
export async function importProducts(_previous: ImportState, formData: FormData): Promise<ImportState> {
  const slug = Slug.safeParse(formData.get("slug"));
  const file = formData.get("file");
  const dryRun = formData.get("dry_run") === "1";
  if (!slug.success) return { error: { code: "validation_error", message: "Boutique inconnue. Rechargez la page." } };
  if (!(file instanceof File) || file.size === 0) return { error: { code: "validation_error", message: "Choisissez un fichier CSV." } };
  if (!file.name.toLowerCase().endsWith(".csv")) {
    return { error: { code: "unsupported_file", message: "Envoyez un fichier .csv (Excel : Fichier > Enregistrer sous > CSV)." } };
  }
  if (file.size > MAX_BYTES) return { error: { code: "file_too_large", message: "Fichier trop lourd : 512 Ko au maximum (environ 1 000 produits)." } };

  const upload = new FormData();
  upload.append("file", file, file.name);
  upload.append("dry_run", dryRun ? "1" : "0");
  const result = await authedMutation<ImportReport>(`shops/${slug.data}/products/import`, "POST", upload);
  if (!result.ok) {
    // Fichier sans colonne « sku » : le message de Django dit quoi corriger, mieux que « champs à corriger ».
    const fileError = result.problem.errors?.file?.[0];
    if (fileError) return { fileName: file.name, error: { code: fileError.code, message: result.problem.detail } };
    return { fileName: file.name, error: describeProblem(result.problem) };
  }
  if (!dryRun && result.data.error_count === 0) refresh();
  return { report: result.data, fileName: file.name };
}
