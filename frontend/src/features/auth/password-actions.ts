"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { type FormError, messageFor } from "@/lib/messages";
import { callApi } from "@/lib/server/api";
import { requestContext } from "@/lib/server/session";

export type PasswordFormState = {
  done?: boolean;
  error?: FormError;
  fields?: Partial<Record<"email" | "password" | "confirmation", string>>;
};

// Codes renvoyés par Django dans errors.password (contrat §3.2).
const PASSWORD_RULES: Record<string, string> = {
  password_too_short: "Au moins 10 caractères.",
  password_too_long: "128 caractères au maximum.",
  password_too_common: "Ce mot de passe fait partie des plus courants : choisissez-en un autre.",
  password_too_similar: "Trop proche de votre e-mail, de votre nom ou du nom de votre boutique.",
  password_entirely_numeric: "Il ne peut pas contenir uniquement des chiffres.",
  password_local_pattern: "Évitez un mot évident (abidjan, akwaba, babi…) suivi de chiffres.",
};

const EmailSchema = z.string().trim().toLowerCase().min(1, "Indiquez votre adresse e-mail.").max(254).email("Cette adresse e-mail n'est pas valide.");

export async function requestReset(_previous: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const parsed = EmailSchema.safeParse(formData.get("email") ?? "");
  if (!parsed.success) return { fields: { email: parsed.error.issues[0]?.message } };

  const result = await callApi("auth/password/forgot", {
    method: "POST",
    body: { email: parsed.data },
    context: await requestContext(),
  });
  if (!result.ok) {
    return {
      error: { code: result.problem.code, message: messageFor(result.problem.code, result.problem.detail), retryAfter: result.problem.retry_after },
    };
  }
  // Toujours le même message : on ne révèle pas si l'adresse a un compte.
  return { done: true };
}

const ResetSchema = z
  .object({
    uid: z.string().min(1).max(64),
    token: z.string().min(1).max(128),
    password: z.string().min(10, PASSWORD_RULES.password_too_short).max(128, PASSWORD_RULES.password_too_long),
    confirmation: z.string(),
  })
  .refine((data) => data.password === data.confirmation, {
    path: ["confirmation"],
    message: "Les deux mots de passe ne sont pas identiques.",
  });

export async function resetPassword(_previous: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const parsed = ResetSchema.safeParse({
    uid: formData.get("uid") ?? "",
    token: formData.get("token") ?? "",
    password: formData.get("password") ?? "",
    confirmation: formData.get("confirmation") ?? "",
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    if (flat.uid || flat.token) return { error: { code: "token_invalid_or_expired", message: messageFor("token_invalid_or_expired") } };
    return { fields: { password: flat.password?.[0], confirmation: flat.confirmation?.[0] } };
  }

  const { uid, token, password } = parsed.data;
  const result = await callApi("auth/password/reset", {
    method: "POST",
    body: { uid, token, password },
    context: await requestContext(),
  });

  if (!result.ok) {
    const passwordErrors = result.problem.errors?.password;
    if (passwordErrors?.length) {
      return { fields: { password: passwordErrors.map((e) => PASSWORD_RULES[e.code] ?? e.message).join(" ") } };
    }
    return { error: { code: result.problem.code, message: messageFor(result.problem.code, result.problem.detail), retryAfter: result.problem.retry_after } };
  }

  // Django a révoqué toutes les sessions : on repart d'une connexion propre.
  redirect("/connexion?raison=mot_de_passe_modifie");
}
