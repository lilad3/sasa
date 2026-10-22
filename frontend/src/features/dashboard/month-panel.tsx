import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { compactFcfa, formatNumber, formatVariation, PAYMENT_LABEL, variation } from "@/lib/format";
import type { ApiResult } from "@/lib/server/api";
import type { DashboardSummary, Goal, Kpi, ShopMembership } from "@/lib/types";
import { ofMonth, type Voice } from "@/lib/voice";

import { GoalGauge } from "./goal-gauge";
import { LiveStamp, RefreshButton } from "./live";
import { type MonthTab, MonthTabs } from "./month-tabs";
import { RoleBadge, TwoTone } from "./parts";

function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** Petite carte de stat des onglets : un libellé, la période en pastille, un grand chiffre, une ligne d'explication. */
function Tile({ label, chip, children, foot }: { label: string; chip: string; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="carte flex min-h-[150px] flex-col gap-3 rounded-[20px] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[14px] text-texte-2">{label}</span>
        <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[11.5px] font-semibold text-texte-3">{chip}</span>
      </div>
      {children}
      {foot ? <p className="mt-auto text-[12.5px] text-texte-3">{foot}</p> : null}
    </div>
  );
}

function versus(kpi: Kpi) {
  const change = variation(kpi.value, kpi.previous);
  return change === null ? "pas de période précédente" : `${formatVariation(change)} vs période précédente`;
}

/** Une ligne « libellé · % » avec sa barre, pour les répartitions. */
function ShareBar({ label, share, tone = "orange" }: { label: string; share: number; tone?: "orange" | "indigo" }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-[13.5px]">
        <span>{label}</span>
        <span className="font-semibold tabular-nums">{share} %</span>
      </div>
      <div className="relative h-1 rounded-full bg-white/10" aria-hidden>
        <div className={cn("barre-pousse h-full rounded-full", tone === "orange" ? "bg-orange-clair" : "bg-indigo-clair")} style={{ width: `${Math.max(share, 2)}%` }} />
        <span
          className={cn("barre-pousse-point absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-encre", tone === "orange" ? "border-orange-clair" : "border-indigo-clair")}
          style={{ left: `${Math.max(share, 2)}%` }}
        />
      </div>
    </div>
  );
}

function grid(children: ReactNode) {
  return <div className="cascade grid gap-2.5 sm:grid-cols-2 md:gap-3 xl:grid-cols-4">{children}</div>;
}

