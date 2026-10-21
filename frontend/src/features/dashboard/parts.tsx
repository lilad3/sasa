import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { compactFcfa, formatDateTime, formatFcfa, formatNumber, formatVariation, PAYMENT_LABEL, ROLE_LABEL, STATUS_LABEL, variation } from "@/lib/format";
import type { Kpi, Order, OrderStatus, ShopMembership } from "@/lib/types";

/** Chiffre en deux tons : la valeur en clair, l'unité en retrait. */
export function TwoTone({ value, unit, className }: { value: string; unit?: string; className?: string }) {
  return (
    <p className={cn("chiffres", className)}>
      <span>{value}</span>
      {unit ? <span className="text-texte-3">{unit}</span> : null}
    </p>
  );
}

export function Delta({ kpi }: { kpi: Kpi }) {
  const percent = variation(kpi.value, kpi.previous);
  if (percent === null) return <span className="text-xs text-texte-3">pas de période précédente</span>;
  const up = percent >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-semibold", up ? "text-vert" : "text-danger")}>
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d={up ? "M8 13l4-4 4 4" : "M8 11l4 4 4-4"} />
      </svg>
      {formatVariation(percent)}
      <span className="sr-only">par rapport à la période précédente</span>
    </span>
  );
}

export function StatCard({ label, kpi, money }: { label: string; kpi: Kpi; money?: boolean }) {
  const [value, unit] = money ? [formatNumber(kpi.value), " F"] : [formatNumber(kpi.value), ""];
  return (
    <div className="carte flex flex-col gap-3 rounded-[18px] p-3.5">
      <span className="text-[12.5px] text-texte-2">{label}</span>
      <TwoTone value={value} unit={unit} className="text-[clamp(24px,2.4vw,30px)]" />
      <Delta kpi={kpi} />
    </div>
  );
}

type TopProduct = { id: string; name: string; units: number; revenue: number };

/** Produits phares en liste classée : une ligne par produit, la barre donne sa part du chiffre d'affaires. */
export function TopProducts({ products, total }: { products: TopProduct[]; total: number }) {
  return (
    <ol className="flex flex-col">
      {products.map((product, rank) => {
        const [value, unit] = compactFcfa(product.revenue);
        const share = total > 0 ? Math.round((product.revenue / total) * 100) : 0;
        return (
          <li key={product.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-x-4 gap-y-2 border-b border-trait-doux py-3 first:pt-1 last:border-0 last:pb-1">
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold">{product.name}</span>
              <span className="text-xs text-texte-3">
                N° {rank + 1} · {formatNumber(product.units)} vendu{product.units > 1 ? "s" : ""}
              </span>
            </span>
            <TwoTone value={value} unit={unit} className="text-right text-[22px]" />
            <span className="col-span-full flex items-center gap-2.5">
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <span className="block h-full rounded-full bg-orange-clair shadow-[0_0_10px_rgb(255_155_82/0.7)]" style={{ width: `${Math.max(share, 2)}%` }} />
              </span>
              <span className="w-[11ch] text-right text-[11.5px] text-texte-3 tabular-nums">{share} % du CA</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const PERMISSION_TEXT: Record<string, string> = {
  "dashboard.view": "voir le chiffre d'affaires et les indicateurs",
  "orders.view": "consulter les commandes",
  "orders.manage": "traiter les commandes",
  "products.view": "consulter le catalogue",
  "products.write": "créer et modifier les produits",
  "orders.export": "exporter les ventes",
  "shop.manage": "gérer la boutique, le plan et les clés API",
};

/**
 * Le rôle dans la boutique, en étiquette dans l'en-tête. Elle s'ouvre (sans JavaScript, <details>)
 * sur la liste des droits du rôle.
 */
export function RoleBadge({ membership }: { membership: ShopMembership }) {
  const rights = membership.permissions.map((p) => PERMISSION_TEXT[p]).filter(Boolean);
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-trait bg-encre/50 px-3 py-1 text-[12.5px] font-semibold text-texte-2 hover:text-texte [&::-webkit-details-marker]:hidden">
        {ROLE_LABEL[membership.role]}
        <span className="font-normal text-texte-3 capitalize">· plan {membership.plan}</span>
        <svg viewBox="0 0 24 24" className="size-3.5 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <div className="absolute top-[calc(100%+8px)] left-0 z-20 flex w-[min(320px,80vw)] flex-col gap-2.5 rounded-[18px] border border-trait bg-nuit-2/95 p-4 shadow-[0_18px_40px_rgb(0_0_0/0.5)] backdrop-blur-xl">
        <p className="text-[13px] font-semibold">Ce que votre rôle permet dans {membership.name}</p>
        <ul className="flex flex-col gap-1.5 text-[13px] text-texte-2">
          {rights.map((text) => (
            <li key={text} className="flex gap-2">
              <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ocre" />
              Vous pouvez {text}.
            </li>
          ))}
        </ul>
        <p className="text-xs text-texte-3">Ces droits sont vérifiés par le serveur à chaque action.</p>
      </div>
    </details>
  );
}

export const STATUS_TONE: Record<OrderStatus, string> = {
  pending: "text-alerte",
  confirmed: "text-indigo-clair",
  shipped: "text-texte-2",
  delivered: "text-vert",
  cancelled: "text-danger",
};

export function StatusPill({ status }: { status: OrderStatus }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap", STATUS_TONE[status])}>
      <span aria-hidden className="h-3.5 w-1 rounded-sm bg-current" />
      {STATUS_LABEL[status]}
    </span>
  );
}

type OrderRowsProps = { orders: Order[]; slug: string; showAllLink?: boolean; empty?: ReactNode };

/** Liste de commandes : chaque ligne ouvre la fiche de la commande. */
export function OrderRows({ orders, slug, showAllLink = true, empty = "Aucune commande pour l’instant." }: OrderRowsProps) {
  if (orders.length === 0) {
    return <div className="rounded-[16px] border border-dashed border-trait p-4 text-sm text-texte-3">{empty}</div>;
  }
  return (
    <ul className="flex flex-col">
      {orders.map((order) => (
        <li key={order.id} className="border-b border-trait-doux last:border-0">
          <Link
            href={`/app/${slug}/commandes/${order.id}`}
            className="-mx-2 grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 rounded-xl px-2 py-3 transition-colors hover:bg-white/[0.05] md:grid-cols-[110px_1fr_140px_120px_130px]"
          >
            <span className="font-mono text-[13px]">{order.reference}</span>
            <span className="min-w-0 truncate text-sm">
              {order.customer.name}
              <span className="text-texte-3"> · {order.customer.commune || order.customer.city}</span>
            </span>
            <span className="hidden text-[13px] text-texte-3 md:block">{formatDateTime(order.created_at)}</span>
            <span className="text-right text-sm font-semibold tabular-nums md:text-left">{formatFcfa(order.total)}</span>
            <span className="flex items-center justify-between gap-2 md:justify-start">
              <StatusPill status={order.status} />
              <span className="text-xs text-texte-3 md:hidden">{PAYMENT_LABEL[order.payment_method]}</span>
            </span>
          </Link>
        </li>
      ))}
      {showAllLink ? (
        <li className="pt-3">
          <Link href={`/app/${slug}/commandes`} className="text-sm font-semibold text-sable underline decoration-sable/40 underline-offset-[3px] hover:decoration-sable">
            Voir toutes les commandes
          </Link>
        </li>
      ) : null}
    </ul>
  );
}
