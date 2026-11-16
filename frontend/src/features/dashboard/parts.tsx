import Link from "next/link";

import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber, PAYMENT_LABEL, ROLE_LABEL, STATUS_LABEL } from "@/lib/format";
import type { Order, OrderStatus, ShopMembership } from "@/lib/types";

/** Chiffre en deux tons : la valeur en clair, l'unité en retrait. */
export function TwoTone({ value, unit, className }: { value: string; unit?: string; className?: string }) {
  return (
    <p className={cn("chiffres", className)}>
      <span>{value}</span>
      {unit ? <span className="text-texte-3">{unit}</span> : null}
    </p>
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

// Couleurs des états (maquette du 16/11/2026) : ce qui attend le marchand en orange, ce qui roule en indigo,
// ce qui est fini en retrait, l'annulation en corail.
export const STATUS_TONE: Record<OrderStatus, string> = {
  pending: "text-orange-clair",
  confirmed: "text-texte",
  shipped: "text-indigo-clair",
  delivered: "text-texte-3",
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

/** Les dernières commandes en tableau (maquette du 16/11/2026) : la référence ouvre la fiche, toute la ligne est cliquable. */
export function OrderTable({ orders, slug }: { orders: Order[]; slug: string }) {
  return (
    <div className="sans-barre overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-texte-3">
            <th scope="col" className="border-b border-trait-doux px-2 py-2.5 font-medium">
              Commande
            </th>
            <th scope="col" className="border-b border-trait-doux px-2 py-2.5 font-medium">
              Client
            </th>
            <th scope="col" className="border-b border-trait-doux px-2 py-2.5 font-medium">
              Commune
            </th>
            <th scope="col" className="border-b border-trait-doux px-2 py-2.5 font-medium">
              Paiement
            </th>
            <th scope="col" className="border-b border-trait-doux px-2 py-2.5 text-right font-medium">
              Total
            </th>
            <th scope="col" className="border-b border-trait-doux px-2 py-2.5 font-medium">
              État
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((order) => (
            <tr key={order.id} className="relative transition-colors hover:bg-white/[0.04]">
              <td className="border-b border-trait-doux px-2 py-3 font-mono text-[13px] text-texte-2">
                {/* Le lien couvre toute la ligne (after:inset-0) : un seul arrêt au clavier par commande. */}
                <Link href={`/app/${slug}/commandes/${order.id}`} className="after:absolute after:inset-0 hover:text-texte" title={formatDateTime(order.created_at)}>
                  {order.reference}
                </Link>
              </td>
              <td className="border-b border-trait-doux px-2 py-3 font-semibold">{order.customer.name}</td>
              <td className="border-b border-trait-doux px-2 py-3 text-texte-2">{order.customer.commune || order.customer.city}</td>
              <td className="border-b border-trait-doux px-2 py-3 text-texte-2">{PAYMENT_LABEL[order.payment_method]}</td>
              <td className="border-b border-trait-doux px-2 py-3 text-right font-mono tabular-nums">{formatNumber(order.total)}</td>
              <td className="border-b border-trait-doux px-2 py-3">
                <StatusPill status={order.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
