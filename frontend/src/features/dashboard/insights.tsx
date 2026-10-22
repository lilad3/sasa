import Link from "next/link";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { DashboardSummary } from "@/lib/types";

import { STATUS_TONE } from "./parts";

/* ---------- Le comptoir : le travail du jour (commandes ouvertes, toutes dates confondues, et stock au seuil) ---------- */

const TO_PROCESS: { status: "pending" | "confirmed" | "shipped"; label: string; hint: string }[] = [
  { status: "pending", label: "À confirmer", hint: "appelez le client" },
  { status: "confirmed", label: "À expédier", hint: "colis à préparer" },
  { status: "shipped", label: "En livraison", hint: "à marquer livrées" },
];

/**
 * Colonne « À faire », à droite des chiffres sur ordinateur, et collée à l'écran : le travail reste à portée
 * pendant qu'on parcourt les analyses. Sur téléphone et tablette, elle passe en tête de page.
 */
type ComptoirProps = {
  counts: DashboardSummary["to_process"];
  lowStock: DashboardSummary["low_stock"];
  slug: string;
  /** Le texte quand rien n'attend, écrit pour la personne qui le lit (lib/voice). */
  allClear?: string;
};

export function Comptoir({ counts, lowStock, slug, allClear = "Rien en attente. Tout est à jour." }: ComptoirProps) {
  const total = counts.pending + counts.confirmed + counts.shipped;
  const more = lowStock.count - lowStock.items.length;
  return (
    <aside
      aria-label="À faire"
      className="vitre flex flex-col gap-3 rounded-[24px] p-2.5"
    >
      <section aria-labelledby="titre-a-traiter" className="flex flex-col gap-2">
        <div className="px-2 pt-1.5">
          <h2 id="titre-a-traiter" className="text-sm font-semibold">
            À traiter
          </h2>
          <p className="text-[12.5px] text-texte-3">
            {total === 0 ? allClear : `${formatNumber(total)} commande${total > 1 ? "s attendent" : " attend"} une action`}
          </p>
        </div>
        <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
          {TO_PROCESS.map((item) => {
            const count = counts[item.status];
            return (
              <li key={item.status}>
                <Link
                  href={`/app/${slug}/commandes?statut=${item.status}`}
                  className="carte flex items-center justify-between gap-3 rounded-[18px] px-3.5 py-3 transition-colors hover:border-trait hover:bg-white/[0.04]"
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
              </li>
            );
          })}
        </ul>
      </section>

      {lowStock.count > 0 ? (
        <section aria-labelledby="titre-stock" className="flex flex-col gap-2 border-t border-trait-doux px-1 pt-3">
          <div className="px-1">
            <h2 id="titre-stock" className="inline-flex items-center gap-2 text-sm font-semibold">
              <span aria-hidden className="h-3.5 w-1 rounded-sm bg-ocre" />
              Bientôt en rupture
            </h2>
            <p className="text-[12.5px] text-texte-3">
              {lowStock.count} produit{lowStock.count > 1 ? "s" : ""} à réapprovisionner
            </p>
          </div>
          <ul className="flex flex-col gap-1.5">
            {lowStock.items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/app/${slug}/produits/${item.id}`}
                  className="carte flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5 rounded-[14px] px-3 py-2 text-[13.5px] transition-colors hover:border-trait hover:bg-white/[0.05]"
                >
                  <span className="min-w-0 font-semibold">{item.name}</span>
                  <span className="flex items-baseline gap-2">
                    <span className={cn("tabular-nums", item.stock === 0 ? "text-danger-clair" : "text-ocre")}>
                      {item.stock === 0 ? "épuisé" : `${formatNumber(item.stock)} restant${item.stock > 1 ? "s" : ""}`}
                    </span>
                    <span className="text-xs text-texte-3">seuil {formatNumber(item.threshold)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <Link
            href={`/app/${slug}/produits?stock=low`}
            className="self-start px-1 pb-1 text-[13px] font-semibold text-sable underline decoration-sable/40 underline-offset-[3px] hover:decoration-sable"
          >
            {more > 0 ? `Voir les ${lowStock.count}` : "Voir le stock"}
          </Link>
        </section>
      ) : null}
    </aside>
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
    <section aria-labelledby="titre-heures" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-4">
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
