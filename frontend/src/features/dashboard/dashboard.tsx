import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SecurityCard, SecurityCardSkeleton } from "@/features/settings/security-card";
import { getDashboard, getGoal, getMyShops } from "@/lib/server/session";
import type { Period } from "@/lib/types";
import { voice } from "@/lib/voice";

import { BestSellers } from "./bestsellers";
import { EmptyShop } from "./empty-shop";
import { Comptoir, HoursPanel } from "./insights";
import { MonthPanel } from "./month-panel";
import { OrderRows } from "./parts";
import { RevenueChart } from "./revenue-chart";
import { ShareCard } from "./share-card";

export const PERIODS: { value: Period; param: string; short: string; label: string }[] = [
  { value: "7d", param: "7j", short: "7 j", label: "7 derniers jours" },
  { value: "30d", param: "30j", short: "30 j", label: "30 derniers jours" },
  { value: "90d", param: "90j", short: "90 j", label: "90 derniers jours" },
];

export function periodFromParam(param: unknown): (typeof PERIODS)[number] {
  return PERIODS.find((p) => p.param === param) ?? PERIODS[1];
}

/** Le lien public de la vitrine, tel que le visiteur l'a sous les yeux (même hôte que l'espace marchand). */
async function storefrontLink(slug: string) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "akwaba.ci";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.)/.test(host) ? "http" : "https");
  return { url: `${proto}://${host}/boutique/${slug}`, display: `${host.replace(/^www\./, "")}/boutique/${slug}` };
}

function PeriodNav({ slug, period }: { slug: string; period: (typeof PERIODS)[number] }) {
  return (
    // Le filtre de période est unique et placé au-dessus de ce qu'il change : produits, onglets et courbe.
    <nav aria-label="Période" className="flex gap-1 rounded-full border border-trait-doux bg-encre/50 p-1">
      {PERIODS.map((p) => (
        <Link
          key={p.value}
          href={`/app/${slug}?periode=${p.param}`}
          aria-current={p.value === period.value ? "page" : undefined}
          className="rounded-full px-3.5 py-1.5 text-[13px] font-semibold text-texte-3 transition-colors hover:text-texte aria-[current=page]:bg-white/12 aria-[current=page]:text-texte"
        >
          {p.short}
        </Link>
      ))}
    </nav>
  );
}

export async function Dashboard({ slug, period }: { slug: string; period: (typeof PERIODS)[number] }) {
  const [result, shops, goal, link] = await Promise.all([getDashboard(slug, period.value), getMyShops(), getGoal(slug), storefrontLink(slug)]);

  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    if (result.problem.code === "permission_denied") return <RevenueRestricted slug={slug} />;
    throw new Error(result.problem.detail);
  }
  const membership = shops.ok ? shops.data.find((shop) => shop.slug === slug) : undefined;
  if (!membership) notFound();
  const v = voice(membership.role, membership.name);
  const can = (permission: string) => membership.permissions.includes(permission);
  const summary = result.data;
  const { revenue_series, previous_series, top_products, recent_orders } = summary;

  // Aucune commande, même ancienne : le dashboard n'aurait que des zéros.
  if (recent_orders.length === 0) {
    return (
      <>
        <header className="col-span-full px-1 pt-1.5">
          <h1 className="text-[clamp(26px,2.8vw,34px)] font-medium tracking-tight">{v.online}</h1>
        </header>
        <EmptyShop slug={slug} canFillDemo={can("shop.manage")} />
      </>
    );
  }

  return (
    <>
      {/* Rangée du haut : ce qui se vend le mieux (7 lames), et le lien de la boutique à partager (3 lames). */}
      <div className="col-span-full flex flex-col gap-4 lg:col-span-7">
        <header className="flex flex-col gap-2.5 px-1 pt-1.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <p className="text-[15px] text-texte-2">{v.topProducts}</p>
            <span className="rounded-full border border-white/12 bg-encre/40 px-3 py-1 text-[13px] text-texte-2">{period.label}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <h1 className="text-[clamp(28px,3.1vw,42px)] leading-tight font-medium tracking-tight">{v.bestSellers}</h1>
            <PeriodNav slug={slug} period={period} />
            <span className="rounded-full border border-white/12 px-3.5 py-1.5 text-[13px] text-texte-2">Chiffre d’affaires</span>
            {summary.has_demo_data ? (
              <span className="rounded-full border border-dashed border-white/25 px-2.5 py-1 font-mono text-[12px] text-texte-3" title="Données de démonstration">
                exemple
              </span>
            ) : null}
          </div>
        </header>
        <BestSellers products={top_products} slug={slug} canOpen={can("products.view")} />
      </div>
      <div className="col-span-full lg:col-span-3">
        <ShareCard url={link.url} display={link.display} title={v.online} hint={v.shareHint} shopName={membership.name} />
      </div>

      <MonthPanel slug={slug} summary={summary} membership={membership} voice={v} goal={goal} periodChip={period.short.toUpperCase()} />

      <section aria-labelledby="titre-courbe" className="vitre col-span-full flex flex-col gap-4 rounded-[26px] p-[18px] lg:col-span-6">
        <h2 id="titre-courbe" className="text-sm text-texte-2">
          Jour après jour · {period.label}
        </h2>
        <RevenueChart series={revenue_series} previous={previous_series} />
        <p className="text-xs text-texte-3">Les commandes annulées ne comptent ni dans le chiffre d’affaires ni dans le nombre de commandes.</p>
      </section>
      <HoursPanel grid={summary.order_hours} />

      <section aria-labelledby="titre-commandes" className="vitre col-span-full rounded-[26px] px-[18px] pt-4 pb-3 lg:col-span-7">
        <h2 id="titre-commandes" className="pb-1 text-sm text-texte-2">
          Dernières commandes
        </h2>
        <OrderRows orders={recent_orders} slug={slug} />
      </section>
      <div className="col-span-full flex flex-col gap-2.5 md:gap-3 lg:col-span-3 lg:gap-3.5">
        <Comptoir counts={summary.to_process} lowStock={summary.low_stock} slug={slug} allClear={v.allClear} />
        {can("shop.manage") ? (
          <Suspense fallback={<SecurityCardSkeleton />}>
            <SecurityCard slug={slug} />
          </Suspense>
        ) : null}
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
      <div aria-hidden className="col-span-full flex flex-col gap-4 lg:col-span-7">
        <div className="h-[92px]" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="carte h-[300px] animate-pulse rounded-[22px]" />
          ))}
        </div>
      </div>
      <div aria-hidden className="vitre col-span-full h-[400px] animate-pulse rounded-[28px] lg:col-span-3" />
      <div aria-hidden className="vitre col-span-full h-[520px] animate-pulse rounded-[30px]" />
    </>
  );
}
