import Link from "next/link";

import { TwoTone } from "@/features/dashboard/parts";
import { smoothPath } from "@/features/dashboard/curve";
import { cn } from "@/lib/cn";
import { compactFcfa, formatNumber, formatSince } from "@/lib/format";
import type { CustomerFlag, CustomerRow } from "@/lib/types";

const FLAG: Record<CustomerFlag, { label: string; className: string }> = {
  new: { label: "Nouveau", className: "bg-indigo/25 text-indigo-clair" },
  win_back: { label: "À relancer", className: "bg-ocre/15 text-ocre" },
  at_risk: { label: "À risque", className: "bg-corail/20 text-danger-clair" },
};

/** Les étiquettes d'un client : fidèle (et comment), puis ses signaux. */
export function CustomerTags({ customer }: { customer: Pick<CustomerRow, "loyal" | "vip" | "flags"> }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {customer.loyal ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-orange/15 px-2 py-0.5 text-[11.5px] font-semibold text-orange-clair" title={customer.vip ? "Nommé fidèle à la main" : undefined}>
          <svg viewBox="0 0 24 24" className="size-3" fill="currentColor" aria-hidden>
            <path d="M12 4l2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 15.8l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z" />
          </svg>
          {customer.vip ? "Fidèle (nommé)" : "Fidèle"}
        </span>
      ) : null}
      {customer.flags.map((flag) => (
        <span key={flag} className={cn("rounded-full px-2 py-0.5 text-[11.5px] font-semibold", FLAG[flag].className)}>
          {FLAG[flag].label}
        </span>
      ))}
    </span>
  );
}

/** Fiabilité : la part des commandes terminées qui ont vraiment été livrées. */
export function Reliability({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-texte-3">aucune terminée</span>;
  const tone = value >= 80 ? "bg-orange-clair" : value >= 50 ? "bg-ocre" : "bg-corail";
  return (
    <span className="flex items-center gap-2" title="Part des commandes terminées qui ont été livrées">
      <span className="h-1 w-14 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <span className={cn("barre-pousse block h-full rounded-full", tone)} style={{ width: `${Math.max(value, 3)}%` }} />
      </span>
      <span className="text-[12.5px] tabular-nums">{Math.round(value)} %</span>
    </span>
  );
}

/** Ce qu'un fidèle a dépensé chaque mois, sur 6 mois : une petite courbe. */
function MonthlyCurve({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const W = 200;
  const H = 46;
  const top = Math.max(...values, 1);
  const points = values.map((value, i): [number, number] => [(i / (values.length - 1)) * W, H - 6 - (value / top) * (H - 14)]);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[46px] w-full overflow-visible" aria-hidden>
      <path d={smoothPath(points)} fill="none" stroke="#ff9b52" strokeWidth="2" vectorEffect="non-scaling-stroke" className="trait-dessine" />
    </svg>
  );
}

/** Carte d'un client fidèle, dans la section du haut de la page Clients. */
export function LoyalCard({ customer, slug }: { customer: CustomerRow & { monthly: number[] }; slug: string }) {
  const [value, unit] = compactFcfa(customer.spent);
  const silent = customer.flags.includes("win_back");
  return (
    <li className="carte-produit group/fidele flex flex-col gap-2 rounded-[22px] p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold">{customer.name}</span>
          <span className="text-[12.5px] text-texte-3">{customer.commune || customer.city || "Sans livraison"}</span>
        </span>
        <Link
          href={`/app/${slug}/clients/${customer.id}`}
          aria-label={`Ouvrir la fiche de ${customer.name}`}
          className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 text-texte-2 transition-[transform,color] duration-300 group-hover/fidele:rotate-45 hover:text-texte"
        >
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7 17L17 7M9 7h8v8" />
          </svg>
        </Link>
      </div>
      <TwoTone value={value} unit={unit} className="mt-1 text-[30px]" />
      <p className="text-[12.5px] text-texte-2">
        {formatNumber(customer.orders)} commande{customer.orders > 1 ? "s" : ""}
        {customer.last_order_at ? ` · dernière ${formatSince(customer.last_order_at)}` : ""}
      </p>
      {silent ? <p className="text-xs font-semibold text-ocre">Silencieux depuis un moment : un petit mot ?</p> : null}
      <div className="mt-auto pt-1">
        <MonthlyCurve values={customer.monthly} />
      </div>
    </li>
  );
}
