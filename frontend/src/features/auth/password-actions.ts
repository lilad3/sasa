"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { type FormError, messageFor, PASSWORD_RULES } from "@/lib/messages";
import { callApi } from "@/lib/server/api";
import { authedMutation, requestContext } from "@/lib/server/session";

export type PasswordFormState = {
  done?: boolean;
  error?: FormError;
  fields?: Partial<Record<"email" | "password" | "confirmation", string>>;
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

const FirstPasswordSchema = z
  .object({
    temporary: z.string().min(1, "Indiquez le mot de passe provisoire reçu.").max(128),
    password: z.string().min(10, PASSWORD_RULES.password_too_short).max(128, PASSWORD_RULES.password_too_long),
    confirmation: z.string(),
  })
  .refine((data) => data.password === data.confirmation, {
    path: ["confirmation"],
    message: "Les deux mots de passe ne sont pas identiques.",
  });

export type FirstPasswordState = { error?: FormError; fields?: Partial<Record<"temporary" | "password" | "confirmation", string>> };

/**
 * Première connexion d'un compte créé par le patron : le mot de passe provisoire, qu'il a vu,
 * est remplacé par un mot de passe que personne d'autre ne connaît. Django débloque alors le compte.
 */
export async function chooseFirstPassword(_previous: FirstPasswordState, formData: FormData): Promise<FirstPasswordState> {
  const parsed = FirstPasswordSchema.safeParse({
    temporary: formData.get("temporary") ?? "",
    password: formData.get("password") ?? "",
    confirmation: formData.get("confirmation") ?? "",
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return { fields: { temporary: flat.temporary?.[0], password: flat.password?.[0], confirmation: flat.confirmation?.[0] } };
  }

  const result = await authedMutation("me/password", "POST", { current_password: parsed.data.temporary, password: parsed.data.password });
  if (!result.ok) {
    const errors = result.problem.errors;
    if (errors?.current_password?.length) return { fields: { temporary: "Ce n’est pas le mot de passe provisoire reçu." } };
    if (errors?.password?.length) {
      return { fields: { password: errors.password.map((e) => PASSWORD_RULES[e.code] ?? e.message).join(" ") } };
    }
    return { error: { code: result.problem.code, message: messageFor(result.problem.code, result.problem.detail), retryAfter: result.problem.retry_after } };
  }
  redirect("/app");
}
