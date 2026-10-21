import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SecurityCard, SecurityCardSkeleton } from "@/features/settings/security-card";
import { formatNumber, formatToday } from "@/lib/format";
import { getDashboard, getMyShops } from "@/lib/server/session";
import type { Period } from "@/lib/types";

import { EmptyShop } from "./empty-shop";
import { Comptoir, CustomersPanel, HoursPanel, PaymentsPanel, PlacesPanel, StatusesPanel } from "./insights";
import { Delta, OrderRows, RoleBadge, StatCard, TopProducts, TwoTone } from "./parts";
import { RevenueChart } from "./revenue-chart";

export const PERIODS: { value: Period; param: string; short: string; label: string }[] = [
  { value: "7d", param: "7j", short: "7 j", label: "7 derniers jours" },
  { value: "30d", param: "30j", short: "30 j", label: "30 derniers jours" },
  { value: "90d", param: "90j", short: "90 j", label: "90 derniers jours" },
];

export function periodFromParam(param: unknown): (typeof PERIODS)[number] {
  return PERIODS.find((p) => p.param === param) ?? PERIODS[1];
}

export async function Dashboard({ slug, period }: { slug: string; period: (typeof PERIODS)[number] }) {
  const [result, shops] = await Promise.all([getDashboard(slug, period.value), getMyShops()]);

  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    if (result.problem.code === "permission_denied") return <RevenueRestricted slug={slug} />;
    throw new Error(result.problem.detail);
  }
  const membership = shops.ok ? shops.data.find((shop) => shop.slug === slug) : undefined;
  const summary = result.data;
  const { kpis, revenue_series, previous_series, top_products, recent_orders } = summary;

  const header = (
    <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
      <div>
        <p className="text-[12.5px] text-texte-2">{formatToday()}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <h1 className="text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Vos ventes</h1>
          {membership ? <RoleBadge membership={membership} /> : null}
        </div>
      </div>
      {/* Le filtre de période est unique et placé au-dessus de tout ce qu'il change. */}
      <nav aria-label="Période" className="flex gap-1 rounded-[14px] border border-trait-doux bg-encre/50 p-1">
        {PERIODS.map((p) => (
          <Link
            key={p.value}
            href={`/app/${slug}?periode=${p.param}`}
            aria-current={p.value === period.value ? "page" : undefined}
            className="rounded-[10px] px-3 py-1.5 text-[13px] font-semibold text-texte-3 hover:text-texte aria-[current=page]:bg-white/12 aria-[current=page]:text-texte"
          >
            {p.short}
          </Link>
        ))}
      </nav>
    </header>
  );

  // Aucune commande, même ancienne : le dashboard n'aurait que des zéros.
  if (recent_orders.length === 0) {
    return (
      <>
        {header}
        <EmptyShop slug={slug} canFillDemo={membership?.permissions.includes("shop.manage") ?? false} />
      </>
    );
  }

  // Deux colonnes sur ordinateur : les chiffres à gauche (7 lames), le comptoir « À faire » à droite (3 lames),
  // collé à l'écran. Le comptoir vient en premier dans la page : sur téléphone, le travail du jour passe en tête.
  return (
    <>
      {header}

      {/* Colonne de droite, collée à l'écran : le comptoir, puis, pour le propriétaire, la sécurité de la boutique. */}
      <div className="col-span-full flex flex-col gap-2.5 md:gap-3 lg:sticky lg:top-5 lg:order-last lg:col-span-3 lg:max-h-[calc(100dvh-2.5rem)] lg:self-start lg:gap-3.5 lg:overflow-y-auto">
        <Comptoir counts={summary.to_process} lowStock={summary.low_stock} slug={slug} />
        {membership?.permissions.includes("shop.manage") ? (
          <Suspense fallback={<SecurityCardSkeleton />}>
            <SecurityCard slug={slug} />
          </Suspense>
        ) : null}
      </div>

      <div className="cascade col-span-full grid grid-cols-subgrid content-start gap-y-2.5 md:gap-y-3 lg:col-span-7 lg:gap-y-3.5">
        <section aria-labelledby="titre-ca" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px]">
          <div className="carte grid gap-5 rounded-carte p-[18px] xl:grid-cols-[minmax(0,1fr)_190px]">
            <div className="flex min-w-0 flex-col gap-3">
              <h2 id="titre-ca" className="text-[12.5px] text-texte-3">
                Chiffre d’affaires · {period.label}
              </h2>
              <div className="flex flex-wrap items-center gap-3.5">
                <TwoTone value={formatNumber(kpis.revenue.value)} unit=" F" className="text-[clamp(40px,5vw,66px)]" />
                <Delta kpi={kpis.revenue} />
              </div>
              <RevenueChart series={revenue_series} previous={previous_series} />
            </div>
            <div className="grid content-start gap-2.5 sm:grid-cols-3 xl:grid-cols-1">
              <StatCard label="Commandes" kpi={kpis.orders} />
              <StatCard label="Panier moyen" kpi={kpis.average_basket} money />
              <StatCard label="Clients" kpi={kpis.customers} />
            </div>
          </div>
          <p className="px-1 text-xs text-texte-3">Les commandes annulées ne comptent ni dans le chiffre d’affaires ni dans le nombre de commandes.</p>
        </section>

        <section aria-labelledby="titre-produits" className="vitre col-span-full flex flex-col gap-3 rounded-[24px] p-[18px] lg:col-span-4">
          <h2 id="titre-produits" className="text-sm text-texte-2">
            Produits phares · {period.label}
          </h2>
          {top_products.length === 0 ? (
            <p className="text-sm text-texte-3">Aucune vente sur cette période.</p>
          ) : (
            <TopProducts products={top_products.slice(0, 5)} total={kpis.revenue.value} />
          )}
        </section>
        <PaymentsPanel payments={summary.payment_methods} revenue={kpis.revenue.value} />

        <StatusesPanel statuses={summary.statuses} periodLabel={period.label} />
        <PlacesPanel places={summary.places} revenue={kpis.revenue.value} />
        <HoursPanel grid={summary.order_hours} />
        <CustomersPanel customers={summary.customers} top={summary.top_customers} />

        <section aria-labelledby="titre-commandes" className="vitre col-span-full rounded-[24px] px-[18px] pt-4 pb-3">
          <h2 id="titre-commandes" className="pb-1 text-sm text-texte-2">
            Dernières commandes
          </h2>
          <OrderRows orders={recent_orders} slug={slug} />
        </section>
      </div>
    </>
  );
}

