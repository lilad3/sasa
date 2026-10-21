import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FondOrange } from "@/components/ui/fond-orange";
import { StorefrontApp } from "@/features/storefront/storefront-app";
import { StorefrontUnavailable } from "@/features/storefront/unavailable";
import { getStorefront, getStorefrontProducts } from "@/lib/server/storefront";

export async function generateMetadata({ params }: PageProps<"/boutique/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const shop = await getStorefront(slug);
  if (!shop.ok) return { title: "Boutique introuvable" };
  return { title: shop.data.name, description: shop.data.description || `La boutique ${shop.data.name} sur Akwaba.` };
}

/** Vitrine publique d'une boutique : n'importe qui peut la voir et commander, sans compte. */
export default function StorefrontPage({ params }: PageProps<"/boutique/[slug]">) {
  return (
    <Suspense fallback={<StorefrontSkeleton />}>
      <StorefrontFromRoute params={params} />
    </Suspense>
  );
}

async function StorefrontFromRoute({ params }: Pick<PageProps<"/boutique/[slug]">, "params">) {
  const { slug } = await params;
  const [shop, products] = await Promise.all([getStorefront(slug), getStorefrontProducts(slug)]);
  // Django injoignable : une page qui explique, au lieu d'une erreur brute (c'est un cas prévu, pas un bug).
  if ((!shop.ok && shop.problem.code === "network_error") || (!products.ok && products.problem.code === "network_error")) {
    return <StorefrontUnavailable slug={slug} />;
  }
  if (!shop.ok) {
    if (shop.problem.status === 404) notFound();
    throw new Error(shop.problem.detail);
  }
  if (!products.ok) throw new Error(products.problem.detail);
  return <StorefrontApp shop={shop.data} products={products.data} />;
}

function StorefrontSkeleton() {
  return (
    <div aria-hidden className="relative isolate min-h-dvh px-3 pt-3 md:px-5">
      <FondOrange />
      <div className="mx-auto flex max-w-[1180px] flex-col gap-8">
        <div className="h-[60px] animate-pulse rounded-full bg-[rgb(255_244_232/0.4)]" />
        <div className="h-[clamp(520px,60vw,660px)] animate-pulse rounded-[28px] bg-nuit-2" />
      </div>
    </div>
  );
}
