import { cookies } from "next/headers";

import { fetchMemberImage } from "@/lib/server/api";
import { COOKIE } from "@/lib/server/cookies";
import { requestContext } from "@/lib/server/session";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * La photo d'un produit pour l'équipe de la boutique, quel que soit le statut du produit (docs/chantier-a2-produits.md §A2.1).
 * Django vérifie l'appartenance et le droit ; jamais de cache partagé : une photo de brouillon n'est pas publique.
 */
export async function GET(request: Request, { params }: RouteContext<"/app/[shop]/photo/[id]">) {
  const { shop, id } = await params;
  const product = new URL(request.url).searchParams.get("p") ?? "";
  if (!/^[a-z0-9-]{1,60}$/.test(shop) || !UUID.test(id) || !UUID.test(product)) return new Response(null, { status: 404 });

  const access = (await cookies()).get(COOKIE.access)?.value;
  if (!access) return new Response(null, { status: 401 });

  const response = await fetchMemberImage(`shops/${shop}/products/${product}/photos/${id}/image`, access, await requestContext());
  if (!response) return new Response(null, { status: 503 });
  if (!response.ok || response.headers.get("content-type") !== "image/webp") return new Response(null, { status: 404 });

  return new Response(response.body, {
    headers: {
      "Content-Type": "image/webp",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
