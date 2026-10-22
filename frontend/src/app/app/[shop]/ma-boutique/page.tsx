import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { getDesign, getDesignVersions } from "@/features/design/data";
import { DesignEditor } from "@/features/design/editor";
import { getMyShops } from "@/lib/server/session";

export const metadata: Metadata = { title: "Ma boutique" };

export default function DesignPage({ params }: PageProps<"/app/[shop]/ma-boutique">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[620px] animate-pulse rounded-[26px]" />}>
      <DesignFromRoute params={params} />
    </Suspense>
  );
}

/** « Ma boutique » : le thème et la mise en page de la vitrine (docs/chantier-p5.md §3.5). */
async function DesignFromRoute({ params }: Pick<PageProps<"/app/[shop]/ma-boutique">, "params">) {
  const { shop } = await params;
  const shops = await getMyShops();
  if (!shops.ok) throw new Error("Impossible de charger votre compte.");
  const membership = shops.data.find((item) => item.slug === shop);
  if (!membership) notFound();
  // Le menu ne montre « Ma boutique » qu'avec le droit ; une adresse tapée à la main revient aux commandes.
  if (!membership.permissions.includes("storefront.edit")) redirect(`/app/${shop}/commandes`);

  const [overview, versions] = await Promise.all([getDesign(shop), getDesignVersions(shop)]);
  if (!overview.ok || !versions.ok) throw new Error("Impossible de charger la vitrine.");

  return (
    <>
      <header className="col-span-full px-1 pt-1.5">
        <p className="text-[12.5px] text-texte-2">{membership.name}</p>
        <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Ma boutique</h1>
        <p className="mt-1 max-w-[62ch] text-[14px] text-texte-2">Choisissez le thème qui va avec ce que vous vendez, essayez-le dans l’aperçu, puis publiez quand il vous plaît.</p>
      </header>
      <DesignEditor slug={shop} overview={overview.data} versions={versions.data} canManageShop={membership.permissions.includes("shop.manage")} />
    </>
  );
}
