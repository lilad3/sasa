import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { FormAlert } from "@/features/auth/form-alert";
import { getProduct, getProductOverview } from "@/features/products/data";
import { DeleteProduct } from "@/features/products/delete-product";
import { FeaturedCard } from "@/features/products/featured";
import { PHOTO_PROBLEMS } from "@/features/products/photo-files";
import { ProductPhotos } from "@/features/products/photos";
import { ProductForm } from "@/features/products/product-form";
import { formatDateTime } from "@/lib/format";
import { getMyShops } from "@/lib/server/session";
import { voice } from "@/lib/voice";

export const metadata: Metadata = { title: "Produit" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function first(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

/**
 * Après la création (product-form.tsx), `photos=<envoyées>-<voulues>` dit combien de photos ne sont pas arrivées.
 * L'adresse se modifie à la main : on n'accepte que des chiffres cohérents, et un motif de la liste connue.
 */
function missingPhotos(photos: string | undefined, reason: string | undefined) {
  const match = /^([0-2])-([1-3])$/.exec(photos ?? "");
  const missing = match ? Number(match[2]) - Number(match[1]) : 0;
  if (missing <= 0) return null;
  const text = missing > 1 ? `${missing} photos n’ont pas pu être envoyées. Ajoutez-les ci-dessous.` : "1 photo n’a pas pu être envoyée. Ajoutez-la ci-dessous.";
  return { text, reason: reason && Object.hasOwn(PHOTO_PROBLEMS, reason) ? PHOTO_PROBLEMS[reason] : null };
}

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

  const [result, overview, shops] = await Promise.all([getProduct(shop, id), getProductOverview(shop), getMyShops()]);
  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    throw new Error(result.problem.detail);
  }
  const membership = shops.ok ? shops.data.find((membership) => membership.slug === shop) : undefined;
  if (!membership?.permissions.includes("products.write")) redirect(`/app/${shop}/produits`);
  const product = result.data;
  const added = first(query.ok) === "ajoute";
  const missing = added ? missingPhotos(first(query.photos), first(query.raison)) : null;

  return (
    <>
      <header className="col-span-full px-1 pt-1.5">
        <Link href={`/app/${shop}/produits`} className="text-[12.5px] text-texte-2 hover:text-texte">
          ← Produits
        </Link>
        <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">{product.name}</h1>
        <p className="mt-1 text-[13px] text-texte-3">Modifié le {formatDateTime(product.updated_at)}</p>
      </header>
      {added ? (
        <div className="col-span-full">
          <FormAlert tone="success">
            Produit ajouté.{product.is_active ? ` ${voice(membership.role, membership.name).productOnline}` : null}
          </FormAlert>
        </div>
      ) : null}
      {missing ? (
        <p role="note" className="col-span-full rounded-[18px] border border-ocre/35 bg-ocre/10 px-4 py-3 text-sm">
          <span className="font-semibold text-ocre">{missing.text}</span>
          {missing.reason ? ` ${missing.reason}` : null}
        </p>
      ) : null}
      <ProductForm slug={shop} product={product} categories={overview.ok ? overview.data.categories : []} />
      <ProductPhotos slug={shop} productId={product.id} productName={product.name} photos={product.photos} />
      {membership.permissions.includes("storefront.edit") ? (
        <FeaturedCard slug={shop} productId={product.id} isFeatured={product.is_featured} isActive={product.is_active} inStock={product.stock > 0} />
      ) : null}
      <DeleteProduct slug={shop} productId={product.id} name={product.name} />
    </>
  );
}
