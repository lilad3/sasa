import "server-only";

import { connection } from "next/server";

import { callApi } from "./api";
import { requestContext } from "./session";

/**
 * Le mode d'inscription choisi côté Django (SIGNUP_EMAIL_VERIFICATION) : avec lien de confirmation
 * par e-mail, ou en une étape avec le mot de passe. Django reste le seul à décider.
 * S'il ne répond pas, on affiche le formulaire en une étape : l'envoi dira que le serveur est injoignable.
 */
export async function getSignupEmailVerification() {
  await connection();
  const result = await callApi<{ email_verification: boolean }>("auth/signup", { context: await requestContext() });
  return result.ok ? result.data.email_verification : false;
}
