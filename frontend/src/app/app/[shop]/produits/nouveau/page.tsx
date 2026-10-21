import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { getProductOverview } from "@/features/products/data";
import { ProductForm } from "@/features/products/product-form";
import { getMyShops } from "@/lib/server/session";

export const metadata: Metadata = { title: "Nouveau produit" };

export default function NewProductPage({ params }: PageProps<"/app/[shop]/produits/nouveau">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[560px] animate-pulse rounded-[24px]" />}>
      <NewProductFromRoute params={params} />
    </Suspense>
  );
}

async function NewProductFromRoute({ params }: Pick<PageProps<"/app/[shop]/produits/nouveau">, "params">) {
  const { shop } = await params;
  const [overview, shops] = await Promise.all([getProductOverview(shop), getMyShops()]);
  if (!overview.ok) {
    if (overview.problem.status === 404) notFound();
    throw new Error(overview.problem.detail);
  }
  // Un vendeur n'écrit pas dans le catalogue : la liste lui reste ouverte. Django refuserait de toute façon.
  const membership = shops.ok ? shops.data.find((membership) => membership.slug === shop) : undefined;
  if (!membership?.permissions.includes("products.write")) redirect(`/app/${shop}/produits`);

  return (
    <>
      <header className="col-span-full px-1 pt-1.5">
        <Link href={`/app/${shop}/produits`} className="text-[12.5px] text-texte-2 hover:text-texte">
          ← Produits
        </Link>
        <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Nouveau produit</h1>
      </header>
      <ProductForm slug={shop} categories={overview.data.categories} />
    </>
  );
}
