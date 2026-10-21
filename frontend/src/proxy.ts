// Proxy (ex-middleware) : s'exécute avant le rendu.
// 1. Sans session, l'espace marchand renvoie au login.
// 2. L'access token ne vit que 5 min : le proxy le renouvelle juste avant qu'il expire, pose les nouveaux cookies
//    et les transmet au rendu de la page. Les Server Components ne peuvent pas écrire de cookies, d'où ce passage ici.
// Ce n'est qu'un premier filtre : chaque appel à Django est revérifié par Django (session serveur, rôles).

import { type NextRequest, NextResponse } from "next/server";

import { accessExpiresAt, callApi, clientIpFrom } from "@/lib/server/api";
import { clearSessionCookies, COOKIE, setSessionCookies } from "@/lib/server/cookies";
import type { TokenPair } from "@/lib/types";

const RENEW_BEFORE_MS = 30_000;

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const access = request.cookies.get(COOKIE.access)?.value;
  const refresh = request.cookies.get(COOKIE.refresh)?.value;

  if (pathname === "/connexion") {
    // Déjà connecté : inutile de revoir le formulaire (seulement à l'affichage, pas pendant l'envoi du formulaire).
    if (request.method === "GET" && refresh) return NextResponse.redirect(new URL("/app", request.url));
    return NextResponse.next();
  }

  // Espace marchand (/app…)
  if (!access && !refresh) {
    const login = new URL("/connexion", request.url);
    login.searchParams.set("suite", pathname + search);
    return NextResponse.redirect(login);
  }

  const expiresSoon = !access || accessExpiresAt(access) - Date.now() < RENEW_BEFORE_MS;
  if (!expiresSoon || !refresh) return NextResponse.next();

  const result = await callApi<TokenPair>("auth/token/refresh", {
    method: "POST",
    body: { refresh },
    context: {
      ip: clientIpFrom(request.headers),
      userAgent: request.headers.get("user-agent") ?? "",
      deviceId: request.cookies.get(COOKIE.device)?.value ?? "",
    },
  });

  if (!result.ok) {
    if (result.problem.code === "network_error") return NextResponse.next();
    const login = new URL("/connexion", request.url);
    login.searchParams.set("raison", result.problem.code === "session_revoked" ? "session_fermee" : "session_expiree");
    const response = NextResponse.redirect(login);
    clearSessionCookies(response.cookies);
    return response;
  }

  // Le rendu de cette requête doit déjà voir les nouveaux tokens : on réécrit l'en-tête Cookie transmis à Next.
  const shared = request.cookies.has(COOKIE.shared);
  request.cookies.set(COOKIE.access, result.data.access);
  if (result.data.refresh) request.cookies.set(COOKIE.refresh, result.data.refresh);
  const forwarded = new Headers(request.headers);
  forwarded.set("cookie", request.cookies.toString());

  const response = NextResponse.next({ request: { headers: forwarded } });
  setSessionCookies(response.cookies, result.data, shared);
  return response;
}

export const config = {
  matcher: ["/app", "/app/:path*", "/connexion", "/premiere-connexion"],
};
