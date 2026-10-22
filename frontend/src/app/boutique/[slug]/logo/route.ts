import { headers } from "next/headers";

import { clientIpFrom, fetchPublicImage } from "@/lib/server/api";

/**
 * Le logo d'une boutique, relayé depuis Django (le navigateur ne parle jamais à Django).
 * Django l'a déjà vérifié et réencodé en PNG ; on ne relaie que le PNG, avec nosniff.
 * Avec ?v= (l'empreinte du logo), l'adresse change à chaque nouveau logo : le cache peut être immuable.
 */
export async function GET(request: Request, { params }: RouteContext<"/boutique/[slug]/logo">) {
  const { slug } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return new Response(null, { status: 404 });

  const response = await fetchPublicImage(`storefront/${slug}/logo`, { ip: clientIpFrom(await headers()), userAgent: "", deviceId: "" });
  if (!response) return new Response(null, { status: 503 });
  if (!response.ok || response.headers.get("content-type") !== "image/png") return new Response(null, { status: 404 });

  const versioned = new URL(request.url).searchParams.has("v");
  return new Response(response.body, {
    headers: {
      "Content-Type": "image/png",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
    },
  });
}
