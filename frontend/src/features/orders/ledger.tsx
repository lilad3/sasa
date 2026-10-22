import Link from "next/link";
import type { ReactNode } from "react";

import { StatusPill } from "@/features/dashboard/parts";
import { formatFcfa, formatNumber, formatToday } from "@/lib/format";
import type { Order } from "@/lib/types";

// Le jour et l'heure se lisent à Abidjan, comme les autres dates de l'espace marchand.
const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Abidjan" });
const hourMinute = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", hour: "2-digit", minute: "2-digit" });

type Day = { key: string; label: string; orders: Order[] };

/** Les commandes arrivent de la plus récente à la plus ancienne : un jour commence quand la date change. */
function groupByDay(orders: Order[]): Day[] {
  const now = new Date();
  const today = dayKey.format(now);
  const yesterday = dayKey.format(new Date(now.getTime() - 86_400_000));
  const days: Day[] = [];
  for (const order of orders) {
    const date = new Date(order.created_at);
    const key = dayKey.format(date);
    const current = days.at(-1);
    if (current?.key === key) {
      current.orders.push(order);
      continue;
    }
    const label = key === today ? "Aujourd’hui" : key === yesterday ? "Hier" : formatToday(date);
    days.push({ key, label, orders: [order] });
  }
  return days;
}

function plural(count: number, word: string) {
  return `${formatNumber(count)} ${word}${count > 1 ? "s" : ""}`;
}

/** Ce que pèse le jour : les annulées comptent dans le nombre de lignes, pas dans le total (comme le chiffre d'affaires). */
function daySummary(day: Day, partial: boolean) {
  const live = day.orders.filter((order) => order.status !== "cancelled");
  const cancelled = day.orders.length - live.length;
  if (live.length === 0) return `${plural(cancelled, "commande")} ${cancelled > 1 ? "annulées" : "annulée"}`;
  const total = formatFcfa(live.reduce((sum, order) => sum + order.total, 0));
  const count = `${plural(day.orders.length, "commande")}${cancelled > 0 ? ` dont ${formatNumber(cancelled)} ${cancelled > 1 ? "annulées" : "annulée"}` : ""}`;
  return (
    <>
      {count} · <span className="font-semibold text-texte-2">{total}</span>
      {partial ? " sur cette page" : ""}
    </>
  );
}

type OrderLedgerProps = {
  orders: Order[];
  slug: string;
  /** La page précédente ou suivante peut tenir une partie du premier ou du dernier jour : son total est alors partiel. */
  continuesBefore: boolean;
  continuesAfter: boolean;
  empty: ReactNode;
};

/**
 * Registre des commandes, regroupées par jour (Aujourd'hui, Hier, puis la date) avec le total de chaque jour.
 * Chaque ligne ouvre la fiche de la commande. Sur téléphone : le client et le montant d'abord, la référence et l'heure dessous.
 */
export function OrderLedger({ orders, slug, continuesBefore, continuesAfter, empty }: OrderLedgerProps) {
  if (orders.length === 0) {
    return <div className="rounded-[16px] border border-dashed border-trait p-4 text-sm text-texte-3">{empty}</div>;
  }
  const days = groupByDay(orders);

  return (
    <div className="flex flex-col gap-2">
      {days.map((day, index) => (
        <section key={day.key} aria-labelledby={`jour-${day.key}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 border-b border-trait pt-2 pb-2">
            <h2 id={`jour-${day.key}`} className="text-[15px] font-semibold">
              {day.label}
            </h2>
            <p className="text-[12.5px] text-texte-3 tabular-nums">
              {daySummary(day, (index === 0 && continuesBefore) || (index === days.length - 1 && continuesAfter))}
            </p>
          </div>
          <ul className="flex flex-col">
            {day.orders.map((order) => (
              <li key={order.id} className="border-b border-trait-doux last:border-0">
                <Link
                  href={`/app/${slug}/commandes/${order.id}`}
                  className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.05] md:grid-cols-[52px_100px_minmax(0,1fr)_120px_130px]"
                >
                  <span className="min-w-0 truncate text-sm md:order-3">
                    {order.customer.name}
                    <span className="text-texte-3"> · {order.customer.commune || order.customer.city}</span>
                  </span>
                  <span className="text-right text-sm font-semibold tabular-nums md:order-4 md:text-left">{formatFcfa(order.total)}</span>
                  {/* Référence et heure : une ligne sous le client sur téléphone, deux colonnes sur ordinateur. */}
                  <span className="flex gap-2 font-mono text-[12.5px] text-texte-3 md:contents">
                    <time dateTime={order.created_at} className="md:order-1 md:text-[13px]">
                      {hourMinute.format(new Date(order.created_at))}
                    </time>
                    <span className="text-texte-2 md:order-2 md:text-[13px] md:text-texte">{order.reference}</span>
                  </span>
                  <span className="justify-self-end md:order-5 md:justify-self-start">
                    <StatusPill status={order.status} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
