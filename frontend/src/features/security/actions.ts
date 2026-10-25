"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError, messageFor, PASSWORD_RULES } from "@/lib/messages";
import { confirmIdentity } from "@/lib/server/reauth";
import { authedMutation } from "@/lib/server/session";
import type { MfaSetup, Problem } from "@/lib/types";

/* ---------- Double authentification ---------- */

export type MfaState = {
  /** Étape affichée : scanner le QR code, ranger les codes de secours, ou confirmer son identité avant une action grave. */
  step?: "scan" | "codes" | "reauth";
  setup?: { qr: string; secret: string };
  codes?: string[];
  /** Code à 6 chiffres déjà saisi, gardé pendant qu'on redemande le mot de passe avant de confirmer l'activation. */
  code?: string;
  /** L'action grave qui attend la confirmation renforcée. */
  intent?: "regenerate" | "disable" | "setup" | "confirm";
  error?: FormError;
  codeError?: string;
  done?: string;
};

const Code = z
  .string()
  .transform((value) => value.replace(/\s+/g, ""))
  .pipe(z.string().regex(/^\d{6}$/, "Saisissez les 6 chiffres affichés par votre application."));

const WRONG_CODE = messageFor("mfa_invalid_code");

/** Django signale un code faux sous le champ `code` (erreur de validation), pas en erreur globale. */
function isWrongCode(problem: Problem) {
  return Boolean(problem.errors?.code?.length);
}

export async function mfaAction(previous: MfaState, formData: FormData): Promise<MfaState> {
  const intent = formData.get("intent");
  if (intent === "setup") return startSetup(formData);
  if (intent === "confirm") return confirmSetup(previous, formData);
  if (intent === "regenerate" || intent === "disable") return sensitiveAction(intent, formData);
  // « Annuler » ou « J'ai rangé mes codes » : retour à l'état de départ, sans appel à l'API.
  return {};
}

/**
 * Activer la 2FA exige la confirmation renforcée. Le compte n'a pas encore de 2FA : elle se fait au mot de passe.
 * Premier envoi sans preuve ; si Django répond reauth_required, on demande le mot de passe puis on rejoue.
 */
async function startSetup(formData: FormData): Promise<MfaState> {
  const proof = await confirmIdentity(formData);
  if (!proof.ok) return { step: "reauth", intent: "setup", codeError: proof.fieldError, error: proof.error };

  const result = await authedMutation<MfaSetup>("me/2fa/setup", "POST");
  if (!result.ok) {
    if (result.problem.code === "reauth_required") return { step: "reauth", intent: "setup" };
    if (result.problem.code === "mfa_already_enabled") refresh();
    return { error: describeProblem(result.problem) };
  }
  return { step: "scan", setup: { qr: result.data.qr_svg, secret: result.data.secret } };
}

async function confirmSetup(previous: MfaState, formData: FormData): Promise<MfaState> {
  const scan = { step: "scan" as const, setup: previous.setup };
  const parsed = Code.safeParse(formData.get("code") ?? "");
  if (!parsed.success) return { ...scan, codeError: parsed.error.issues[0]?.message };

  const proof = await confirmIdentity(formData);
  if (!proof.ok) return { step: "reauth", intent: "confirm", setup: previous.setup, code: parsed.data, codeError: proof.fieldError, error: proof.error };

  const result = await authedMutation<{ recovery_codes: string[] }>("me/2fa/confirm", "POST", { code: parsed.data });
  if (!result.ok) {
    if (result.problem.code === "reauth_required") return { step: "reauth", intent: "confirm", setup: previous.setup, code: parsed.data };
    if (isWrongCode(result.problem)) return { ...scan, codeError: WRONG_CODE };
    if (result.problem.code === "mfa_setup_required") return { error: describeProblem(result.problem) };
    return { ...scan, error: describeProblem(result.problem) };
  }
  refresh();
  return { step: "codes", codes: result.data.recovery_codes, done: "La double authentification est active." };
}

/**
 * Désactiver la 2FA ou refaire les codes de secours : Django exige une confirmation renforcée de moins de 10 min.
 * Sans elle, il répond reauth_required ; on demande alors un code, on confirme, puis on rejoue l'action.
 */
