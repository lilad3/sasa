import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { getMyShops } from "@/lib/server/session";

/** Les pages Paiements et Livraison sont au propriétaire : un autre rôle lit « Réservé au propriétaire », jamais un 403 brut. */
export async function OwnerOnly({ slug, what, children }: { slug: string; what: string; children: (name: string) => ReactNode }) {
  const shops = await getMyShops();
  if (!shops.ok) throw new Error("Impossible de charger la boutique.");
  const membership = shops.data.find((item) => item.slug === slug);
  if (!membership) notFound();
  if (!membership.permissions.includes("shop.manage")) {
    return (
      <section className="vitre col-span-full flex flex-col items-start gap-3 rounded-[24px] p-6">
        <h1 className="text-[clamp(22px,2.4vw,28px)] font-medium tracking-tight">Réservé au propriétaire</h1>
        <p className="max-w-[60ch] text-texte-2">
          {what} de {membership.name} ne se gèrent que par son propriétaire. Demandez-lui le changement dont vous avez besoin.
        </p>
        <Link href={`/app/${slug}/commandes`} className="bouton-nuit rounded-full px-5 py-2.5 text-sm font-bold">
          Revenir aux commandes
        </Link>
      </section>
    );
  }
  return <>{children(membership.name)}</>;
}
