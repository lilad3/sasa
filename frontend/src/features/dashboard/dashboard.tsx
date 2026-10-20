import Link from "next/link";
import { notFound } from "next/navigation";

import { cn } from "@/lib/cn";
import { formatNumber, formatToday } from "@/lib/format";
import { getDashboard, getMyShops } from "@/lib/server/session";
import type { Period } from "@/lib/types";

import { Delta, OrderRows, ProductCard, RoleCard, StatCard, TwoTone } from "./parts";
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
  const { kpis, revenue_series, top_products, recent_orders } = result.data;

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">{formatToday()}</p>
          <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Vos ventes</h1>
        </div>
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

      <section aria-labelledby="titre-produits" className="col-span-full grid grid-cols-subgrid gap-y-2.5 lg:col-span-6">
        <h2 id="titre-produits" className="col-span-full px-1 text-sm text-texte-2">
          Produits phares · {period.label}
        </h2>
        {top_products.length === 0 ? (
          <p className="carte col-span-full rounded-carte p-5 text-sm text-texte-3">Aucune vente sur cette période.</p>
        ) : (
          top_products.slice(0, 3).map((product, rank) => (
            <div key={product.id} className={cn("col-span-4 grid md:col-span-4 lg:col-span-2", rank === 2 && "md:col-span-4")}>
              <ProductCard rank={rank} name={product.name} units={product.units} revenue={product.revenue} total={kpis.revenue.value} />
            </div>
          ))
        )}
      </section>

      {membership ? (
        <div className="col-span-4 grid md:col-span-4 lg:col-span-4 lg:mt-[30px]">
          <RoleCard membership={membership} />
        </div>
      ) : null}

      <section aria-labelledby="titre-ca" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px]">
        <div className="carte grid gap-5 rounded-carte p-[18px] lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-3">
            <h2 id="titre-ca" className="text-[12.5px] text-texte-3">
              Chiffre d’affaires · {period.label}
            </h2>
            <div className="flex flex-wrap items-center gap-3.5">
              <TwoTone value={formatNumber(kpis.revenue.value)} unit=" F" className="text-[clamp(40px,6vw,66px)]" />
              <Delta kpi={kpis.revenue} />
            </div>
            <RevenueChart series={revenue_series} />
          </div>
          <div className="grid content-start gap-2.5 sm:grid-cols-3 lg:grid-cols-1">
            <StatCard label="Commandes" kpi={kpis.orders} />
            <StatCard label="Panier moyen" kpi={kpis.average_basket} money />
            <StatCard label="Clients" kpi={kpis.customers} />
          </div>
        </div>
        <p className="px-1 text-xs text-texte-3">Les commandes annulées ne comptent ni dans le chiffre d’affaires ni dans le nombre de commandes.</p>
      </section>

      <section aria-labelledby="titre-commandes" className="vitre col-span-full rounded-[24px] px-[18px] pt-4 pb-3">
        <h2 id="titre-commandes" className="pb-1 text-sm text-texte-2">
          Dernières commandes
        </h2>
        <OrderRows orders={recent_orders} slug={slug} />
      </section>
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
      {[0, 1, 2].map((i) => (
        <div key={i} aria-hidden className="carte col-span-4 h-[250px] animate-pulse rounded-carte md:col-span-4 lg:col-span-2" />
      ))}
      <div aria-hidden className="col-span-4 h-[250px] animate-pulse rounded-[24px] bg-white/[0.06] md:col-span-4" />
      <div aria-hidden className="vitre col-span-full h-[340px] animate-pulse rounded-[24px]" />
    </>
  );
}
