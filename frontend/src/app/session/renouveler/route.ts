// Renouvelle l'accès quand une page a trouvé un access token expiré (le proxy n'a pas pu le faire avant).
import { type NextRequest, NextResponse } from "next/server";

import { callApi, clientIpFrom } from "@/lib/server/api";
import { clearSessionCookies, COOKIE, setSessionCookies } from "@/lib/server/cookies";
import { sessionIsOver } from "@/lib/server/refresh";
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
    // Panne passagère : surtout pas de déconnexion, ni de redirection (la page renverrait ici, en boucle).
    if (!sessionIsOver(result.problem)) return unavailable(request, target, result.problem.retry_after);
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

/** Une page simple : la session est intacte, on réessaie quand on veut. */
function unavailable(request: NextRequest, target: string, retryAfter?: number) {
  const retry = new URL("/session/renouveler", request.url);
  retry.searchParams.set("suite", target);
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Un instant · Akwaba</title><style>
body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#0e0c0a;color:#f6f0e7;font:16px/1.5 system-ui,sans-serif;padding:16px}
main{max-width:420px}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#cfc4b4;margin:0 0 20px}
a{display:inline-block;margin-right:12px;padding:12px 20px;border-radius:999px;font-weight:700;text-decoration:none}
.go{background:#ff7a1f;color:#17110a}.alt{color:#f6f0e7;border:1px solid rgb(240 221 186/.35)}
a:focus-visible{outline:3px solid #a3abff;outline-offset:2px}</style></head>
<body><main><h1>Akwaba ne répond pas pour l’instant</h1>
<p>Votre session est intacte : rien n’a été perdu. Réessayez dans quelques secondes.</p>
<a class="go" href="${retry.pathname}${retry.search}">Réessayer</a><a class="alt" href="/connexion">Se reconnecter</a></main></body></html>`;
  return new NextResponse(html, {
    status: 503,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
  });
}