function buildTabs(summary: DashboardSummary, chip: string, slug: string, canSeeCustomers: boolean): MonthTab[] {
  const { kpis, statuses, payment_methods, places, customers, top_customers } = summary;
  const placed = Object.values(statuses).reduce((sum, n) => sum + n, 0);
  const mobileRevenue = payment_methods.filter((row) => row.method !== "cash_on_delivery").reduce((sum, row) => sum + row.revenue, 0);
  const cashShare = percent(kpis.revenue.value - mobileRevenue, kpis.revenue.value);
  const totalCustomers = customers.new + customers.returning;
  const best = top_customers[0];
  const payments = [...payment_methods].sort((a, b) => b.revenue - a.revenue).slice(0, 4);
  const topPlaces = places.slice(0, 4);
  const highestPlace = Math.max(...topPlaces.map((place) => place.revenue), 1);

  return [
    {
      id: "commandes",
      label: "Commandes",
      hint: "Volume et panier",
      content: grid(
        <>
          <Tile label="Commandes" chip={chip} foot={versus(kpis.orders)}>
            <TwoTone value={formatNumber(kpis.orders.value)} className="text-[clamp(32px,3vw,44px)]" />
          </Tile>
          <Tile label="Panier moyen" chip={chip} foot={versus(kpis.average_basket)}>
            <TwoTone value={formatNumber(kpis.average_basket.value)} unit=" F" className="text-[clamp(32px,3vw,44px)]" />
          </Tile>
          <Tile label="Livrées" chip={chip} foot={`sur ${formatNumber(placed)} commandes passées`}>
            <TwoTone value={String(percent(statuses.delivered, placed))} unit=" %" className="text-[clamp(32px,3vw,44px)]" />
          </Tile>
          <Tile label="Paiement" chip={chip}>
            <div className="mt-1 flex flex-col gap-3.5">
              <ShareBar label="À la livraison" share={cashShare} />
              <ShareBar label="Mobile Money" share={100 - cashShare} tone="indigo" />
            </div>
          </Tile>
        </>,
      ),
    },
    {
      id: "clients",
      label: "Clients",
      hint: "Nouveaux et fidèles",
      content: grid(
        <>
          <Tile label="Clients" chip={chip} foot={versus(kpis.customers)}>
            <TwoTone value={formatNumber(kpis.customers.value)} className="text-[clamp(32px,3vw,44px)]" />
          </Tile>
          <Tile label="Nouveaux" chip={chip} foot="leur toute première commande">
            <TwoTone value={formatNumber(customers.new)} className="text-[clamp(32px,3vw,44px)]" />
          </Tile>
          <Tile label="Déjà venus" chip={chip} foot={`${percent(customers.returning, totalCustomers)} % des clients de la période`}>
            <TwoTone value={formatNumber(customers.returning)} className="text-[clamp(32px,3vw,44px)]" />
          </Tile>
          <Tile
            label="Meilleur client"
            chip={chip}
            foot={
              canSeeCustomers ? (
                <Link href={`/app/${slug}/clients`} className="font-semibold text-sable underline decoration-sable/40 underline-offset-[3px] hover:decoration-sable">
                  Voir tous les clients
                </Link>
              ) : best ? (
                `${formatNumber(best.orders)} commande${best.orders > 1 ? "s" : ""}`
              ) : undefined
            }
          >
            {best ? (
              <div>
                <p className="truncate text-[16px] font-semibold">{best.name}</p>
                <TwoTone value={compactFcfa(best.revenue)[0]} unit={compactFcfa(best.revenue)[1]} className="mt-1.5 text-[28px]" />
              </div>
            ) : (
              <p className="text-sm text-texte-3">Aucun client sur la période.</p>
            )}
          </Tile>
        </>,
      ),
    },
    {
      id: "paiements",
      label: "Paiements",
      hint: "Comment vos clients paient",
      content: grid(
        payments.length === 0 ? (
          <p className="text-sm text-texte-3">Aucun paiement sur la période.</p>
        ) : (
          payments.map((row) => (
            <Tile key={row.method} label={PAYMENT_LABEL[row.method]} chip={chip} foot={`${formatNumber(row.orders)} commande${row.orders > 1 ? "s" : ""}`}>
              <TwoTone value={String(percent(row.revenue, kpis.revenue.value))} unit=" %" className="text-[clamp(32px,3vw,44px)]" />
              <div className="h-1 rounded-full bg-white/10" aria-hidden>
                <div className={cn("barre-pousse h-full rounded-full", row.method === "cash_on_delivery" ? "bg-orange-clair" : "bg-indigo-clair")} style={{ width: `${Math.max(percent(row.revenue, kpis.revenue.value), 2)}%` }} />
              </div>
            </Tile>
          ))
        ),
      ),
    },
    {
      id: "communes",
      label: "Communes",
      hint: "Où vous livrez",
      content: grid(
        topPlaces.length === 0 ? (
          <p className="text-sm text-texte-3">Aucune livraison sur la période.</p>
        ) : (
          topPlaces.map((place) => {
            const [value, unit] = compactFcfa(place.revenue);
            return (
              <Tile
                key={`${place.city}-${place.commune}`}
                label={place.commune || place.city}
                chip={chip}
                foot={`${formatNumber(place.orders)} commande${place.orders > 1 ? "s" : ""}${place.commune ? ` · ${place.city}` : ""}`}
              >
                <TwoTone value={value} unit={unit} className="text-[clamp(30px,2.8vw,40px)]" />
                <div className="h-1 rounded-full bg-white/10" aria-hidden>
                  <div className="barre-pousse h-full rounded-full bg-orange-clair" style={{ width: `${Math.max((place.revenue / highestPlace) * 100, 2)}%` }} />
                </div>
              </Tile>
            );
          })
        ),
      ),
    },
  ];
}

type MonthPanelProps = {
  slug: string;
  summary: DashboardSummary;
  membership: ShopMembership;
  voice: Voice;
  goal: ApiResult<Goal>;
  periodChip: string;
};

/**
 * Le grand panneau « Vos ventes d'octobre » : le CA du mois et l'objectif côte à côte, puis les onglets.
 * Les chiffres se mettent à jour seuls (LiveStamp) ; le bouton rond force la mise à jour.
 */
