import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import type { DashboardSummary, Me, Paginated, Order, Period, Problem, ShopMembership } from "@/lib/types";
import { type ApiResult, callApi, clientIpFrom, type RequestContext } from "./api";
import { COOKIE } from "./cookies";

/** Contexte du visiteur transmis à Django : IP réelle, navigateur, appareil. */
export async function requestContext(): Promise<RequestContext> {
  const [h, jar] = await Promise.all([headers(), cookies()]);
  return { ip: clientIpFrom(h), userAgent: h.get("user-agent") ?? "", deviceId: jar.get(COOKIE.device)?.value ?? "" };
}

/** Redirection après connexion : uniquement vers une page interne de l'espace marchand (pas de redirection ouverte). */
export function safeNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/app") || value.startsWith("//") || value.includes("\\") || value.includes("://")) return null;
  return value;
}

// Codes qui signifient « la session n'existe plus » : on efface les cookies et on renvoie au login.
const SESSION_GONE: Record<string, string> = {
  not_authenticated: "session_expiree",
  token_invalid: "session_expiree",
  session_expired: "session_expiree",
  session_revoked: "session_fermee",
};

function handleAuthProblem(problem: Problem): never | void {
  if (problem.code === "token_expired") redirect("/session/renouveler");
  const reason = SESSION_GONE[problem.code];
  if (reason) redirect(`/session/fin?raison=${reason}`);
}

/**
 * Appel authentifié depuis un Server Component.
 * Les erreurs de session redirigent ; les autres (403, 404…) reviennent à l'appelant pour qu'il affiche le bon état.
 */
async function authed<T>(path: string): Promise<ApiResult<T>> {
  // Ces données n'existent qu'au moment de la requête : sans cette ligne, Next tenterait de
  // pré-rendre l'appel et refuserait l'identifiant aléatoire de requête (crypto.randomUUID).
  await connection();
  const jar = await cookies();
  const access = jar.get(COOKIE.access)?.value;
  if (!access) {
    // Normalement, proxy.ts a déjà renouvelé l'accès. Sinon, on passe par la route de renouvellement.
    redirect(jar.get(COOKIE.refresh) ? "/session/renouveler" : "/connexion");
  }
  const result = await callApi<T>(path, { access, context: await requestContext() });
  if (!result.ok) handleAuthProblem(result.problem);
  return result;
}

// cache() : la barre latérale et la page appellent ces fonctions dans le même rendu, un seul appel part vers Django.
export const getMe = cache(async () => authed<Me>("me"));

export const getMyShops = cache(async () => authed<ShopMembership[]>("me/shops"));

export async function getDashboard(slug: string, period: Period) {
  return authed<DashboardSummary>(`shops/${encodeURIComponent(slug)}/dashboard?period=${period}`);
}

export async function getOrders(slug: string, page = 1) {
  return authed<Paginated<Order>>(`shops/${encodeURIComponent(slug)}/orders?page=${page}&page_size=20`);
}
