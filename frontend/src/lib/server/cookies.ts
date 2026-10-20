// Cookies de session, posés par Next et jamais par Django (contrat §1.2).
// HttpOnly : le JavaScript du navigateur ne peut pas les lire, donc un XSS ne peut pas voler les tokens.

import type { TokenPair } from "@/lib/types";

const production = process.env.NODE_ENV === "production";
// Le préfixe __Host- interdit l'attribut Domain et impose Secure + Path=/ : un sous-domaine ne peut pas écraser ces cookies.
// En développement (http://localhost), Secure est impossible, donc le préfixe aussi.
const prefix = production ? "__Host-" : "";

export const COOKIE = {
  access: `${prefix}akw_at`,
  refresh: `${prefix}akw_rt`,
  device: `${prefix}akw_dev`,
  shared: `${prefix}akw_shared`,
  mfa: `${prefix}akw_mfa`,
} as const;

const base = { httpOnly: true, secure: production, sameSite: "lax" as const, path: "/" };

const ONE_YEAR = 60 * 60 * 24 * 365;

/** Ce dont on a besoin d'un magasin de cookies : celui de next/headers comme celui de NextResponse. */
export type CookieJar = {
  get(name: string): { value: string } | undefined;
  set(name: string, value: string, options?: Record<string, unknown>): unknown;
  delete(name: string): unknown;
};

export function setSessionCookies(jar: CookieJar, tokens: TokenPair, shared: boolean) {
  jar.set(COOKIE.access, tokens.access, { ...base, maxAge: tokens.access_expires_in });
  if (tokens.refresh) {
    // Appareil partagé : cookie de session, qui disparaît à la fermeture du navigateur.
    jar.set(COOKIE.refresh, tokens.refresh, shared ? base : { ...base, maxAge: tokens.refresh_expires_in });
  }
  if (shared) jar.set(COOKIE.shared, "1", base);
  else jar.delete(COOKIE.shared);
}

export function clearSessionCookies(jar: CookieJar) {
  for (const name of [COOKIE.access, COOKIE.refresh, COOKIE.shared, COOKIE.mfa]) jar.delete(name);
}

/** Identifiant d'appareil (128 bits aléatoires). Jamais en mode appareil partagé : l'appareil n'est pas mémorisé. */
export function deviceIdFor(jar: CookieJar, shared: boolean): string {
  if (shared) return "";
  const existing = jar.get(COOKIE.device)?.value;
  if (existing && /^[A-Za-z0-9_-]{22}$/.test(existing)) return existing;
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("base64url");
}

export function rememberDevice(jar: CookieJar, deviceId: string, shared: boolean) {
  if (shared || !deviceId) {
    jar.delete(COOKIE.device);
    return;
  }
  jar.set(COOKIE.device, deviceId, { ...base, maxAge: ONE_YEAR });
}

export function setMfaCookie(jar: CookieJar, token: string, shared: boolean, expiresIn: number) {
  jar.set(COOKIE.mfa, JSON.stringify({ token, shared }), { ...base, maxAge: expiresIn });
}

export function readMfaCookie(jar: CookieJar): { token: string; shared: boolean } | null {
  const raw = jar.get(COOKIE.mfa)?.value;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed.token === "string" ? { token: parsed.token, shared: parsed.shared === true } : null;
  } catch {
    return null;
  }
}