export function MonthPanel({ slug, summary, membership, voice, goal, periodChip }: MonthPanelProps) {
  const can = (permission: string) => membership.permissions.includes(permission);
  const month = summary.month;
  const monthRevenue = month?.revenue ?? summary.kpis.revenue.value;
  const monthChange = month ? variation(month.revenue, month.previous_revenue) : null;
  const label = month?.label ?? new Intl.DateTimeFormat("fr-FR", { month: "long", timeZone: "Africa/Abidjan" }).format(new Date());
  // Objectif proposé : le rythme du mois prolongé jusqu'au dernier jour, plus 10 %.
  const dayOfMonth = Number(new Intl.DateTimeFormat("en-CA", { day: "numeric", timeZone: "Africa/Abidjan" }).format(new Date()));
  const daysInMonth = dayOfMonth + (goal.ok ? Math.max(goal.data.days_left, 0) : 0);
  const projected = (monthRevenue / Math.max(dayOfMonth, 1)) * daysInMonth;
  const suggestion = Math.max(500_000, Math.round((projected * 1.1) / 50_000) * 50_000);

  return (
    <section aria-labelledby="titre-mois" className="vitre col-span-full flex flex-col gap-5 rounded-[30px] p-4 md:p-6">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 id="titre-mois" className="text-[clamp(17px,1.6vw,20px)] font-medium text-texte-2">
          {voice.monthSales(label)}
        </h2>
        <div className="flex gap-2">
          <RefreshButton />
          {can("orders.export") ? (
            <Link href={`/app/${slug}/commandes?export=1`} aria-label="Exporter les ventes" className="bouton-rond grid size-11 place-items-center rounded-full">
              <svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
              </svg>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="carte-panneau grid gap-4 rounded-[26px] p-4 md:p-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-4 p-1 md:p-2">
          {summary.generated_at ? (
            <div>
              <LiveStamp generatedAt={summary.generated_at} />
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
            <p className="large text-[clamp(28px,3vw,40px)] leading-tight font-bold">{membership.name}</p>
            <RoleBadge membership={membership} />
            {summary.has_demo_data ? (
              <span className="rounded-full border border-dashed border-white/25 px-2.5 py-0.5 font-mono text-[12px] text-texte-3" title="Données de démonstration">
                exemple
              </span>
            ) : null}
          </div>
          <div>
            <p className="text-[14px] text-texte-2">{month ? voice.monthRevenue : `${voice.revenue} · ${periodChip.toLowerCase()}`}</p>
            <TwoTone value={formatNumber(monthRevenue)} unit=" F" className="mt-2 text-[clamp(48px,7vw,96px)]" />
            {monthChange !== null ? (
              <p className={cn("mt-2 text-[13.5px] font-semibold", monthChange >= 0 ? "text-orange-clair" : "text-danger")}>
                {formatVariation(monthChange)}
                <span className="font-normal text-texte-3"> par rapport au même moment le mois dernier</span>
              </p>
            ) : null}
          </div>
          <div className="mt-auto flex flex-wrap gap-2.5 pt-1">
            <Link href={`/app/${slug}/commandes`} className="bouton-clair rounded-full px-6 py-3.5 text-[15px] font-bold">
              Voir les commandes
            </Link>
            {can("orders.export") ? (
              <Link href={`/app/${slug}/commandes?export=1`} className="bouton-contour rounded-full px-6 py-3.5 text-[15px] font-bold">
                Exporter
              </Link>
            ) : null}
          </div>
        </div>

        {goal.ok ? (
          <GoalGauge
            slug={slug}
            goal={goal.data}
            canEdit={can("goals.manage")}
            title={`Objectif ${ofMonth(goal.data.label)}`}
            setBy={goal.data.goal ? voice.goalSetBy(goal.data.goal) : null}
            revenue={goal.data.goal?.revenue ?? monthRevenue}
            suggestion={suggestion}
          />
        ) : (
          <div className="carte-objectif flex flex-col justify-center gap-2 rounded-[24px] p-5">
            <h3 className="text-lg font-medium">Objectif du mois</h3>
            <p className="text-sm text-texte-3">L’objectif n’a pas pu être chargé. Actualisez dans un instant.</p>
          </div>
        )}
      </div>

      <MonthTabs tabs={buildTabs(summary, periodChip, slug, can("customers.view"))} />
    </section>
  );
}
