import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { NameVipForm, ThresholdForm } from "@/features/customers/forms";
import { CustomerExportPanel } from "@/features/customers/export-panel";
import { GiveDiscount } from "@/features/customers/discounts";
import { CustomerTags, LoyalCard, Reliability } from "@/features/customers/parts";
import { TwoTone } from "@/features/dashboard/parts";
import { cn } from "@/lib/cn";
import { compactFcfa, formatNumber, formatSince, formatVariation, variation } from "@/lib/format";
import { getCustomerSummary, getCustomers, getMe, getMyShops } from "@/lib/server/session";
import { storefrontLink } from "@/lib/server/storefront-link";
import type { CustomerSegment } from "@/lib/types";
import { voice } from "@/lib/voice";

export const metadata: Metadata = { title: "Clients" };

const SEGMENTS: { value: CustomerSegment; label: string }[] = [
  { value: "all", label: "Tous" },
  { value: "loyal", label: "Fidèles" },
  { value: "new", label: "Nouveaux" },
  { value: "win_back", label: "À relancer" },
  { value: "at_risk", label: "À risque" },
];

type Filters = { segment: CustomerSegment; q?: string; page: number };

function first(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

function listHref(slug: string, { segment, q, page }: Filters) {
  const query = new URLSearchParams();
  if (segment !== "all") query.set("segment", segment);
  if (q) query.set("q", q);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return `/app/${slug}/clients${text ? `?${text}` : ""}`;
}

export default function CustomersPage({ params, searchParams }: PageProps<"/app/[shop]/clients">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[520px] animate-pulse rounded-[26px]" />}>
      <CustomersFromRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function CustomersFromRoute({ params, searchParams }: Pick<PageProps<"/app/[shop]/clients">, "params" | "searchParams">) {
  const [{ shop }, query] = await Promise.all([params, searchParams]);
  const wanted = first(query.segment);
  const filters: Filters = {
    segment: SEGMENTS.some((s) => s.value === wanted) ? (wanted as CustomerSegment) : "all",
    q: first(query.q)?.trim().slice(0, 60) || undefined,
    page: Math.max(1, Number.parseInt(first(query.page) ?? "1", 10) || 1),
  };

  const [list, summary, shops, me, link] = await Promise.all([
    getCustomers(shop, { ...filters, sort: filters.segment === "loyal" ? "spent" : "recent" }),
    getCustomerSummary(shop),
    getMyShops(),
    getMe(),
    storefrontLink(shop),
  ]);
  // Le vendeur n'a pas accès aux clients (403) : la page n'existe pas pour lui, comme le menu.
  if (!list.ok || !summary.ok) {
    if (!list.ok && [403, 404].includes(list.problem.status)) notFound();
    throw new Error("Impossible de charger les clients.");
  }
  const membership = shops.ok ? shops.data.find((item) => item.slug === shop) : undefined;
  if (!membership) notFound();
  const v = voice(membership.role, membership.name);
  const can = (permission: string) => membership.permissions.includes(permission);
  const s = summary.data;
  const activeChange = variation(s.active_30d, s.active_30d_previous);
  const { results, count, pages } = list.data;

  const tiles: { segment: CustomerSegment; label: string; value: number; foot: string; tone: string }[] = [
    { segment: "all", label: "Actifs sur 30 jours", value: s.active_30d, foot: activeChange === null ? `${formatNumber(s.total)} clients en tout` : `${formatVariation(activeChange)} vs les 30 jours d’avant`, tone: "" },
    { segment: "loyal", label: "Fidèles", value: s.loyal, foot: `${s.loyalty_threshold} commandes livrées ou plus, ou nommés`, tone: "text-orange-clair" },
    { segment: "win_back", label: "À relancer", value: s.win_back, foot: "bons clients silencieux depuis 45 jours", tone: "text-ocre" },
    { segment: "at_risk", label: "À risque", value: s.at_risk, foot: "annulent ou refusent à la livraison", tone: "text-danger-clair" },
  ];

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">{formatNumber(s.total)} clients · reconnus à leur numéro de téléphone</p>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,34px)] font-medium tracking-tight">{v.customers}</h1>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <Form action={`/app/${shop}/clients`} role="search" className="flex w-full gap-2 sm:w-auto">
            {filters.segment !== "all" ? <input type="hidden" name="segment" value={filters.segment} /> : null}
            <label htmlFor="recherche-client" className="sr-only">
              Chercher un client
            </label>
            <input
              id="recherche-client"
              name="q"
              type="search"
              defaultValue={filters.q}
              maxLength={60}
              placeholder="Nom ou chiffres du numéro"
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-encre/45 px-4 py-2.5 text-sm text-texte outline-none placeholder:text-texte-3 focus-visible:border-orange sm:w-[260px]"
            />
            <button type="submit" className="bouton-nuit rounded-full px-5 py-2.5 text-sm font-bold">
              Chercher
            </button>
          </Form>
          {can("customers.vip") ? <NameVipForm slug={shop} /> : null}
          {can("customers.export") ? <CustomerExportPanel slug={shop} mfaEnabled={me.ok && me.data.mfa_enabled} segment={filters.segment} /> : null}
        </div>
      </header>

      {/* Les quatre compteurs servent aussi de filtres. */}
      <nav aria-label="Segments de clients" className="cascade col-span-full grid gap-2.5 sm:grid-cols-2 md:gap-3 xl:grid-cols-4">
        {tiles.map((tile) => (
          <Link
            key={tile.segment}
            href={listHref(shop, { segment: tile.segment, page: 1 })}
            aria-current={filters.segment === tile.segment ? "page" : undefined}
            className="vitre flex min-h-[140px] flex-col gap-2.5 rounded-[22px] p-4 transition-colors hover:bg-white/[0.08] aria-[current=page]:border-orange-clair/50"
          >
            <span className="text-[14px] text-texte-2">{tile.label}</span>
            <TwoTone value={formatNumber(tile.value)} className={cn("text-[clamp(32px,3vw,44px)]", tile.tone)} />
            <span className="mt-auto text-[12.5px] text-texte-3">{tile.foot}</span>
          </Link>
        ))}
      </nav>

      {s.loyal_top.length > 0 && filters.segment === "all" && !filters.q ? (
        <section aria-labelledby="titre-fideles" className="vitre col-span-full flex flex-col gap-4 rounded-[26px] p-[18px]">
          <div className="flex flex-wrap items-end justify-between gap-3 px-1">
            <div>
              <h2 id="titre-fideles" className="text-[clamp(18px,1.8vw,22px)] font-medium">
                {v.loyal} · {formatNumber(s.loyal)}
              </h2>
              <p className="text-[12.5px] text-texte-3">Classés par ce qu’ils ont dépensé. Leurs commandes des 6 derniers mois, mois par mois.</p>
            </div>
            {can("customers.loyalty") ? <ThresholdForm slug={shop} threshold={s.loyalty_threshold} /> : null}
          </div>
          <ol className="cascade grid gap-2.5 sm:grid-cols-2 md:gap-3 xl:grid-cols-3">
            {s.loyal_top.map((customer) => (
              <LoyalCard
                key={customer.id}
                customer={customer}
                slug={shop}
                action={
                  can("discounts.give") ? (
                    <GiveDiscount
                      compact
                      slug={shop}
                      customerId={customer.id}
                      customerName={customer.name}
                      shopName={membership.name}
                      shopUrl={link.url}
                      cap={membership.role === "owner" ? null : (membership.discount_cap_percent ?? 0)}
                      mfaEnabled={me.ok && me.data.mfa_enabled}
                    />
                  ) : null
                }
              />
            ))}
          </ol>
        </section>
      ) : null}

      <section aria-label="Liste des clients" className="vitre col-span-full flex flex-col gap-3 rounded-[26px] px-[18px] pt-3 pb-4">
        <nav aria-label="Filtrer" className="flex gap-1 overflow-x-auto border-b border-trait-doux pb-2">
          {SEGMENTS.map((segment) => (
            <Link
              key={segment.value}
              href={listHref(shop, { segment: segment.value, q: filters.q, page: 1 })}
              aria-current={filters.segment === segment.value ? "page" : undefined}
              className="shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] font-semibold whitespace-nowrap text-texte-3 transition-colors hover:text-texte aria-[current=page]:bg-white/12 aria-[current=page]:text-texte"
            >
              {segment.label}
            </Link>
          ))}
        </nav>
        {filters.q ? (
          <p className="text-[13px] text-texte-2">
            {formatNumber(count)} résultat{count > 1 ? "s" : ""} pour « {filters.q} »
          </p>
        ) : null}

        {results.length === 0 ? (
          <p className="rounded-[16px] border border-dashed border-trait p-4 text-sm text-texte-3">
            {filters.q || filters.segment !== "all" ? "Aucun client ne correspond." : "Vos clients apparaîtront ici après leur première commande."}
          </p>
        ) : (
          <ul className="flex flex-col">
            {results.map((customer) => {
              const [value, unit] = compactFcfa(customer.spent);
              return (
                <li key={customer.id} className="border-b border-trait-doux last:border-0">
                  <Link
                    href={`/app/${shop}/clients/${customer.id}`}
                    className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 rounded-xl px-2 py-3 transition-colors hover:bg-white/[0.05] md:grid-cols-[minmax(0,1.6fr)_90px_110px_130px_120px]"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="truncate text-[14.5px] font-semibold">{customer.name}</span>
                        <CustomerTags customer={customer} />
                      </span>
                      <span className="mt-0.5 block font-mono text-[12.5px] text-texte-3">
                        {customer.phone_masked}
                        <span className="font-sans"> · {customer.commune || customer.city || "sans livraison"}</span>
                      </span>
                    </span>
                    <span className="text-right text-sm font-semibold tabular-nums md:order-3 md:text-left">
                      {value}
                      <span className="font-normal text-texte-3">{unit}</span>
                    </span>
                    <span className="text-[13px] text-texte-2 tabular-nums md:order-2">
                      {formatNumber(customer.orders)} cmd
                    </span>
                    <span className="justify-self-end text-[12.5px] text-texte-3 md:order-4 md:justify-self-start">
                      {customer.last_order_at ? formatSince(customer.last_order_at) : "jamais commandé"}
                    </span>
                    <span className="hidden md:order-5 md:block">
                      <Reliability value={customer.reliability} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

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
