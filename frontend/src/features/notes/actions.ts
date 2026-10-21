"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";

const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

/** « C'est noté » : l'accusé de lecture. Django vérifie que la note m'est bien adressée. */
export async function acknowledgeNote(formData: FormData) {
  const slug = Slug.safeParse(formData.get("slug"));
  const note = z.uuid().safeParse(formData.get("note"));
  if (!slug.success || !note.success) return;
  await authedMutation(`shops/${slug.data}/notes/${note.data}/read`, "POST");
  refresh();
}

/** Retirer un message : il quitte le haut des pages de l'équipe, mais reste dans l'historique. */
export async function withdrawNote(formData: FormData) {
  const slug = Slug.safeParse(formData.get("slug"));
  const note = z.uuid().safeParse(formData.get("note"));
  if (!slug.success || !note.success) return;
  await authedMutation(`shops/${slug.data}/notes/${note.data}`, "DELETE");
  refresh();
}

export type ComposeState = {
  done?: boolean;
  error?: FormError;
  fields?: Partial<Record<"body" | "recipient", string>>;
};

const Compose = z
  .object({
    slug: Slug,
    body: z.string().trim().min(2, "Écrivez votre message.").max(1000, "1 000 caractères au maximum."),
    audience: z.enum(["all", "managers", "sellers", "member"]),
    recipient: z.string().optional(),
    urgent: z.boolean(),
  })
  .refine((data) => data.audience !== "member" || z.uuid().safeParse(data.recipient).success, {
    path: ["recipient"],
    message: "Choisissez la personne.",
  });

export async function sendNote(_previous: ComposeState, formData: FormData): Promise<ComposeState> {
  const parsed = Compose.safeParse({
    slug: formData.get("slug"),
    body: formData.get("body") ?? "",
    audience: formData.get("audience"),
    recipient: formData.get("recipient") || undefined,
    urgent: formData.get("urgent") === "on",
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return { fields: { body: flat.body?.[0], recipient: flat.recipient?.[0] } };
  }

  const { slug, ...note } = parsed.data;
  const result = await authedMutation(`shops/${slug}/notes`, "POST", {
    ...note,
    recipient: note.audience === "member" ? note.recipient : null,
  });
  if (!result.ok) {
    const errors = result.problem.errors;
    if (errors?.recipient?.length || errors?.audience?.length) {
      return { fields: { recipient: "Personne dans l’équipe ne recevrait ce message." } };
    }
    return { error: describeProblem(result.problem) };
  }
  refresh();
  return { done: true };
}
