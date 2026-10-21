import "server-only";

import { type FormError, describeProblem, messageFor } from "@/lib/messages";

import { authedMutation } from "./session";

/**
 * Confirmation renforcée (contrat §2.7) pour les Server Actions.
 *
 * Le formulaire envoie l'action une première fois sans preuve. Si Django répond `reauth_required`,
 * l'action renvoie `{ reauth: true }` et le formulaire affiche <ReauthFields /> : mot de passe, ou code
 * 2FA si le compte l'a activée. Au deuxième envoi, `confirmIdentity` ouvre la fenêtre de 10 min,
 * puis l'action rejoue l'appel.
 */
export type ReauthOutcome = { ok: true } | { ok: false; fieldError?: string; error?: FormError };

export async function confirmIdentity(formData: FormData): Promise<ReauthOutcome> {
  const password = formData.get("reauth_password");
  const code = formData.get("reauth_code");
  const body =
    typeof code === "string" && code
      ? { code: code.replace(/\s+/g, "") }
      : typeof password === "string" && password
        ? { password }
        : null;
  // Pas de preuve dans ce formulaire : l'action tente l'appel, la fenêtre est peut-être déjà ouverte.
  if (body === null) return { ok: true };

  const result = await authedMutation("auth/reauth", "POST", body);
  if (result.ok) return { ok: true };
  const errors = result.problem.errors;
  if (errors?.code?.length) return { ok: false, fieldError: messageFor("mfa_invalid_code") };
  if (errors?.password?.length) return { ok: false, fieldError: messageFor("invalid_password") };
  return { ok: false, error: describeProblem(result.problem) };
}