function RevenueRestricted({ slug }: { slug: string }) {
  return (
    <section className="vitre col-span-full flex flex-col items-start gap-3 rounded-[24px] p-6">
      <h1 className="text-[clamp(22px,2.4vw,28px)] font-medium tracking-tight">Le chiffre d’affaires n’est pas accessible avec votre rôle</h1>
      <p className="max-w-[60ch] text-texte-2">
        En tant que vendeur, vous traitez les commandes de la boutique. Les chiffres de vente sont réservés au propriétaire et aux gérants.
      </p>
      <Link href={`/app/${slug}/commandes`} className="bouton-nuit mt-1 rounded-full px-5 py-2.5 text-sm font-bold">
        Voir les commandes
      </Link>
    </section>
  );
}

export function DashboardSkeleton() {
  return (
    <>
      <div aria-hidden className="col-span-full h-[70px]" />
      <div aria-hidden className="vitre col-span-full h-[150px] animate-pulse rounded-[24px] lg:order-last lg:col-span-3 lg:h-[420px] lg:self-start" />
      <div aria-hidden className="col-span-full grid grid-cols-subgrid content-start gap-y-2.5 md:gap-y-3 lg:col-span-7 lg:gap-y-3.5">
        <div className="vitre col-span-full h-[380px] animate-pulse rounded-[24px]" />
        <div className="vitre col-span-full h-[300px] animate-pulse rounded-[24px] lg:col-span-4" />
        <div className="vitre col-span-full h-[300px] animate-pulse rounded-[24px] lg:col-span-3" />
      </div>
    </>
  );
}
