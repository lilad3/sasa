import Link from "next/link";

import { cn } from "@/lib/cn";
import { compactFcfa, formatNumber, PAYMENT_LABEL } from "@/lib/format";
import type { DashboardSummary, OrderStatus, PaymentMethod } from "@/lib/types";

import { STATUS_TONE, TwoTone } from "./parts";

function percent(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/* ---------- À traiter : le travail du jour, toutes dates confondues ---------- */

const TO_PROCESS: { status: "pending" | "confirmed" | "shipped"; label: string; hint: string }[] = [
  { status: "pending", label: "À confirmer", hint: "appelez le client" },
  { status: "confirmed", label: "À expédier", hint: "colis à préparer" },
  { status: "shipped", label: "En livraison", hint: "à marquer livrées" },
];

export function ToProcess({ counts, slug }: { counts: DashboardSummary["to_process"]; slug: string }) {
  const total = counts.pending + counts.confirmed + counts.shipped;
  return (
    <section
      aria-labelledby="titre-a-traiter"
      className="vitre col-span-full grid gap-2 rounded-[24px] p-2.5 sm:grid-cols-3 lg:grid-cols-[minmax(0,0.85fr)_repeat(3,minmax(0,1fr))]"
    >
      <div className="flex flex-col justify-center px-2.5 py-1.5 sm:col-span-3 lg:col-span-1">
        <h2 id="titre-a-traiter" className="text-sm font-semibold">
          À traiter
        </h2>
        <p className="text-[12.5px] text-texte-3">
          {total === 0 ? "Rien en attente. Tout est à jour." : `${formatNumber(total)} commande${total > 1 ? "s attendent" : " attend"} une action`}
        </p>
      </div>
      {TO_PROCESS.map((item) => {
        const count = counts[item.status];
        return (
          <Link
            key={item.status}
            href={`/app/${slug}/commandes?statut=${item.status}`}
            className="carte group flex items-center justify-between gap-3 rounded-[18px] px-3.5 py-3 transition-colors hover:border-trait hover:bg-white/[0.04]"
          >
            <span className="flex flex-col gap-0.5">
              <span className={cn("inline-flex items-center gap-2 text-[13.5px] font-semibold", STATUS_TONE[item.status])}>
                <span aria-hidden className="h-3.5 w-1 rounded-sm bg-current" />
                <span className="text-texte">{item.label}</span>
              </span>
              <span className="pl-3 text-xs text-texte-3">{item.hint}</span>
            </span>
            <span className={cn("chiffres text-[34px]", count === 0 && "text-texte-3")}>{formatNumber(count)}</span>
          </Link>
        );
      })}
    </section>
  );
}

/* ---------- Suivi : où en sont les commandes passées sur la période ---------- */

const STAGES: { status: OrderStatus; label: string }[] = [
  { status: "pending", label: "En attente" },
  { status: "confirmed", label: "Confirmées" },
  { status: "shipped", label: "Expédiées" },
  { status: "delivered", label: "Livrées" },
];

export function StatusesPanel({ statuses, periodLabel }: { statuses: DashboardSummary["statuses"]; periodLabel: string }) {
  const total = Object.values(statuses).reduce((sum, n) => sum + n, 0);
  const delivered = percent(statuses.delivered, total);
  const cancelled = percent(statuses.cancelled, total);

  return (
    <section aria-labelledby="titre-suivi" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-6">
      <h2 id="titre-suivi" className="text-sm text-texte-2">
        Suivi des commandes · {periodLabel}
      </h2>
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <TwoTone value={String(delivered)} unit=" %" className="text-[clamp(36px,4vw,48px)]" />
          <p className="mt-1.5 text-[12.5px] text-texte-2">livrées</p>
        </div>
        <div>
          <TwoTone value={String(cancelled)} unit=" %" className="text-[clamp(26px,2.6vw,32px)]" />
          <p className="mt-1.5 text-[12.5px] text-texte-2">annulées</p>
        </div>
        <p className="ml-auto max-w-[24ch] text-xs text-texte-3">
          Sur les {formatNumber(total)} commandes passées, annulées comprises.
        </p>
      </div>
      <ol aria-label="Commandes par étape" className="mt-auto grid grid-cols-2 gap-2 sm:grid-cols-5">
        {[...STAGES, { status: "cancelled" as const, label: "Annulées" }].map((stage) => (
          <li key={stage.status} className={cn("carte flex flex-col gap-2 rounded-[16px] p-3", stage.status === "cancelled" && "sm:border-danger/20")}>
            <span className={cn("inline-flex items-center gap-1.5 text-xs", STATUS_TONE[stage.status])}>
              <span aria-hidden className="h-3 w-1 rounded-sm bg-current" />
              <span className="text-texte-2">{stage.label}</span>
            </span>
            <span className="chiffres text-[26px]">{formatNumber(statuses[stage.status])}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ---------- Moyens de paiement : une colonne par moyen, dans un ordre fixe ---------- */

// Ordre fixe : chaque moyen garde sa place d'une période à l'autre, quel que soit son classement.
const PAYMENTS: { method: PaymentMethod; short: string; mobile: boolean }[] = [
  { method: "wave", short: "Wave", mobile: true },
  { method: "orange_money", short: "Orange", mobile: true },
  { method: "mtn_momo", short: "MTN", mobile: true },
  { method: "moov_money", short: "Moov", mobile: true },
  { method: "cash_on_delivery", short: "Espèces", mobile: false },
];

export function PaymentsPanel({ payments, revenue }: { payments: DashboardSummary["payment_methods"]; revenue: number }) {
  const byMethod = new Map(payments.map((row) => [row.method, row]));
  const shares = PAYMENTS.map((payment) => ({ ...payment, share: percent(byMethod.get(payment.method)?.revenue ?? 0, revenue), row: byMethod.get(payment.method) }));
  const mobileShare = percent(
    payments.filter((row) => row.method !== "cash_on_delivery").reduce((sum, row) => sum + row.revenue, 0),
    revenue,
  );
  const highest = Math.max(...shares.map((item) => item.share), 1);

  return (
    <section aria-labelledby="titre-paiements" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-4">
      <h2 id="titre-paiements" className="text-sm text-texte-2">
        Moyens de paiement
      </h2>
      <div>
        <TwoTone value={String(mobileShare)} unit=" %" className="text-[clamp(36px,4vw,48px)]" />
        <p className="mt-1.5 text-[12.5px] text-texte-2">du chiffre d’affaires payé par mobile money, le reste en espèces à la livraison</p>
      </div>
      <ul className="mt-auto grid grid-cols-5 items-end gap-2" aria-label="Part du chiffre d’affaires par moyen de paiement">
        {shares.map((item) => (
          <li key={item.method} className="flex flex-col items-center gap-1.5">
            <span className="text-xs font-semibold tabular-nums">{item.share} %</span>
            <span aria-hidden className="flex h-[96px] w-full items-end justify-center">
              <span
                className={cn(
                  "w-full max-w-[24px] rounded-t-[4px]",
                  item.share > 0 ? "bg-indigo shadow-[0_0_14px_rgb(74_87_214/0.55)]" : "bg-white/10",
                )}
                style={{ height: `${Math.max((item.share / highest) * 100, 3)}%` }}
              />
            </span>
            <span className="text-center text-[11.5px] leading-tight text-texte-2" title={PAYMENT_LABEL[item.method]}>
              {item.short}
              <span className="sr-only">
                {" "}
                ({PAYMENT_LABEL[item.method]}, {formatNumber(item.row?.orders ?? 0)} commandes)
              </span>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Où vous vendez : les lieux de livraison qui rapportent le plus ---------- */

export function PlacesPanel({ places, revenue }: { places: DashboardSummary["places"]; revenue: number }) {
  const shown = places.slice(0, 5);
  const rest = places.slice(5);
  const highest = Math.max(...shown.map((place) => place.revenue), 1);

  return (
    <section aria-labelledby="titre-lieux" className="vitre col-span-full flex flex-col gap-3.5 rounded-[24px] p-[18px] lg:col-span-4">
      <h2 id="titre-lieux" className="text-sm text-texte-2">
        Où vous vendez
      </h2>
      {shown.length === 0 ? (
        <p className="text-sm text-texte-3">Aucune livraison sur cette période.</p>
      ) : (
        <ol className="flex flex-col gap-3">
          {shown.map((place) => {
            const [value, unit] = compactFcfa(place.revenue);
            return (
              <li key={`${place.city}-${place.commune}`} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">
                    <span className="font-semibold">{place.commune || place.city}</span>
                    {place.commune ? <span className="text-texte-3"> · {place.city}</span> : null}
                  </span>
                  <span className="shrink-0 text-sm tabular-nums">
                    {value}
                    <span className="text-texte-3">{unit}</span>
                  </span>
                </div>
                <div className="h-1 overflow-hidden rounded-full bg-white/[0.07]" aria-hidden>
                  <div className="h-full rounded-full bg-orange-clair shadow-[0_0_10px_rgb(255_155_82/0.6)]" style={{ width: `${Math.max((place.revenue / highest) * 100, 2)}%` }} />
                </div>
                <span className="text-xs text-texte-3">
                  {formatNumber(place.orders)} commande{place.orders > 1 ? "s" : ""} · {percent(place.revenue, revenue)} % du chiffre d’affaires
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {rest.length > 0 ? (
        <p className="mt-auto border-t border-trait-doux pt-3 text-xs text-texte-3">
          Et {rest.length} autre{rest.length > 1 ? "s" : ""} lieu{rest.length > 1 ? "x" : ""} : {percent(rest.reduce((sum, p) => sum + p.revenue, 0), revenue)} % du chiffre
          d’affaires.
        </p>
      ) : null}
    </section>
  );
}

/* ---------- Quand vos clients commandent : jour × heure ---------- */

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Une seule teinte, de plus en plus lumineuse avec le nombre de commandes. */
function heat(count: number, max: number) {
  if (count === 0) return "rgb(246 240 231 / 0.05)";
  return `rgb(255 122 31 / ${(0.18 + 0.82 * (count / max)).toFixed(2)})`;
}

export function HoursPanel({ grid }: { grid: number[][] }) {
  const max = Math.max(...grid.flat(), 0);
  const dayTotals = grid.map((hours) => hours.reduce((sum, n) => sum + n, 0));
  const busiestDay = dayTotals.indexOf(Math.max(...dayTotals));
  let peak = { day: 0, hour: 0, count: 0 };
  for (const [day, hours] of grid.entries()) {
    for (const [hour, count] of hours.entries()) {
      if (count > peak.count) peak = { day, hour, count };
    }
  }

  return (
    <section aria-labelledby="titre-heures" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="titre-heures" className="text-sm text-texte-2">
            Quand vos clients commandent
          </h2>
          {max > 0 ? (
            <p className="mt-2 text-[15px]">
              Pic le <span className="font-semibold">{DAY_NAMES[peak.day]}</span> entre {peak.hour} h et {peak.hour + 1} h.{" "}
              <span className="text-texte-2">Jour le plus chargé : {DAY_NAMES[busiestDay]}.</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-texte-3">Pas encore assez de commandes sur cette période.</p>
          )}
        </div>
        <p className="text-xs text-texte-3">Publiez vos nouveautés juste avant le pic.</p>
      </div>

      <div aria-hidden className="grid grid-cols-[30px_repeat(24,minmax(0,1fr))] gap-[2px]">
        {grid.map((hours, day) => (
          <div key={DAYS[day]} className="contents">
            <span className="self-center text-[11px] text-texte-3">{DAYS[day]}</span>
            {hours.map((count, hour) => (
              <span
                key={hour}
                title={`${DAY_NAMES[day]}, ${hour} h : ${count} commande${count > 1 ? "s" : ""}`}
                className="aspect-square rounded-[3px]"
                style={{ backgroundColor: heat(count, max) }}
              />
            ))}
          </div>
        ))}
        <span />
        {[0, 6, 12, 18].map((hour) => (
          <span key={hour} className="col-span-6 pt-1 font-mono text-[10.5px] text-texte-3">
            {hour} h
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 text-[11px] text-texte-3" aria-hidden>
        Moins
        {[0, 0.25, 0.5, 0.75, 1].map((share) => (
          <span key={share} className="size-3 rounded-[3px]" style={{ backgroundColor: heat(share === 0 ? 0 : share * 4, 4) }} />
        ))}
        Plus
      </div>
      <p className="sr-only">
        Commandes par jour : {DAY_NAMES.map((name, day) => `${name} ${dayTotals[day]}`).join(", ")}.
      </p>
    </section>
  );
}

/* ---------- Vos clients : fidélité et meilleurs clients ---------- */

export function CustomersPanel({ customers, top }: { customers: DashboardSummary["customers"]; top: DashboardSummary["top_customers"] }) {
  const total = customers.new + customers.returning;
  return (
    <section aria-labelledby="titre-clients" className="vitre col-span-full grid gap-5 rounded-[24px] p-[18px] md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
      <div className="flex flex-col gap-4">
        <h2 id="titre-clients" className="text-sm text-texte-2">
          Vos clients
        </h2>
        <div>
          <TwoTone value={String(percent(customers.returning, total))} unit=" %" className="text-[clamp(36px,4vw,48px)]" />
          <p className="mt-1.5 max-w-[30ch] text-[12.5px] text-texte-2">de vos clients de la période avaient déjà commandé chez vous</p>
        </div>
        <dl className="grid grid-cols-2 gap-2.5">
          <div className="carte rounded-[16px] p-3">
            <dt className="text-xs text-texte-2">Déjà venus</dt>
            <dd className="chiffres mt-2 text-[26px]">{formatNumber(customers.returning)}</dd>
          </div>
          <div className="carte rounded-[16px] p-3">
            <dt className="text-xs text-texte-2">Nouveaux</dt>
            <dd className="chiffres mt-2 text-[26px]">{formatNumber(customers.new)}</dd>
          </div>
        </dl>
        <p className="text-xs text-texte-3">Un client est reconnu à son numéro de téléphone.</p>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-sm text-texte-2">Meilleurs clients</h3>
        {top.length === 0 ? (
          <p className="text-sm text-texte-3">Aucun client sur cette période.</p>
        ) : (
          <ol className="flex flex-col">
            {top.map((customer, index) => {
              const [value, unit] = compactFcfa(customer.revenue);
              return (
                <li key={`${customer.name}-${index}`} className="flex items-center justify-between gap-4 border-b border-trait-doux py-2.5 last:border-0">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{customer.name}</span>
                    <span className="text-xs text-texte-3">
                      {customer.commune || customer.city} · {formatNumber(customer.orders)} commande{customer.orders > 1 ? "s" : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-sm tabular-nums">
                    {value}
                    <span className="text-texte-3">{unit}</span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

/* ---------- Bientôt en rupture : le stock arrivé au seuil choisi pour chaque produit ---------- */

export function LowStockPanel({ lowStock, slug }: { lowStock: DashboardSummary["low_stock"]; slug: string }) {
  if (lowStock.count === 0) return null;
  const more = lowStock.count - lowStock.items.length;
  return (
    <section aria-labelledby="titre-stock" className="vitre col-span-full flex flex-col gap-3 rounded-[24px] px-[18px] py-3.5 lg:flex-row lg:items-center lg:gap-5">
      <div className="shrink-0 lg:w-[170px]">
        <h2 id="titre-stock" className="inline-flex items-center gap-2 text-sm font-semibold">
          <span aria-hidden className="h-3.5 w-1 rounded-sm bg-ocre" />
          Bientôt en rupture
        </h2>
        <p className="text-[12.5px] text-texte-3">
          {lowStock.count} produit{lowStock.count > 1 ? "s" : ""} à réapprovisionner
        </p>
      </div>
      <ul className="flex flex-wrap gap-2">
        {lowStock.items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/app/${slug}/produits/${item.id}`}
              className="carte flex items-baseline gap-2 rounded-[14px] px-3 py-2 text-[13.5px] transition-colors hover:border-trait hover:bg-white/[0.05]"
            >
              <span className="font-semibold">{item.name}</span>
              <span className={cn("tabular-nums", item.stock === 0 ? "text-danger-clair" : "text-ocre")}>
                {item.stock === 0 ? "épuisé" : `${formatNumber(item.stock)} restant${item.stock > 1 ? "s" : ""}`}
              </span>
              <span className="text-xs text-texte-3">seuil {formatNumber(item.threshold)}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        href={`/app/${slug}/produits?stock=low`}
        className="shrink-0 text-[13px] font-semibold text-sable underline decoration-sable/40 underline-offset-[3px] hover:decoration-sable lg:ml-auto"
      >
        {more > 0 ? `Voir les ${lowStock.count}` : "Voir le stock"}
      </Link>
    </section>
  );
}
