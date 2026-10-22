import { headers } from "next/headers";

import { clientIpFrom, fetchPublicImage } from "@/lib/server/api";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Une photo de produit, relayée depuis Django (le navigateur ne parle jamais à Django).
 * Django l'a déjà vérifiée et réencodée en WebP ; on ne relaie que du WebP, avec nosniff.
 * Avec ?v= (l'empreinte de la photo), l'adresse change à chaque nouvelle image : le cache peut être immuable.
 */
export async function GET(request: Request, { params }: RouteContext<"/boutique/[slug]/photo/[id]">) {
  const { slug, id } = await params;
  if (!/^[a-z0-9-]{1,60}$/.test(slug) || !UUID.test(id)) return new Response(null, { status: 404 });

  const response = await fetchPublicImage(`storefront/${slug}/photos/${id}`, { ip: clientIpFrom(await headers()), userAgent: "", deviceId: "" }, "image/webp");
  if (!response) return new Response(null, { status: 503 });
  if (!response.ok || response.headers.get("content-type") !== "image/webp") return new Response(null, { status: 404 });

  const versioned = new URL(request.url).searchParams.has("v");
  return new Response(response.body, {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": versioned ? "public, max-age=31536000, immutable" : "public, max-age=300",
    },
  });
}
