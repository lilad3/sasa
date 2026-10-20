import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OrderRows } from "@/features/dashboard/parts";
import { formatNumber } from "@/lib/format";
import { getOrders } from "@/lib/server/session";

export const metadata: Metadata = { title: "Commandes" };

export default function OrdersPage({ params, searchParams }: PageProps<"/app/[shop]/commandes">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[480px] animate-pulse rounded-[24px]" />}>
      <OrdersFromRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function OrdersFromRoute({ params, searchParams }: Pick<PageProps<"/app/[shop]/commandes">, "params" | "searchParams">) {
  const [{ shop }, query] = await Promise.all([params, searchParams]);
  const page = Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1);
  const result = await getOrders(shop, page);
  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    throw new Error(result.problem.detail);
  }
  const { results, count, pages } = result.data;

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">{formatNumber(count)} commandes au total</p>
          <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Commandes</h1>
        </div>
      </header>
      <section aria-label="Liste des commandes" className="vitre col-span-full rounded-[24px] px-[18px] pt-3 pb-4">
        <OrderRows orders={results} slug={shop} showAllLink={false} />
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-trait-doux pt-3 text-sm">
            {page > 1 ? (
              <Link href={`/app/${shop}/commandes?page=${page - 1}`} className="rounded-full bg-white/[0.06] px-4 py-2 hover:bg-white/12">
                Page précédente
              </Link>
            ) : (
              <span />
            )}
            <span className="text-texte-3">
              Page {page} sur {pages}
            </span>
            {page < pages ? (
              <Link href={`/app/${shop}/commandes?page=${page + 1}`} className="rounded-full bg-white/[0.06] px-4 py-2 hover:bg-white/12">
                Page suivante
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </>
  );
}
