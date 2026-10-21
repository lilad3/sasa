import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { getProduct, getProductOverview } from "@/features/products/data";
import { DeleteProduct } from "@/features/products/delete-product";
import { ProductForm } from "@/features/products/product-form";
import { formatDateTime } from "@/lib/format";
import { getMyShops } from "@/lib/server/session";

export const metadata: Metadata = { title: "Produit" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ProductPage({ params }: PageProps<"/app/[shop]/produits/[id]">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[560px] animate-pulse rounded-[24px]" />}>
      <ProductFromRoute params={params} />
    </Suspense>
  );
}

async function ProductFromRoute({ params }: Pick<PageProps<"/app/[shop]/produits/[id]">, "params">) {
  const { shop, id } = await params;
  // Une adresse qui n'a pas la forme d'un identifiant ne part même pas vers l'API.
  if (!UUID.test(id)) notFound();

  const [result, overview, shops] = await Promise.all([getProduct(shop, id), getProductOverview(shop), getMyShops()]);
  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    throw new Error(result.problem.detail);
  }
  const membership = shops.ok ? shops.data.find((membership) => membership.slug === shop) : undefined;
  if (!membership?.permissions.includes("products.write")) redirect(`/app/${shop}/produits`);
  const product = result.data;

  return (
    <>
      <header className="col-span-full px-1 pt-1.5">
        <Link href={`/app/${shop}/produits`} className="text-[12.5px] text-texte-2 hover:text-texte">
          ← Produits
        </Link>
        <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">{product.name}</h1>
        <p className="mt-1 text-[13px] text-texte-3">Modifié le {formatDateTime(product.updated_at)}</p>
      </header>
      <ProductForm slug={shop} product={product} categories={overview.ok ? overview.data.categories : []} />
      <DeleteProduct slug={shop} productId={product.id} name={product.name} />
    </>
  );
}
