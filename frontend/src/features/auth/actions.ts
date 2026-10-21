"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { type FormError, messageFor } from "@/lib/messages";
import { callApi } from "@/lib/server/api";
import {
  clearSessionCookies,
  COOKIE,
  deviceIdFor,
  readMfaCookie,
  rememberDevice,
  setMfaCookie,
  setSessionCookies,
} from "@/lib/server/cookies";
import { requestContext, safeNext } from "@/lib/server/session";
import type { AuthResult, MfaChallenge, Problem, ShopMembership } from "@/lib/types";

export type AuthFormState = {
  error?: FormError;
  fields?: Partial<Record<"email" | "password" | "code", string>>;
  email?: string;
};

function describe(problem: Problem): FormError {
  return {
    code: problem.code,
    message: messageFor(problem.code, problem.detail),
    retryAfter: problem.retry_after,
    attemptsRemaining: problem.attempts_remaining,
    requestId: problem.status >= 500 ? problem.request_id : undefined,
  };
}

function landingFor(shops: ShopMembership[]) {
  const first = shops[0];
  if (!first) return "/app";
  // Le vendeur n'a pas accès au chiffre d'affaires : il arrive directement sur les commandes.
  return first.permissions.includes("dashboard.view") ? `/app/${first.slug}` : `/app/${first.slug}/commandes`;
}

const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, "Indiquez votre adresse e-mail.").max(254).email("Cette adresse e-mail n'est pas valide."),
  password: z.string().min(1, "Indiquez votre mot de passe.").max(128, "Ce mot de passe est trop long."),
  shared: z.boolean(),
});

export async function login(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = LoginSchema.safeParse({
    email: formData.get("email") ?? "",
    password: formData.get("password") ?? "",
    shared: formData.get("shared") === "on",
  });
  const typedEmail = String(formData.get("email") ?? "");
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return { email: typedEmail, fields: { email: flat.email?.[0], password: flat.password?.[0] } };
  }

  const { email, password, shared } = parsed.data;
  const jar = await cookies();
  const context = await requestContext();
  // L'appareil est connu de Django dès la connexion, pour détecter un nouvel appareil.
  const deviceId = deviceIdFor(jar, shared);

  const result = await callApi<AuthResult | MfaChallenge>("auth/login", {
    method: "POST",
    body: { email, password, shared_device: shared },
    context: { ...context, deviceId },
  });

  if (!result.ok) {
    // En mode appareil partagé, on ne garde pas l'e-mail dans le formulaire.
    return { email: shared ? "" : typedEmail, error: describe(result.problem) };
  }

  rememberDevice(jar, deviceId, shared);
  const next = safeNext(formData.get("suite"));

  if (result.data.status === "mfa_required") {
    setMfaCookie(jar, result.data.mfa_token, shared, result.data.expires_in);
    redirect(next ? `/connexion/code?suite=${encodeURIComponent(next)}` : "/connexion/code");
  }

  setSessionCookies(jar, result.data, shared);
  // Compte créé par un patron : il choisit d'abord son propre mot de passe.
  if (result.data.user.must_change_password) redirect("/premiere-connexion");
  redirect(next ?? landingFor(result.data.shops));
}

const CodeSchema = z
  .string()
  .transform((value) => value.replace(/\s+/g, "").toLowerCase())
  .refine((value) => /^\d{6}$/.test(value) || /^[a-z0-9]{4}-?[a-z0-9]{4}$/.test(value), {
    message: "Saisissez les 6 chiffres de votre application, ou un code de secours (xxxx-xxxx).",
  });

export async function verifyMfa(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const jar = await cookies();
  const pending = readMfaCookie(jar);
  if (!pending) redirect("/connexion?raison=code_expire");

  const parsed = CodeSchema.safeParse(formData.get("code") ?? "");
  if (!parsed.success) return { fields: { code: parsed.error.issues[0]?.message } };

  const result = await callApi<AuthResult>("auth/login/2fa", {
    method: "POST",
    body: { mfa_token: pending.token, code: parsed.data },
    context: await requestContext(),
  });

  if (!result.ok) {
    const { code } = result.problem;
    if (code === "mfa_token_expired") {
      jar.delete(COOKIE.mfa);
      redirect("/connexion?raison=code_expire");
    }
    if (code === "account_locked") jar.delete(COOKIE.mfa);
    if (code === "validation_error" && result.problem.errors?.code) {
      return { fields: { code: messageFor("mfa_invalid_code") } };
    }
    return { error: describe(result.problem) };
  }

  jar.delete(COOKIE.mfa);
  setSessionCookies(jar, result.data, pending.shared);
  redirect(safeNext(formData.get("suite")) ?? landingFor(result.data.shops));
}

export async function cancelMfa() {
  (await cookies()).delete(COOKIE.mfa);
  redirect("/connexion");
}

export async function logout() {
  const jar = await cookies();
  const access = jar.get(COOKIE.access)?.value;
  const refresh = jar.get(COOKIE.refresh)?.value;
  if (access || refresh) {
    // Révoque la session côté serveur, même si l'access token a expiré (le refresh suffit).
    await callApi("auth/logout", {
      method: "POST",
      body: refresh ? { refresh } : {},
      access,
      context: await requestContext(),
    });
  }
  clearSessionCookies(jar);
  redirect("/connexion?raison=deconnexion");
}