async function sensitiveAction(intent: "regenerate" | "disable", formData: FormData): Promise<MfaState> {
  const proof = formData.get("proof");
  if (typeof proof === "string") {
    const parsed = Code.safeParse(proof);
    if (!parsed.success) return { step: "reauth", intent, codeError: parsed.error.issues[0]?.message };
    const reauth = await authedMutation("auth/reauth", "POST", { code: parsed.data });
    if (!reauth.ok) {
      if (isWrongCode(reauth.problem)) return { step: "reauth", intent, codeError: WRONG_CODE };
      return { step: "reauth", intent, error: describeProblem(reauth.problem) };
    }
  }

  if (intent === "disable") {
    const result = await authedMutation("me/2fa/disable", "POST");
    if (!result.ok) return afterRefusal(intent, result.problem);
    refresh();
    return { done: "Double authentification désactivée. Un e-mail d’alerte vient de partir vers votre adresse." };
  }

  const result = await authedMutation<{ recovery_codes: string[] }>("me/2fa/recovery-codes", "POST");
  if (!result.ok) return afterRefusal(intent, result.problem);
  refresh();
  return { step: "codes", codes: result.data.recovery_codes, done: "Nouveaux codes créés : les anciens ne fonctionnent plus." };
}

function afterRefusal(intent: "regenerate" | "disable", problem: Problem): MfaState {
  if (problem.code === "reauth_required") return { step: "reauth", intent };
  if (problem.code === "mfa_not_enabled") refresh();
  return { error: describeProblem(problem) };
}

/* ---------- Mot de passe ---------- */

export type PasswordChangeState = {
  done?: boolean;
  error?: FormError;
  fields?: Partial<Record<"current_password" | "password" | "confirmation", string>>;
};

const PasswordChange = z
  .object({
    current_password: z.string().min(1, "Indiquez votre mot de passe actuel.").max(128),
    password: z.string().min(10, PASSWORD_RULES.password_too_short).max(128, PASSWORD_RULES.password_too_long),
    confirmation: z.string(),
  })
  .refine((data) => data.password === data.confirmation, {
    path: ["confirmation"],
    message: "Les deux mots de passe ne sont pas identiques.",
  })
  .refine((data) => data.password !== data.current_password, {
    path: ["password"],
    message: "Choisissez un mot de passe différent de l’actuel.",
  });

/** Le mot de passe actuel sert de confirmation. Django ferme alors toutes les autres sessions. */
export async function changePassword(_previous: PasswordChangeState, formData: FormData): Promise<PasswordChangeState> {
  const parsed = PasswordChange.safeParse({
    current_password: formData.get("current_password") ?? "",
    password: formData.get("password") ?? "",
    confirmation: formData.get("confirmation") ?? "",
  });
  if (!parsed.success) {
    const flat = z.flattenError(parsed.error).fieldErrors;
    return { fields: { current_password: flat.current_password?.[0], password: flat.password?.[0], confirmation: flat.confirmation?.[0] } };
  }

  const { current_password, password } = parsed.data;
  const result = await authedMutation("me/password", "POST", { current_password, password });
  if (!result.ok) {
    const errors = result.problem.errors;
    if (errors?.current_password?.length) return { fields: { current_password: "Mot de passe actuel incorrect." } };
    if (errors?.password?.length) {
      return { fields: { password: errors.password.map((error) => PASSWORD_RULES[error.code] ?? error.message).join(" ") } };
    }
    return { error: describeProblem(result.problem) };
  }
  refresh();
  return { done: true };
}

/* ---------- Sessions ---------- */

/** Ferme une session. Si elle l'était déjà, la page rechargée montre simplement la liste à jour. */
export async function revokeSession(formData: FormData) {
  const parsed = z.uuid().safeParse(formData.get("session"));
  if (!parsed.success) return;
  await authedMutation(`me/sessions/${parsed.data}`, "DELETE");
  refresh();
}

export async function revokeOtherSessions() {
  await authedMutation("me/sessions/revoke-others", "POST");
  refresh();
}
