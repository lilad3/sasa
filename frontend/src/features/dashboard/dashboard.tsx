import Link from "next/link";
import { notFound } from "next/navigation";
import { type ReactNode, Suspense } from "react";

import { SecurityCard, SecurityCardSkeleton } from "@/features/settings/security-card";
import { cn } from "@/lib/cn";
import { formatNumber, formatToday, formatVariation, variation } from "@/lib/format";
import { getDashboard, getGoal, getMyShops } from "@/lib/server/session";
import { storefrontLink } from "@/lib/server/storefront-link";
import type { DashboardSummary, Kpi, Period } from "@/lib/types";
import { voice } from "@/lib/voice";

import { ProductSwatch } from "./bestsellers";
import { EmptyShop } from "./empty-shop";
import { HoursPanel } from "./insights";
import { ModeToggle } from "./mode-toggle";
import { MonthPanel } from "./month-panel";
import { OrderTable } from "./parts";
import { RevenueChart } from "./revenue-chart";
import { ShareCard } from "./share-card";

export const PERIODS: { value: Period; param: string; short: string; label: string }[] = [
  { value: "7d", param: "7j", short: "7 jours", label: "7 derniers jours" },
  { value: "30d", param: "30j", short: "30 jours", label: "30 derniers jours" },
  { value: "90d", param: "90j", short: "90 jours", label: "90 derniers jours" },
];

export function periodFromParam(param: unknown): (typeof PERIODS)[number] {
  return PERIODS.find((p) => p.param === param) ?? PERIODS[1];
}

/** Panneau plein de l'accueil (maquette du 16/11/2026) : fond de l'apparence, filet fin, coins larges. */
const PANEL = "vitre flex flex-col rounded-[26px]";

function PeriodNav({ slug, period }: { slug: string; period: (typeof PERIODS)[number] }) {
  return (
    // Le filtre de période est unique et placé au-dessus de ce qu'il change : chiffres, courbe et produits.
    <nav aria-label="Période" className="flex flex-wrap gap-1.5">
      {PERIODS.map((p) => (
        <Link
          key={p.value}
          href={`/app/${slug}?periode=${p.param}`}
          aria-current={p.value === period.value ? "page" : undefined}
          className="flex min-h-[34px] items-center rounded-full border border-trait px-3.5 text-[13px] font-semibold text-texte-2 transition-colors hover:text-texte aria-[current=page]:border-texte aria-[current=page]:bg-texte aria-[current=page]:text-(--fond)"
        >
          {p.short}
        </Link>
      ))}
    </nav>
  );
}

