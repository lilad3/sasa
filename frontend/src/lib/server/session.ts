import "server-only";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import type {
  CustomerDetail,
  CustomerRow,
  CustomerSegment,
  CustomerSummary,
  DashboardSummary,
  Goal,
  Me,
  Member,
  Order,
  OrderCounts,
  OrderDetail,
  OrderStatus,
  Paginated,
  Period,
  PresenceEntry,
  Problem,
  SecurityEvent,
  Session,
  ShopMembership,
  TeamNote,
} from "@/lib/types";
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
  // Compte créé par un patron, encore sur son mot de passe provisoire : rien d'autre avant de l'avoir remplacé.
  if (problem.code === "password_change_required") redirect("/premiere-connexion");
  const reason = SESSION_GONE[problem.code];
  if (reason) redirect(`/session/fin?raison=${reason}`);
}

/**
 * Appel authentifié depuis un Server Component.
 * Les erreurs de session redirigent ; les autres (403, 404…) reviennent à l'appelant pour qu'il affiche le bon état.
 */
export async function authed<T>(path: string): Promise<ApiResult<T>> {
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

// cache() : la barre latérale (meilleures ventes) et la vue d'ensemble lisent le même résumé sur 30 jours.
export const getDashboard = cache(async (slug: string, period: Period) =>
  authed<DashboardSummary>(`shops/${encodeURIComponent(slug)}/dashboard?period=${period}`),
);

export const getGoal = cache(async (slug: string) => authed<Goal>(`shops/${encodeURIComponent(slug)}/goal`));

export async function getCustomers(
  slug: string,
  { page = 1, segment = "all", q, sort = "recent" }: { page?: number; segment?: CustomerSegment; q?: string; sort?: "recent" | "spent" } = {},
) {
  const query = new URLSearchParams({ page: String(page), page_size: "20", segment, sort });
  if (q) query.set("q", q);
  return authed<Paginated<CustomerRow>>(`shops/${encodeURIComponent(slug)}/customers?${query}`);
}

export async function getCustomerSummary(slug: string) {
  return authed<CustomerSummary>(`shops/${encodeURIComponent(slug)}/customers/summary`);
}

export async function getCustomer(slug: string, id: string) {
  return authed<CustomerDetail>(`shops/${encodeURIComponent(slug)}/customers/${encodeURIComponent(id)}`);
}

export async function getPresence(slug: string) {
  return authed<PresenceEntry[]>(`shops/${encodeURIComponent(slug)}/team/presence`);
}

export async function getOrders(slug: string, { page = 1, status, q }: { page?: number; status?: OrderStatus; q?: string } = {}) {
  const query = new URLSearchParams({ page: String(page), page_size: "20" });
  if (status) query.set("status", status);
  if (q) query.set("q", q);
  return authed<Paginated<Order>>(`shops/${encodeURIComponent(slug)}/orders?${query}`);
}

// La pastille « Commandes » de la barre latérale et la page des commandes lisent les mêmes compteurs.
export const getOrderCounts = cache(async (slug: string) => authed<OrderCounts>(`shops/${encodeURIComponent(slug)}/orders/counts`));

export async function getOrder(slug: string, id: string) {
  return authed<OrderDetail>(`shops/${encodeURIComponent(slug)}/orders/${encodeURIComponent(id)}`);
}

export async function getMembers(slug: string) {
  return authed<Member[]>(`shops/${encodeURIComponent(slug)}/members`);
}

export async function getTeamNotes(slug: string) {
  return authed<TeamNote[]>(`shops/${encodeURIComponent(slug)}/notes`);
}

// La barre latérale (pastille) et le bandeau du haut lisent les mêmes messages non lus : un seul appel.
export const getUnreadTeamNotes = cache(async (slug: string) => authed<TeamNote[]>(`shops/${encodeURIComponent(slug)}/notes?unread=1`));

export async function getSessions() {
  return authed<Session[]>("me/sessions");
}

export async function getSecurityEvents(page = 1) {
  return authed<Paginated<SecurityEvent>>(`me/security-events?page=${page}&page_size=8`);
}

/**
 * Appel authentifié depuis une Server Action (POST, PATCH, DELETE).
 * Le proxy a déjà renouvelé l'accès : il passe aussi sur les envois de formulaire de /app.
 * Une session morte renvoie au login, comme pour les pages ; les autres erreurs reviennent au formulaire.
 */
/** Téléchargement depuis une Server Action (export CSV) : le contenu brut, ou l'erreur de l'API. */
export async function authedText(path: string): Promise<ApiResult<string>> {
  const access = (await cookies()).get(COOKIE.access)?.value;
  if (!access) redirect("/connexion");
  const result = await callApi<string>(path, { access, context: await requestContext(), as: "text" });
  if (!result.ok) handleAuthProblem(result.problem);
  return result;
}

export async function authedMutation<T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown): Promise<ApiResult<T>> {
  const access = (await cookies()).get(COOKIE.access)?.value;
  if (!access) redirect("/connexion");
  const result = await callApi<T>(path, { method, body, access, context: await requestContext() });
  if (!result.ok) handleAuthProblem(result.problem);
  return result;
}
