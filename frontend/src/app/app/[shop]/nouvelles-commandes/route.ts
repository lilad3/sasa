// Compteur des commandes pour l'alerte en direct de l'espace marchand (features/live/live-orders.tsx).
// Interrogé toutes les 30 s par le navigateur : le proxy renouvelle l'accès au passage, comme pour les pages.
import { type NextRequest, NextResponse } from "next/server";

import { callApi, clientIpFrom } from "@/lib/server/api";
import { COOKIE } from "@/lib/server/cookies";
import { orderPlace } from "@/lib/format";
import type { Order, Paginated } from "@/lib/types";

const SLUG = /^[a-z0-9-]{1,60}$/;
const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest, { params }: RouteContext<"/app/[shop]/nouvelles-commandes">) {
  const { shop } = await params;
  if (!SLUG.test(shop)) return NextResponse.json({ code: "not_found" }, { status: 404, headers: NO_STORE });
  const access = request.cookies.get(COOKIE.access)?.value;
  if (!access) return NextResponse.json({ code: "not_authenticated" }, { status: 401, headers: NO_STORE });

  // La première page d'une commande suffit : le total ne fait que monter, la plus récente vient en tête.
  const result = await callApi<Paginated<Order>>(`shops/${shop}/orders?page=1&page_size=1`, {
    access,
    context: {
      ip: clientIpFrom(request.headers),
      userAgent: request.headers.get("user-agent") ?? "",
      deviceId: request.cookies.get(COOKIE.device)?.value ?? "",
    },
  });
  if (!result.ok) return NextResponse.json({ code: result.problem.code }, { status: result.problem.status, headers: NO_STORE });

  const latest = result.data.results[0];
  return NextResponse.json(
    {
      count: result.data.count,
      // Ni nom ni téléphone : la référence, le montant et la commune suffisent pour l'alerte.
      latest: latest
        ? { reference: latest.reference, total: latest.total, place: orderPlace(latest), created_at: latest.created_at }
        : null,
    },
    { headers: NO_STORE },
  );
}
