import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert } from "@/features/auth/form-alert";
import { getMovements, getProduct, getProductOverview } from "@/features/products/data";
import { DeleteProduct } from "@/features/products/delete-product";
import { FeaturedCard } from "@/features/products/featured";
import { HeaderActions } from "@/features/products/header-actions";
import { ProductPhotos } from "@/features/products/photos";
import { ProductForm } from "@/features/products/product-form";
import { StockAdjust, StockHistory } from "@/features/products/stock-sheet";
import { formatDateTime } from "@/lib/format";
import { getMyShops } from "@/lib/server/session";
import { voice } from "@/lib/voice";

export const metadata: Metadata = { title: "Produit" };

const STATUS_LABEL = { draft: "Brouillon", active: "Actif", archived: "Archivé" } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FLASH: Record<string, "copie" | "ajoute"> = { copie: "copie", ajoute: "ajoute" };

export default function ProductPage({ params, searchParams }: PageProps<"/app/[shop]/produits/[id]">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[560px] animate-pulse rounded-[24px]" />}>
      <ProductFromRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProductFromRoute({ params, searchParams }: Pick<PageProps<"/app/[shop]/produits/[id]">, "params" | "searchParams">) {
  const [{ shop, id }, query] = await Promise.all([params, searchParams]);
  // Une adresse qui n'a pas la forme d'un identifiant ne part même pas vers l'API.
  if (!UUID.test(id)) notFound();

  const [result, overview, shops, movements] = await Promise.all([getProduct(shop, id), getProductOverview(shop), getMyShops(), getMovements(shop, id)]);
  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    throw new Error(result.problem.detail);
  }
  const membership = shops.ok ? shops.data.find((membership) => membership.slug === shop) : undefined;
  if (!membership?.permissions.includes("products.write")) redirect(`/app/${shop}/produits`);
  const product = result.data;
  const words = voice(membership.role, membership.name).catalog;
  const flash = typeof query.ok === "string" ? FLASH[query.ok] : undefined;

  return (
    <>
      <header className="col-span-full px-1 pt-1.5">
        <Link href={`/app/${shop}/produits`} className="text-[12.5px] text-texte-2 hover:text-texte">
          ← Produits
        </Link>
        <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">{product.name}</h1>
        <p className="mt-1 text-[13px] text-texte-3">
          {STATUS_LABEL[product.status]} · Modifié le {formatDateTime(product.updated_at)}
        </p>
        <div className="mt-3">
          <HeaderActions slug={shop} productId={product.id} status={product.status} />
        </div>
      </header>
      {flash === "copie" ? (
        <div className="col-span-full">
          <FormAlert tone="success">{words.duplicated}</FormAlert>
        </div>
      ) : null}
      {product.status !== "active" ? (
        <p role="note" className="col-span-full rounded-[18px] border border-trait bg-white/[0.04] px-4 py-3 text-sm text-texte-2">
          {words.notVisible}
        </p>
      ) : null}
      <ProductForm
        slug={shop}
        product={product}
        categories={overview.ok ? overview.data.categories : []}
        tagSuggestions={overview.ok ? overview.data.tags.map((tag) => tag.label) : []}
        canCost={membership.permissions.includes("products.cost")}
      />
      <section aria-labelledby="titre-mouvements" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="titre-mouvements" className="text-sm text-texte-2">
            Mouvements de stock
          </h2>
          <StockAdjust slug={shop} productId={product.id} productName={product.name} stock={product.stock} />
        </div>
        {movements.ok ? (
          <StockHistory slug={shop} productId={product.id} first={movements.data.results} next={movements.data.next_before} />
        ) : (
          <p className="text-sm text-texte-3">L’historique n’a pas pu être chargé. Rechargez la page.</p>
        )}
      </section>
      <ProductPhotos slug={shop} productId={product.id} productName={product.name} photos={product.photos} />
      {membership.permissions.includes("storefront.edit") ? (
        <FeaturedCard slug={shop} productId={product.id} isFeatured={product.is_featured} isActive={product.status === "active"} inStock={product.stock > 0 || product.allow_backorder} />
      ) : null}
      <DeleteProduct slug={shop} productId={product.id} name={product.name} />
    </>
  );
}
