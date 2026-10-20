// Django a répondu que la session n'existe plus (révoquée, expirée, token illisible) :
// on efface les cookies de ce navigateur et on renvoie au login avec la raison.
import { type NextRequest, NextResponse } from "next/server";

import { clearSessionCookies } from "@/lib/server/cookies";

const REASONS = new Set(["session_expiree", "session_fermee"]);

export async function GET(request: NextRequest) {
  const reason = request.nextUrl.searchParams.get("raison");
  const login = new URL("/connexion", request.url);
  if (reason && REASONS.has(reason)) login.searchParams.set("raison", reason);
  const response = NextResponse.redirect(login);
  clearSessionCookies(response.cookies);
  return response;
}
