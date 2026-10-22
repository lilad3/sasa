import "server-only";

import { headers } from "next/headers";

/** Le lien public de la vitrine, tel que le visiteur l'a sous les yeux (même hôte que l'espace marchand). */
export async function storefrontLink(slug: string) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "akwaba.ci";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return { url: `${proto}://${host}/boutique/${slug}`, display: `${host.replace(/^www\./, "")}/boutique/${slug}` };
}