/** « +12,4 % » en vert, « −3 % » en corail, rien si la période précédente était vide. */
function Trend({ kpi, className }: { kpi: Kpi; className?: string }) {
  const change = variation(kpi.value, kpi.previous);
  if (change === null) return null;
  return <span className={cn("text-sm font-semibold tabular-nums", change >= 0 ? "text-hausse" : "text-danger", className)}>{formatVariation(change)}</span>;
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
  const { kpis, revenue_series, previous_series, recent_orders } = summary;

  const header = (
    <header className="col-span-full flex flex-wrap items-center justify-between gap-4 px-1 pt-1.5">
      <div className="flex flex-col gap-1">
        <p className="text-[13px] text-texte-3">{formatToday()}</p>
        <h1 className="large text-[clamp(28px,2.6vw,34px)] leading-tight font-semibold">Accueil</h1>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <ModeToggle />
        <a href={link.url} target="_blank" rel="noopener" className="bouton-contour min-h-11 rounded-full px-[18px] text-sm font-semibold">
          Voir ma boutique
          <span className="sr-only"> (nouvel onglet)</span>
        </a>
        {can("products.write") ? (
          <Link href={`/app/${slug}/produits/nouveau`} className="bouton-clair min-h-11 gap-2 rounded-full px-5 text-sm font-bold">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Ajouter un produit
          </Link>
        ) : null}
      </div>
    </header>
  );

  // Aucune commande, même ancienne : le tableau de bord n'aurait que des zéros.
  if (recent_orders.length === 0) {
    return (
      <>
        {header}
        <EmptyShop slug={slug} canFillDemo={can("shop.manage")} />
      </>
    );
  }

  return (
    <>
      {header}

      {/* Le chiffre d'affaires, et à côté ce qui attend une action. */}
      <section aria-labelledby="titre-ca" className={cn(PANEL, "col-span-full gap-[18px] p-5 md:p-6 lg:col-span-7")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="titre-ca" className="text-[15px] font-medium text-texte-2">
            {v.revenue}
          </h2>
          <PeriodNav slug={slug} period={period} />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-2.5">
          <p className="chiffres text-[clamp(44px,5vw,64px)]">
            {formatNumber(kpis.revenue.value)}
            <span className="ml-2.5 text-[22px] font-normal text-texte-3">FCFA</span>
          </p>
          <Trend kpi={kpis.revenue} />
          <span className="text-[13px] text-texte-3">par rapport aux {period.label.replace(" derniers", "")} d’avant</span>
          {summary.has_demo_data ? (
            <span className="rounded-full border border-dashed border-trait px-2.5 py-1 font-mono text-[12px] text-texte-3" title="Données de démonstration">
              exemple
            </span>
          ) : null}
        </div>
        <div className="rounded-[18px] border border-trait-doux bg-(--surface-2) px-3.5 pt-3.5 pb-2.5">
          <RevenueChart series={revenue_series} previous={previous_series} />
        </div>
        <p className="mt-auto text-xs text-texte-3">Les commandes annulées ne comptent ni dans le chiffre d’affaires ni dans le nombre de commandes.</p>
      </section>
      <TodoPanel summary={summary} slug={slug} allClear={v.allClear} />

      {/* Trois chiffres du jour le jour. */}
      <div className="col-span-full grid gap-2.5 sm:grid-cols-3 md:gap-3 lg:gap-3.5">
        <OrdersStat summary={summary} />
        <section aria-labelledby="titre-panier" className={cn(PANEL, "gap-3.5 rounded-[22px] p-[22px]")}>
          <h2 id="titre-panier" className="text-sm font-medium text-texte-2">
            Panier moyen
          </h2>
          <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="chiffres text-[44px]">{formatNumber(kpis.average_basket.value)}</span>
            <span className="text-base text-texte-3">FCFA</span>
            <Trend kpi={kpis.average_basket} />
          </p>
          <p className="text-[13px] text-texte-3">Un client dépense en moyenne ce montant par commande.</p>
        </section>
        <CustomersStat summary={summary} />
      </div>

      <section aria-labelledby="titre-dernieres" className={cn(PANEL, "col-span-full gap-3 p-[22px] lg:col-span-7")}>
        <div className="flex items-center justify-between gap-3">
          <h2 id="titre-dernieres" className="text-[15px] font-medium text-texte-2">
            Dernières commandes
          </h2>
          <Link href={`/app/${slug}/commandes`} className="text-[13px] font-semibold text-indigo-clair hover:underline">
            Toutes les commandes
          </Link>
        </div>
        <OrderTable orders={recent_orders} slug={slug} />
      </section>
      <BestSellersList products={summary.top_products} slug={slug} canOpen={can("products.view")} title={v.bestSellers} />

      <MonthPanel slug={slug} summary={summary} membership={membership} voice={v} goal={goal} periodChip={period.short.toUpperCase()} />

      <HoursPanel grid={summary.order_hours} />
      <div className={cn("col-span-full", can("shop.manage") ? "lg:col-span-3" : "lg:col-span-6")}>
        <ShareCard url={link.url} display={link.display} title={v.online} hint={v.shareHint} shopName={membership.name} />
      </div>
      {can("shop.manage") ? (
        <div className="col-span-full lg:col-span-3">
          <Suspense fallback={<SecurityCardSkeleton />}>
            <SecurityCard slug={slug} />
          </Suspense>
        </div>
      ) : null}
    </>
  );
}

/* ---------- À traiter maintenant : une phrase et un bouton par tâche ---------- */

type Task = { key: string; text: ReactNode; action: string; href: string; tone?: "alerte"; primary?: boolean };

function TodoPanel({ summary, slug, allClear }: { summary: DashboardSummary; slug: string; allClear: string }) {
  const { pending, confirmed, shipped } = summary.to_process;
  const orders = (count: number) => `${formatNumber(count)} commande${count > 1 ? "s" : ""}`;
  const tasks: Task[] = [];
  if (pending > 0) {
    tasks.push({
      key: "pending",
      text: (
        <>
          <strong className="font-bold text-orange-clair">{orders(pending)}</strong> {pending > 1 ? "attendent" : "attend"} d’être confirmée{pending > 1 ? "s" : ""}
        </>
      ),
      action: "Confirmer",
      href: `/app/${slug}/commandes?statut=pending`,
      primary: true,
    });
  }
  if (confirmed > 0) {
    tasks.push({
      key: "confirmed",
      text: (
        <>
          <strong className="font-bold">{orders(confirmed)}</strong> à préparer et expédier
        </>
      ),
      action: "Préparer",
      href: `/app/${slug}/commandes?statut=confirmed`,
    });
  }
  if (shipped > 0) {
    tasks.push({
      key: "shipped",
      text: (
        <>
          <strong className="font-bold">{orders(shipped)}</strong> en livraison, à marquer livrée{shipped > 1 ? "s" : ""}
        </>
      ),
      action: "Suivre",
      href: `/app/${slug}/commandes?statut=shipped`,
    });
  }
  for (const item of summary.low_stock.items.slice(0, 2)) {
    tasks.push({
      key: `stock-${item.id}`,
      text: (
        <>
          <strong className="font-bold text-alerte">{item.name}</strong> : {item.stock === 0 ? "épuisé" : `plus que ${formatNumber(item.stock)} en stock`}
        </>
      ),
      action: "Réapprovisionner",
      href: `/app/${slug}/produits/${item.id}`,
      tone: "alerte",
    });
  }
  const moreStock = summary.low_stock.count - Math.min(2, summary.low_stock.items.length);

  return (
    <section aria-labelledby="titre-todo" className={cn(PANEL, "col-span-full gap-3.5 p-5 md:p-6 lg:col-span-3")}>
      <h2 id="titre-todo" className="text-[15px] font-medium text-texte-2">
        À traiter maintenant
      </h2>
      {tasks.length === 0 ? (
        <p className="rounded-[18px] border border-trait-doux bg-(--surface-2) p-4 text-[15px] leading-snug">{allClear}</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {tasks.map((task) => (
            <li
              key={task.key}
              className={cn("flex flex-col gap-3 rounded-[18px] border border-trait-doux p-4", task.tone === "alerte" ? "bg-ocre/10" : "bg-(--surface-2)")}
            >
              <p className="text-[15px] leading-snug">{task.text}</p>
              <Link
                href={task.href}
                className={cn(
                  "flex min-h-9 items-center self-start rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                  task.primary ? "bg-texte text-(--fond) hover:bg-texte-2" : "border border-trait hover:border-texte-3",
                )}
              >
                {task.action}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {moreStock > 0 ? (
        <Link href={`/app/${slug}/produits?stock=low`} className="self-start text-[13px] font-semibold text-indigo-clair hover:underline">
          {moreStock} autre{moreStock > 1 ? "s" : ""} produit{moreStock > 1 ? "s" : ""} bientôt en rupture
        </Link>
      ) : null}
    </section>
  );
}

/* ---------- Commandes : le nombre sur la période et les 7 derniers jours en barres ---------- */

function OrdersStat({ summary }: { summary: DashboardSummary }) {
  const last7 = summary.revenue_series.slice(-7);
  const top = Math.max(1, ...last7.map((day) => day.orders));
  const pending = summary.to_process.pending;
  return (
    <section aria-labelledby="titre-cmd" className={cn(PANEL, "gap-3.5 rounded-[22px] p-[22px]")}>
      <h2 id="titre-cmd" className="text-sm font-medium text-texte-2">
        Commandes
      </h2>
      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <p className="flex flex-wrap items-baseline gap-x-2.5">
            <span className="chiffres text-[44px]">{formatNumber(summary.kpis.orders.value)}</span>
            <Trend kpi={summary.kpis.orders} />
          </p>
          <p className="text-[13px] text-texte-3">{pending > 0 ? `${formatNumber(pending)} à confirmer en ce moment` : "Aucune à confirmer"}</p>
        </div>
        {/* Les 7 derniers jours : le dernier en orange. Le détail est dans la courbe, au-dessus. */}
        <span aria-hidden className="flex h-14 items-end gap-[5px]">
          {last7.map((day, index) => (
            <span
              key={day.date}
              className={cn("w-[9px] rounded-[4px]", index === last7.length - 1 ? "bg-orange" : "bg-indigo-clair/35")}
              style={{ height: `${12 + (day.orders / top) * 44}px` }}
            />
          ))}
        </span>
      </div>
    </section>
  );
}

/* ---------- Clients : nouveaux et fidèles sur la période ---------- */

function CustomersStat({ summary }: { summary: DashboardSummary }) {
  const { new: fresh, returning } = summary.customers;
  const total = Math.max(1, fresh + returning);
  const rows = [
    { label: "Nouveaux clients", value: fresh, bar: "bg-indigo-clair/45" },
    { label: "Clients revenus", value: returning, bar: "bg-indigo-clair" },
  ];
  return (
    <section aria-labelledby="titre-clients" className={cn(PANEL, "gap-3 rounded-[22px] p-[22px]")}>
      <h2 id="titre-clients" className="text-sm font-medium text-texte-2">
        Clients
      </h2>
      <p className="flex flex-wrap items-baseline gap-x-2.5">
        <span className="chiffres text-[44px]">{formatNumber(summary.kpis.customers.value)}</span>
        <Trend kpi={summary.kpis.customers} />
      </p>
      {rows.map((row) => (
        <div key={row.label} className="flex flex-col gap-1.5">
          <p className="flex justify-between text-[13px]">
            <span className="text-texte-2">{row.label}</span>
            <span className="font-mono tabular-nums">{formatNumber(row.value)}</span>
          </p>
          <span aria-hidden className="block h-1.5 rounded-full bg-trait-doux">
            <span className={cn("block h-1.5 min-w-1.5 rounded-full", row.bar)} style={{ width: `${(row.value / total) * 100}%` }} />
          </span>
        </div>
      ))}
    </section>
  );
}

/* ---------- Ce qui se vend le mieux : quantités vendues, la première en orange ---------- */

function BestSellersList({ products, slug, canOpen, title }: { products: DashboardSummary["top_products"]; slug: string; canOpen: boolean; title: string }) {
  // L'API classe par chiffre d'affaires ; ici on parle de quantités vendues, donc on reclasse par unités.
  const list = [...products].sort((a, b) => b.units - a.units).slice(0, 5);
  const top = Math.max(1, ...list.map((product) => product.units));
  return (
    <section aria-labelledby="titre-ventes" className={cn(PANEL, "col-span-full gap-4 p-[22px] lg:col-span-3")}>
      <h2 id="titre-ventes" className="text-[15px] font-medium text-texte-2">
        {title}
      </h2>
      {list.length === 0 ? (
        <p className="text-sm text-texte-3">Aucune vente sur la période.</p>
      ) : (
        <ol className="flex flex-col gap-3.5">
          {list.map((product, index) => {
            const name = canOpen ? (
              <Link href={`/app/${slug}/produits/${product.id}`} className="truncate font-semibold hover:underline">
                {product.name}
              </Link>
            ) : (
              <span className="truncate font-semibold">{product.name}</span>
            );
            return (
              <li key={product.id} className="flex items-center gap-3">
                <ProductSwatch name={product.name} imageUrl={product.image_url} className="size-10 shrink-0 rounded-[12px]" />
                <div className="flex min-w-0 grow flex-col gap-2">
                  <p className="flex min-w-0 justify-between gap-3 text-sm">
                    {name}
                    <span className="shrink-0 text-texte-3 tabular-nums">{formatNumber(product.units)} vendus</span>
                  </p>
                  <span aria-hidden className="block h-2 rounded-full bg-trait-doux">
                    <span className={cn("block h-2 rounded-full", index === 0 ? "bg-orange" : "bg-indigo-clair")} style={{ width: `${Math.max(4, (product.units / top) * 100)}%` }} />
                  </span>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </section>
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
      <div aria-hidden className="col-span-full h-[76px]" />
      <div aria-hidden className="vitre col-span-full h-[440px] animate-pulse rounded-[26px] lg:col-span-7" />
      <div aria-hidden className="vitre col-span-full h-[440px] animate-pulse rounded-[26px] lg:col-span-3" />
      <div aria-hidden className="col-span-full grid gap-3.5 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="vitre h-[170px] animate-pulse rounded-[22px]" />
        ))}
      </div>
    </>
  );
}
