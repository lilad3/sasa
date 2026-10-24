import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { DeliveryZones } from "@/features/settings/delivery-zones";
import { getDelivery } from "@/features/settings/data";
import { OwnerOnly } from "@/features/settings/owner-only";
import { PickupForm } from "@/features/settings/pickup-form";

export const metadata: Metadata = { title: "Livraison" };

export default function DeliveryPage({ params }: PageProps<"/app/[shop]/parametres/livraison">) {
  return (
    <Suspense fallback={<DeliverySkeleton />}>
      <DeliveryFromRoute params={params} />
    </Suspense>
  );
}

async function DeliveryFromRoute({ params }: Pick<PageProps<"/app/[shop]/parametres/livraison">, "params">) {
  const { shop } = await params;
  return (
    <OwnerOnly slug={shop} what="La livraison">
      {(name) => <DeliveryContent slug={shop} shopName={name} />}
    </OwnerOnly>
  );
}

async function DeliveryContent({ slug, shopName }: { slug: string; shopName: string }) {
  const delivery = await getDelivery(slug);
  if (!delivery.ok) throw new Error(delivery.problem.detail);
  const { zones, pickup } = delivery.data;

  return (
    <>
      <header className="col-span-full flex flex-col gap-1.5 px-1 pt-1.5">
        <p className="text-[12.5px] text-texte-2">
          <Link href={`/app/${slug}/parametres`} className="hover:underline">
            Paramètres
          </Link>{" "}
          · {shopName}
        </p>
        <h1 className="text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Livraison</h1>
        <p className="max-w-[64ch] text-[14px] text-texte-2">Les zones où vous livrez, ce que cela coûte et en combien de temps. Le client ne voit que les zones actives.</p>
        <p className="text-[13px] text-texte-3">{delivery.data.summary}</p>
      </header>
      <DeliveryZones slug={slug} delivery={delivery.data} />
      <PickupForm slug={slug} pickup={pickup} hasActiveZone={zones.some((zone) => zone.is_active)} />
    </>
  );
}

function DeliverySkeleton() {
  return (
    <>
      <div aria-hidden className="col-span-full h-[110px]" />
      <div aria-hidden className="vitre col-span-full h-[460px] animate-pulse rounded-[24px] lg:col-span-8" />
      <div aria-hidden className="vitre col-span-full h-[320px] animate-pulse rounded-[24px] lg:col-span-4" />
    </>
  );
}
