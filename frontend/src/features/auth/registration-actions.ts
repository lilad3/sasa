"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { type FormError, messageFor, PASSWORD_RULES } from "@/lib/messages";
import { callApi } from "@/lib/server/api";
import { deviceIdFor, rememberDevice, setSessionCookies } from "@/lib/server/cookies";
import { requestContext } from "@/lib/server/session";
import type { AuthResult } from "@/lib/types";

export type RegistrationState = {
  done?: boolean;
  error?: FormError;
  fields?: Partial<Record<"email" | "first_name" | "last_name" | "shop_name" | "password" | "plan", string>>;
};

const SignupSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Indiquez votre adresse e-mail.").max(254).email("Cette adresse e-mail n'est pas valide."),
  first_name: z.string().trim().min(1, "Indiquez votre prénom.").max(80),
  last_name: z.string().trim().min(1, "Indiquez votre nom.").max(80),
  shop_name: z.string().trim().min(2, "Le nom de la boutique doit contenir au moins 2 caractères.").max(60),
  // Seulement dans l'inscription en une étape (sans e-mail) : le formulaire avec lien n'a pas ce champ.
  password: z.string().min(10, PASSWORD_RULES.password_too_short).max(128, PASSWORD_RULES.password_too_long).optional(),
  // Le plan de la boutique : en démo, il s'applique tout de suite, sans paiement (Django n'accepte que ces trois-là).
  plan: z.enum(["free", "pro", "business"], "Choisissez un plan."),
});

type SignupField = keyof NonNullable<RegistrationState["fields"]>;
const SIGNUP_FIELDS: SignupField[] = ["email", "first_name", "last_name", "shop_name", "password", "plan"];

/**
 * Inscription. Django répond 202 quand il envoie un lien de confirmation (mode e-mail),
 * ou 201 avec la session quand le compte est créé tout de suite (mode en une étape).
 */
export async function requestSignup(_previous: RegistrationState, formData: FormData): Promise<RegistrationState> {
  const password = formData.get("password");
  const parsed = SignupSchema.safeParse({
    email: formData.get("email") ?? "",
    first_name: formData.get("first_name") ?? "",
    last_name: formData.get("last_name") ?? "",
    shop_name: formData.get("shop_name") ?? "",
    password: typeof password === "string" ? password : undefined,
    plan: formData.get("plan") ?? "free",
  });
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return { fields: Object.fromEntries(SIGNUP_FIELDS.map((field) => [field, fields[field]?.[0]])) };
  }

  const jar = await cookies();
  const deviceId = deviceIdFor(jar, false);
  const result = await callApi<AuthResult>("auth/signup", {
    method: "POST",
    body: parsed.data,
    context: { ...(await requestContext()), deviceId },
  });
  if (!result.ok) {
    const { problem } = result;
    if (problem.code === "email_taken") return { fields: { email: messageFor("email_taken") } };
    if (problem.errors) {
      const fields: RegistrationState["fields"] = {};
      for (const field of SIGNUP_FIELDS) {
        const errors = problem.errors[field];
        if (errors?.length) fields[field] = errors.map((error) => (field === "password" ? (PASSWORD_RULES[error.code] ?? error.message) : error.message)).join(" ");
      }
      if (Object.keys(fields).length) return { fields };
    }
    return { error: { code: problem.code, message: messageFor(problem.code, problem.detail), retryAfter: problem.retry_after } };
  }
  // 202 : un lien est parti par e-mail, le compte n'existe pas encore.
  if (result.status !== 201) return { done: true };

  rememberDevice(jar, deviceId, false);
  setSessionCookies(jar, result.data, false);
  redirect(result.data.shops[0] ? `/app/${result.data.shops[0].slug}` : "/app");
}

const CompletionSchema = z.object({
  token: z.string().min(1).max(2000),
  password: z.string().min(10, PASSWORD_RULES.password_too_short).max(128, PASSWORD_RULES.password_too_long),
});

export async function completeSignup(_previous: RegistrationState, formData: FormData): Promise<RegistrationState> {
  const parsed = CompletionSchema.safeParse({
    token: formData.get("token") ?? "",
    password: formData.get("password") ?? "",
  });
  if (!parsed.success) {
    const fields = z.flattenError(parsed.error).fieldErrors;
    return {
      fields: { password: fields.password?.[0] },
      error: fields.token ? { code: "token_invalid_or_expired", message: messageFor("token_invalid_or_expired") } : undefined,
    };
  }

  const jar = await cookies();
  const deviceId = deviceIdFor(jar, false);
  const result = await callApi<AuthResult>("auth/signup/complete", {
    method: "POST",
    body: parsed.data,
    context: { ...(await requestContext()), deviceId },
  });
  if (!result.ok) {
    const passwordErrors = result.problem.errors?.password;
    if (passwordErrors?.length) {
      return { fields: { password: passwordErrors.map((error) => PASSWORD_RULES[error.code] ?? error.message).join(" ") } };
    }
    return {
      error: { code: result.problem.code, message: messageFor(result.problem.code, result.problem.detail), retryAfter: result.problem.retry_after },
    };
  }

  rememberDevice(jar, deviceId, false);
  setSessionCookies(jar, result.data, false);
  redirect(result.data.shops[0] ? `/app/${result.data.shops[0].slug}` : "/app");
}

export async function unlockAccount(_previous: RegistrationState, formData: FormData): Promise<RegistrationState> {
  const token = z.string().min(1).max(2000).safeParse(formData.get("token") ?? "");
  if (!token.success) {
    return { error: { code: "token_invalid_or_expired", message: messageFor("token_invalid_or_expired") } };
  }
  const result = await callApi("auth/unlock", {
    method: "POST",
    body: { token: token.data },
    context: await requestContext(),
  });
  if (!result.ok) {
    return { error: { code: result.problem.code, message: messageFor(result.problem.code, result.problem.detail), retryAfter: result.problem.retry_after } };
  }
  redirect("/connexion?raison=compte_deverrouille");
}
