import Link from "next/link";

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

// Une couleur par rang : les produits se distinguent sans dépendre du vert.
const SWATCHES = ["bg-indigo", "bg-orange text-encre", "bg-ocre text-encre", "bg-corail", "bg-lagune"];

export function ProductCard({ rank, name, units, revenue, total }: { rank: number; name: string; units: number; revenue: number; total: number }) {
  const [value, unit] = compactFcfa(revenue);
  const share = total > 0 ? Math.round((revenue / total) * 100) : 0;
  return (
    <article className="carte flex min-w-0 flex-col gap-2 rounded-carte p-3.5">
      <div className="flex items-center gap-2.5">
        <span aria-hidden className={cn("grid size-[34px] shrink-0 place-items-center rounded-[10px] text-sm font-bold text-creme", SWATCHES[rank % SWATCHES.length])}>
          {name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="text-[11.5px] text-texte-3">N° {rank + 1} des ventes</span>
      </div>
      <h3 className="line-clamp-2 min-h-[2.6em] text-[14px] leading-snug font-semibold">{name}</h3>
      <span className="text-xs text-texte-3">Chiffre d’affaires</span>
      <TwoTone value={value} unit={unit} className="text-[clamp(24px,2.6vw,32px)]" />
      <span className="text-xs text-texte-2">{formatNumber(units)} vendus</span>
      <div className="mt-auto flex flex-col gap-1.5 pt-2">
        <div className="h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div className="h-full rounded-full bg-orange-clair shadow-[0_0_10px_rgb(255_155_82/0.7)]" style={{ width: `${Math.max(share, 2)}%` }} />
        </div>
        <span className="text-[11.5px] text-texte-3">{share} % du chiffre d’affaires</span>
      </div>
    </article>
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

export function RoleCard({ membership }: { membership: ShopMembership }) {
  const rights = membership.permissions.map((p) => PERMISSION_TEXT[p]).filter(Boolean);
  return (
    <aside
      aria-label="Votre rôle dans la boutique"
      className="relative flex flex-col gap-3 overflow-hidden rounded-[24px] border border-sable/30 bg-[radial-gradient(70%_60%_at_85%_0%,rgb(74_87_214/0.55),transparent_70%),radial-gradient(60%_60%_at_0%_100%,rgb(255_122_31/0.32),transparent_70%),linear-gradient(165deg,rgb(38_30_24/0.94),rgb(16_13_11/0.95))] p-[22px] before:pointer-events-none before:absolute before:inset-0 before:bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.06)_0_1px,transparent_1px_26px)]"
    >
      <div className="relative flex items-center justify-between">
        <span className="large text-base font-extrabold">{membership.name}</span>
        <span className="rounded-full bg-sable/20 px-2.5 py-0.5 text-xs font-semibold text-sable capitalize">plan {membership.plan}</span>
      </div>
      <h2 className="relative mt-3 text-[clamp(20px,2vw,26px)] font-medium tracking-tight">Votre rôle : {ROLE_LABEL[membership.role]}</h2>
      <ul className="relative flex flex-col gap-1.5 text-[13.5px] text-texte-2">
        {rights.map((text) => (
          <li key={text} className="flex gap-2">
            <span aria-hidden className="mt-[7px] size-1.5 shrink-0 rounded-full bg-ocre" />
            Vous pouvez {text}.
          </li>
        ))}
      </ul>
      <p className="relative mt-auto text-xs text-texte-3">Ces droits sont vérifiés par le serveur à chaque action.</p>
    </aside>
  );
}

const STATUS_TONE: Record<OrderStatus, string> = {
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

export function OrderRows({ orders, slug, showAllLink = true }: { orders: Order[]; slug: string; showAllLink?: boolean }) {
  if (orders.length === 0) {
    return <p className="rounded-[16px] border border-dashed border-trait p-4 text-sm text-texte-3">Aucune commande pour l’instant.</p>;
  }
  return (
    <ul className="flex flex-col">
      {orders.map((order) => (
        <li key={order.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 border-b border-trait-doux py-3 last:border-0 md:grid-cols-[110px_1fr_140px_120px_130px]">
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
