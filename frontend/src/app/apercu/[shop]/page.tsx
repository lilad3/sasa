import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { StorefrontApp } from "@/features/storefront/storefront-app";
import { decodeDesign } from "@/lib/design";
import { getMyShops } from "@/lib/server/session";
import { getStorefront, getStorefrontProducts } from "@/lib/server/storefront";

export const metadata: Metadata = { title: "Aperçu de la vitrine", robots: { index: false, follow: false } };

/**
 * L'aperçu de « Ma boutique » (docs/chantier-p5.md §3.5), affiché dans l'éditeur. Les réglages arrivent
 * dans l'adresse (?c=), revalidés par zod ; rien n'est enregistré, et l'on ne peut pas y commander.
 * Réservé à qui peut modifier la vitrine de cette boutique.
 */
export default function PreviewPage({ params, searchParams }: PageProps<"/apercu/[shop]">) {
  return (
    <Suspense fallback={<div aria-hidden className="min-h-dvh bg-nuit" />}>
      <Preview params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Preview({ params, searchParams }: PageProps<"/apercu/[shop]">) {
  const { shop: slug } = await params;
  const { c } = await searchParams;
  const shops = await getMyShops();
  const membership = shops.ok ? shops.data.find((m) => m.slug === slug) : undefined;
  if (!membership?.permissions.includes("storefront.edit")) notFound();

  const [shop, products] = await Promise.all([getStorefront(slug), getStorefrontProducts(slug)]);
  if (!shop.ok || !products.ok) notFound();
  const design = decodeDesign(typeof c === "string" ? c : null) ?? shop.data.design;
  return <StorefrontApp shop={{ ...shop.data, design }} products={products.data} preview />;
}
