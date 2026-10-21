import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OrderDetail } from "@/features/orders/order-detail";
import { getMyShops, getOrder } from "@/lib/server/session";

export const metadata: Metadata = { title: "Commande" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function OrderPage({ params }: PageProps<"/app/[shop]/commandes/[id]">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[520px] animate-pulse rounded-[24px]" />}>
      <OrderFromRoute params={params} />
    </Suspense>
  );
}

async function OrderFromRoute({ params }: Pick<PageProps<"/app/[shop]/commandes/[id]">, "params">) {
  const { shop, id } = await params;
  // Une adresse qui n'a pas la forme d'un identifiant ne part même pas vers l'API.
  if (!UUID.test(id)) notFound();

  const [result, shops] = await Promise.all([getOrder(shop, id), getMyShops()]);
  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    throw new Error(result.problem.detail);
  }
  const membership = shops.ok ? shops.data.find((membership) => membership.slug === shop) : undefined;

  return <OrderDetail order={result.data} slug={shop} canManage={membership?.permissions.includes("orders.manage") ?? false} />;
}
