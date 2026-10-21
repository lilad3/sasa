import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { OrderRows, STATUS_TONE } from "@/features/dashboard/parts";
import { ExportPanel } from "@/features/orders/export-panel";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { getMe, getMyShops, getOrderCounts, getOrders } from "@/lib/server/session";
import type { OrderStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Commandes" };

const TABS: { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "En attente" },
  { status: "confirmed", label: "Confirmées" },
  { status: "shipped", label: "Expédiées" },
  { status: "delivered", label: "Livrées" },
  { status: "cancelled", label: "Annulées" },
];

type Filters = { status?: OrderStatus; q?: string; page: number };

function first(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

/** Adresse de la liste avec ses filtres : la pagination et les onglets les gardent. */
function listHref(slug: string, { status, q, page }: Filters) {
  const query = new URLSearchParams();
  if (status) query.set("statut", status);
  if (q) query.set("q", q);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return `/app/${slug}/commandes${text ? `?${text}` : ""}`;
}

export default function OrdersPage({ params, searchParams }: PageProps<"/app/[shop]/commandes">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[480px] animate-pulse rounded-[24px]" />}>
      <OrdersFromRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function OrdersFromRoute({ params, searchParams }: Pick<PageProps<"/app/[shop]/commandes">, "params" | "searchParams">) {
  const [{ shop }, query] = await Promise.all([params, searchParams]);
  const wanted = first(query.statut);
  const filters: Filters = {
    status: TABS.some((tab) => tab.status === wanted) ? (wanted as OrderStatus) : undefined,
    q: first(query.q)?.trim().slice(0, 60) || undefined,
    page: Math.max(1, Number.parseInt(first(query.page) ?? "1", 10) || 1),
  };

  const [result, counts, shops, me] = await Promise.all([getOrders(shop, filters), getOrderCounts(shop), getMyShops(), getMe()]);
  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    throw new Error(result.problem.detail);
  }
  const { results, count, pages } = result.data;
  const total = counts.ok ? Object.values(counts.data).reduce((sum, n) => sum + n, 0) : count;
  const filtered = Boolean(filters.status || filters.q);
  const canExport = shops.ok && shops.data.some((item) => item.slug === shop && item.permissions.includes("orders.export"));

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">{formatNumber(total)} commandes au total</p>
          <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Commandes</h1>
        </div>
        <Form action={`/app/${shop}/commandes`} role="search" className="flex w-full gap-2 sm:w-auto">
          {filters.status ? <input type="hidden" name="statut" value={filters.status} /> : null}
          <label htmlFor="recherche" className="sr-only">
            Chercher une commande
          </label>
          <input
            id="recherche"
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={60}
            placeholder="Référence, nom ou téléphone"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-encre/45 px-4 py-2.5 text-sm text-texte outline-none placeholder:text-texte-3 focus-visible:border-orange sm:w-[280px]"
          />
          <button type="submit" className="bouton-nuit rounded-full px-5 py-2.5 text-sm font-bold">
            Chercher
          </button>
        </Form>
      </header>

      <nav aria-label="Filtrer par statut" className="col-span-full flex gap-1 overflow-x-auto rounded-[16px] border border-trait-doux bg-encre/50 p-1">
        <TabLink href={listHref(shop, { q: filters.q, page: 1 })} active={!filters.status} label="Toutes" count={counts.ok ? total : undefined} />
        {TABS.map((tab) => (
          <TabLink
            key={tab.status}
            href={listHref(shop, { status: tab.status, q: filters.q, page: 1 })}
            active={filters.status === tab.status}
            label={tab.label}
            count={counts.ok ? counts.data[tab.status] : undefined}
            tone={STATUS_TONE[tab.status]}
          />
        ))}
      </nav>

      {canExport && me.ok ? <ExportPanel slug={shop} mfaEnabled={me.data.mfa_enabled} /> : null}

      <section aria-label="Liste des commandes" className="vitre col-span-full rounded-[24px] px-[18px] pt-3 pb-4">
        {filters.q ? (
          <p className="pb-2 text-[13px] text-texte-2">
            {formatNumber(count)} résultat{count > 1 ? "s" : ""} pour « {filters.q} »
          </p>
        ) : null}
        <OrderRows
          orders={results}
          slug={shop}
          showAllLink={false}
          empty={
            filtered ? (
              <>
                Aucune commande ne correspond.{" "}
                <Link href={`/app/${shop}/commandes`} className="font-semibold text-sable underline decoration-sable/40 underline-offset-[3px]">
                  Voir toutes les commandes
                </Link>
              </>
            ) : (
              "Aucune commande pour l’instant. Partagez le lien de votre boutique pour recevoir les premières."
            )
          }
        />
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-trait-doux pt-3 text-sm">
            {filters.page > 1 ? (
              <Link href={listHref(shop, { ...filters, page: filters.page - 1 })} className="rounded-full bg-white/[0.06] px-4 py-2 hover:bg-white/12">
                Page précédente
              </Link>
            ) : (
              <span />
            )}
            <span className="text-texte-3">
              Page {filters.page} sur {pages}
            </span>
            {filters.page < pages ? (
              <Link href={listHref(shop, { ...filters, page: filters.page + 1 })} className="rounded-full bg-white/[0.06] px-4 py-2 hover:bg-white/12">
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

function TabLink({ href, active, label, count, tone }: { href: string; active: boolean; label: string; count?: number; tone?: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex shrink-0 items-center gap-2 rounded-[12px] px-3 py-2 text-[13px] font-semibold whitespace-nowrap text-texte-3 hover:text-texte aria-[current=page]:bg-white/12 aria-[current=page]:text-texte"
    >
      {tone ? <span aria-hidden className={cn("h-3 w-1 rounded-sm bg-current", tone)} /> : null}
      {label}
      {count !== undefined ? <span className="font-normal text-texte-3 tabular-nums">{formatNumber(count)}</span> : null}
    </Link>
  );
}
