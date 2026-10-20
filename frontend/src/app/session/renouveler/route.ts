// Renouvelle l'accès quand une page a trouvé un access token expiré (le proxy n'a pas pu le faire avant).
import { type NextRequest, NextResponse } from "next/server";

import { callApi, clientIpFrom } from "@/lib/server/api";
import { clearSessionCookies, COOKIE, setSessionCookies } from "@/lib/server/cookies";
import { safeNext } from "@/lib/server/session";
import type { TokenPair } from "@/lib/types";

export async function GET(request: NextRequest) {
  const refresh = request.cookies.get(COOKIE.refresh)?.value;
  const target = safeNext(request.nextUrl.searchParams.get("suite")) ?? "/app";

  if (!refresh) return NextResponse.redirect(new URL("/connexion", request.url));

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
    const login = new URL("/connexion", request.url);
    login.searchParams.set("raison", result.problem.code === "session_revoked" ? "session_fermee" : "session_expiree");
    const response = NextResponse.redirect(login);
    clearSessionCookies(response.cookies);
    return response;
  }

  const response = NextResponse.redirect(new URL(target, request.url));
  setSessionCookies(response.cookies, result.data, request.cookies.has(COOKIE.shared));
  return response;
}
