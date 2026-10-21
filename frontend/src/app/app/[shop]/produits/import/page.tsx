import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { getProductOverview } from "@/features/products/data";
import { ImportPanel } from "@/features/products/import-panel";
import { getMyShops } from "@/lib/server/session";

export const metadata: Metadata = { title: "Importer des produits" };

export default function ImportPage({ params }: PageProps<"/app/[shop]/produits/import">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[480px] animate-pulse rounded-[24px]" />}>
      <ImportFromRoute params={params} />
    </Suspense>
  );
}

async function ImportFromRoute({ params }: Pick<PageProps<"/app/[shop]/produits/import">, "params">) {
  const { shop } = await params;
  const [overview, shops] = await Promise.all([getProductOverview(shop), getMyShops()]);
  if (!overview.ok) {
    if (overview.problem.status === 404) notFound();
    throw new Error(overview.problem.detail);
  }
  const membership = shops.ok ? shops.data.find((membership) => membership.slug === shop) : undefined;
  if (!membership?.permissions.includes("products.write")) redirect(`/app/${shop}/produits`);

  return (
    <>
      <header className="col-span-full px-1 pt-1.5">
        <Link href={`/app/${shop}/produits`} className="text-[12.5px] text-texte-2 hover:text-texte">
          ← Produits
        </Link>
        <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Importer depuis Excel</h1>
      </header>

      {overview.data.csv_import ? (
        <ImportPanel slug={shop} />
      ) : (
        <section className="vitre col-span-full flex flex-col gap-3 rounded-[24px] p-[18px] lg:col-span-6">
          <p className="text-[15px]">
            <span className="font-semibold text-ocre">L’import de produits arrive avec le plan Pro.</span> Avec le plan Gratuit, ajoutez vos produits un par
            un, jusqu’à {overview.data.limit ?? 25}.
          </p>
          {membership.permissions.includes("shop.manage") ? (
            <Link href={`/app/${shop}/parametres?onglet=plan`} className="bouton-nuit self-start rounded-full px-5 py-2.5 text-sm font-bold">
              Voir les plans
            </Link>
          ) : (
            <p className="text-sm text-texte-3">Le propriétaire de la boutique peut changer de plan.</p>
          )}
        </section>
      )}
    </>
  );
}
