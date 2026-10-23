// Client de l'API Django, appelé uniquement de serveur à serveur (Server Components, Server Actions, proxy).
// Le navigateur ne parle jamais à Django : il ne voit ni le secret BFF ni les tokens.
// Ce module n'importe pas « server-only » parce que proxy.ts l'utilise aussi ; il refuse tout de même de tourner dans un navigateur.

import type { Problem } from "@/lib/types";

if (typeof window !== "undefined") {
  throw new Error("lib/server/api ne doit jamais être chargé dans le navigateur.");
}

export type RequestContext = {
  ip: string;
  userAgent: string;
  deviceId: string;
};

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; problem: Problem };

type CallOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  access?: string;
  context: RequestContext;
  idempotencyKey?: string;
  /** "text" : la réponse réussie est rendue telle quelle (export CSV). Les erreurs restent du JSON. */
  as?: "json" | "text";
};

const SAFE_ID = /^[A-Za-z0-9_-]{8,64}$/;

// Lenteurs de Django (docs/chantier-a2-fondations.md §3) : 20 s par tentative. Une seule relance, après 1 s,
// pour une lecture ou le renouvellement de session, et seulement si le premier échec a été rapide : passé 5 s,
// Django a peut-être déjà fait tourner le refresh, et une relance tomberait après sa fenêtre de grâce de 10 s
// (il y verrait un vol). Une écriture n'est jamais relancée : elle a peut-être déjà eu lieu.
const TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 1_000;
const FAST_FAILURE_MS = 5_000;
const RETRYABLE_STATUS = new Set([502, 503, 504]);
const REFRESH_PATH = "auth/token/refresh";

/** La réponse de Django, ou null s'il n'a pas répondu à temps (réseau coupé, délai dépassé). */
async function attempt(url: string, init: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    return null;
  }
}

async function send(url: string, init: RequestInit, retryable: boolean): Promise<Response | null> {
  const started = Date.now();
  const first = await attempt(url, init);
  const failed = first === null || RETRYABLE_STATUS.has(first.status);
  if (!retryable || !failed || Date.now() - started >= FAST_FAILURE_MS) return first;
  await first?.body?.cancel();
  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  return attempt(url, init);
}

function settings() {
  const apiUrl = process.env.API_URL?.replace(/\/+$/, "");
  const secret = process.env.BFF_SHARED_SECRET;
  if (!apiUrl || !secret) {
    throw new Error("API_URL et BFF_SHARED_SECRET doivent être définis (voir frontend/.env.example).");
  }
  return { apiUrl, secret };
}

/** Identifiant de requête, accepté par Django (même alphabet, 8 à 64 caractères). */
export function newRequestId() {
  return "web_" + crypto.randomUUID().replaceAll("-", "");
}

/** IP réelle du visiteur : première adresse de X-Forwarded-For, posé par le serveur Next ou le proxy de production. */
export function clientIpFrom(headers: Headers) {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return headers.get("x-real-ip")?.trim() ?? "";
}

export async function callApi<T>(path: string, options: CallOptions): Promise<ApiResult<T>> {
  const { apiUrl, secret } = settings();
  const headers = new Headers({
    Accept: "application/json",
    "X-Akwaba-Bff": secret,
    "X-Request-ID": newRequestId(),
  });
  // Un FormData part en multipart (import CSV) : fetch pose lui-même le Content-Type et sa frontière.
  const multipart = options.body instanceof FormData;
  if (options.body !== undefined && !multipart) headers.set("Content-Type", "application/json");
  if (options.access) headers.set("Authorization", `Bearer ${options.access}`);
  if (options.context.ip) headers.set("X-Client-IP", options.context.ip);
  if (options.context.userAgent) headers.set("X-Client-UA", options.context.userAgent.slice(0, 300));
  if (SAFE_ID.test(options.context.deviceId)) headers.set("X-Device-Id", options.context.deviceId);
  if (options.idempotencyKey) headers.set("Idempotency-Key", options.idempotencyKey);

  const method = options.method ?? "GET";
  const response = await send(
    `${apiUrl}/api/v1/${path}`,
    {
      method,
      headers,
      body: options.body === undefined ? undefined : multipart ? (options.body as FormData) : JSON.stringify(options.body),
      cache: "no-store",
      redirect: "manual",
    },
    method === "GET" || path === REFRESH_PATH,
  );
  if (!response) return { ok: false, problem: { status: 503, code: "network_error", detail: "Le serveur ne répond pas." } };

  if (response.status === 204) return { ok: true, status: 204, data: undefined as T };

  const text = await response.text();
  if (response.ok && options.as === "text") return { ok: true, status: response.status, data: text as T };
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (response.ok) return { ok: true, status: response.status, data: json as T };
  return { ok: false, problem: toProblem(response.status, json) };
}

/**
 * Image publique servie par Django (le logo d'une boutique) : la réponse brute, pour la relayer telle quelle.
 * null si le serveur ne répond pas.
 */
export async function fetchPublicImage(path: string, context: RequestContext, accept = "image/png"): Promise<Response | null> {
  const { apiUrl, secret } = settings();
  const headers = new Headers({ Accept: accept, "X-Akwaba-Bff": secret, "X-Request-ID": newRequestId() });
  if (context.ip) headers.set("X-Client-IP", context.ip);
  return send(`${apiUrl}/api/v1/${path}`, { headers, cache: "no-store", redirect: "manual" }, true);
}

function toProblem(status: number, json: unknown): Problem {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  return {
    status,
    code: typeof body.code === "string" ? body.code : "server_error",
    detail: typeof body.detail === "string" ? body.detail : "Une erreur est survenue.",
    errors: typeof body.errors === "object" && body.errors !== null ? (body.errors as Problem["errors"]) : undefined,
    retry_after: typeof body.retry_after === "number" ? body.retry_after : undefined,
    attempts_remaining: typeof body.attempts_remaining === "number" ? body.attempts_remaining : undefined,
    request_id: typeof body.request_id === "string" ? body.request_id : undefined,
    total: typeof body.total === "number" ? body.total : undefined,
    discount_amount: typeof body.discount_amount === "number" ? body.discount_amount : undefined,
    limit: typeof body.limit === "number" ? body.limit : undefined,
  };
}

/** Date d'expiration d'un access token, lue sans le vérifier : seul Django vérifie la signature. */
export function accessExpiresAt(token: string): number {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}
