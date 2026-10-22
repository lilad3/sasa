"use client";

import { type KeyboardEvent, type PointerEvent, useState } from "react";

import { cn } from "@/lib/cn";
import { compactFcfa, formatDay, formatFcfa, formatNumber } from "@/lib/format";
import type { DayPoint } from "@/lib/types";

import { smoothPath } from "./curve";

type Measure = "revenue" | "orders";

const MEASURES: { value: Measure; label: string }[] = [
  { value: "revenue", label: "Chiffre d’affaires" },
  { value: "orders", label: "Commandes" },
];

const W = 600;
const H = 170;
const TOP = 10;
const BOTTOM = 6;

/** Haut d'échelle « rond » (1, 2 ou 5 × 10ⁿ) : les repères tombent sur des valeurs lisibles. */
function niceMax(value: number) {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((step) => step * power >= value) ?? 10) * power;
}

function formatValue(measure: Measure, value: number) {
  if (measure === "revenue") return formatFcfa(value);
  return `${formatNumber(value)} commande${value > 1 ? "s" : ""}`;
}

function formatTick(measure: Measure, value: number) {
  if (measure === "orders") return formatNumber(value);
  const [number, unit] = compactFcfa(value);
  return `${number}${unit}`;
}

/**
 * Ventes jour par jour, avec la période précédente en filigrane pour comparer.
 * Survol, doigt ou flèches du clavier : le détail du jour s'affiche. Le tableau sous le graphique donne tous les chiffres.
 */
export function RevenueChart({ series, previous }: { series: DayPoint[]; previous: DayPoint[] }) {
  const [measure, setMeasure] = useState<Measure>("revenue");
  const [active, setActive] = useState<number | null>(null);
  if (series.length < 2) return null;

  const last = series.length - 1;
  const values = series.map((point) => point[measure]);
  const before = previous.map((point) => point[measure]);
  const top = niceMax(Math.max(...values, ...before));
  const toY = (value: number) => TOP + (1 - value / top) * (H - TOP - BOTTOM);
  const toX = (index: number) => (index / last) * W;
  const points = values.map((value, i): [number, number] => [toX(i), toY(value)]);
  const previousPoints = before.slice(0, series.length).map((value, i): [number, number] => [toX(i), toY(value)]);
  const line = smoothPath(points);
  const focus = active ?? last;
  const focusRatio = focus / last;

  function pick(event: PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    setActive(Math.round(ratio * last));
  }

  function step(event: KeyboardEvent<HTMLDivElement>) {
    const moves: Record<string, number> = { ArrowLeft: focus - 1, ArrowRight: focus + 1, Home: 0, End: last };
    if (event.key === "Escape") return setActive(null);
    if (!(event.key in moves)) return;
    event.preventDefault();
    setActive(Math.min(last, Math.max(0, moves[event.key])));
  }

  const day = series[focus];
  const previousDay = previous[focus];

  return (
    <figure className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div role="group" aria-label="Mesure affichée" className="flex gap-0.5 rounded-[12px] border border-trait-doux bg-encre/50 p-0.5">
          {MEASURES.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={measure === option.value}
              onClick={() => setMeasure(option.value)}
              className="rounded-[10px] px-2.5 py-1 text-[12px] font-semibold text-texte-3 hover:text-texte aria-pressed:bg-white/12 aria-pressed:text-texte"
            >
              {option.label}
            </button>
          ))}
        </div>
        <ul aria-label="Légende" className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-texte-3">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-orange-clair" />
            Cette période
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className="h-0.5 w-4 rounded-full bg-sable/45" />
            Période précédente
          </li>
        </ul>
      </div>

      <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5">
        {/* Repères de l'échelle : 0, la moitié et le haut. */}
        <div aria-hidden className="relative h-[170px] w-[52px] font-mono text-[10.5px] text-texte-3">
          {[1, 0.5, 0].map((share) => (
            <span key={share} className="absolute right-0 -translate-y-1/2" style={{ top: `${(toY(top * share) / H) * 100}%` }}>
              {formatTick(measure, top * share)}
            </span>
          ))}
        </div>

        <div
          tabIndex={0}
          role="group"
          aria-roledescription="graphique"
          aria-label="Ventes jour par jour. Flèches gauche et droite pour parcourir les jours."
          onPointerMove={pick}
          onPointerDown={pick}
          onPointerLeave={() => setActive(null)}
          onKeyDown={step}
          onFocus={() => setActive((current) => current ?? last)}
          onBlur={() => setActive(null)}
          className="relative h-[170px] touch-pan-y rounded-[6px] outline-offset-4"
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
            <defs>
              <linearGradient id="ca-remplissage" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ff7a1f" stopOpacity="0.26" />
                <stop offset="1" stopColor="#ff7a1f" stopOpacity="0" />
              </linearGradient>
              <filter id="ca-halo" x="-5%" y="-30%" width="110%" height="160%">
                <feGaussianBlur stdDeviation="4" />
              </filter>
              {/* La courbe se dessine de gauche à droite, à l'arrivée et à chaque changement de mesure (la clé relance l'animation). */}
              <clipPath id="ca-trace">
                <rect key={measure} className="courbe-trace" x="-10" y="-20" width={W + 20} height={H + 40} />
              </clipPath>
            </defs>
            {[1, 0.5, 0].map((share) => (
              <line key={share} x1="0" x2={W} y1={toY(top * share)} y2={toY(top * share)} stroke="rgb(240 221 186 / 0.1)" vectorEffect="non-scaling-stroke" />
            ))}
            <path d={smoothPath(previousPoints)} fill="none" stroke="rgb(240 221 186 / 0.45)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            <g clipPath="url(#ca-trace)">
              <path d={`${line} L${W} ${H - BOTTOM} L0 ${H - BOTTOM} Z`} fill="url(#ca-remplissage)" />
              <path d={line} fill="none" stroke="#ff9b52" strokeWidth="6" opacity="0.4" filter="url(#ca-halo)" vectorEffect="non-scaling-stroke" />
              <path d={line} fill="none" stroke="#ff9b52" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </g>
          </svg>

          {/* Repère vertical et points en HTML : dans un SVG étiré, un cercle deviendrait une ellipse. */}
          {active !== null ? <span aria-hidden className="absolute inset-y-0 w-px bg-sable/30" style={{ left: `${focusRatio * 100}%` }} /> : null}
          {active !== null && previousPoints[focus] ? (
            <span
              aria-hidden
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-sable/70 ring-2 ring-nuit-2"
              style={{ left: `${focusRatio * 100}%`, top: `${(previousPoints[focus][1] / H) * 100}%` }}
            />
          ) : null}
          {/* Le point du jour s'allume quand la courbe l'atteint. */}
          <span
            key={measure}
            aria-hidden
            className="courbe-point absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-orange-clair bg-encre ring-2 ring-nuit-2"
            style={{ left: `${focusRatio * 100}%`, top: `${(points[focus][1] / H) * 100}%` }}
          />

          {active !== null ? (
            <div
              // À côté du repère, du côté où il y a le plus de place : la bulle ne cache ni le point ni les boutons.
              className={cn(
                "pointer-events-none absolute top-0 z-10 w-max min-w-[150px] rounded-[12px] border border-trait bg-nuit-2/95 px-3 py-2 text-xs shadow-[0_12px_30px_rgb(0_0_0/0.45)]",
                focusRatio < 0.5 ? "translate-x-3" : "-translate-x-[calc(100%+12px)]",
              )}
              style={{ left: `${focusRatio * 100}%` }}
            >
              <p className="text-texte-3">{formatDay(day.date)}</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] font-semibold text-texte">
                <span aria-hidden className="h-0.5 w-3 rounded-full bg-orange-clair" />
                {formatValue(measure, day[measure])}
              </p>
              {previousDay ? (
                <p className="mt-0.5 flex items-center gap-1.5 text-texte-2">
                  <span aria-hidden className="h-0.5 w-3 rounded-full bg-sable/45" />
                  {formatValue(measure, previousDay[measure])} le {formatDay(previousDay.date)}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <figcaption className="col-start-2 mt-2 flex justify-between font-mono text-[11px] text-texte-3">
          <span>{formatDay(series[0].date)}</span>
          <span>{formatDay(series[last].date)}</span>
        </figcaption>
      </div>

      {/* Annonce du jour parcouru au clavier, pour les lecteurs d'écran. */}
      <p aria-live="polite" className="sr-only">
        {active !== null ? `${formatDay(day.date)} : ${formatValue(measure, day[measure])}.` : ""}
      </p>

      <details className="text-sm">
        <summary className="cursor-pointer text-[12.5px] text-texte-3 hover:text-texte">Voir les chiffres jour par jour</summary>
        <div className="mt-2 max-h-[260px] overflow-y-auto rounded-[14px] border border-trait-doux">
          <table className="w-full text-left text-[13px]">
            <thead className="sticky top-0 bg-nuit-2 text-xs text-texte-3">
              <tr>
                <th scope="col" className="px-3 py-2 font-normal">
                  Jour
                </th>
                <th scope="col" className="px-3 py-2 text-right font-normal">
                  Chiffre d’affaires
                </th>
                <th scope="col" className="px-3 py-2 text-right font-normal">
                  Commandes
                </th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {series.map((point) => (
                <tr key={point.date} className="border-t border-trait-doux">
                  <th scope="row" className="px-3 py-1.5 font-normal text-texte-2">
                    {formatDay(point.date)}
                  </th>
                  <td className="px-3 py-1.5 text-right">{formatFcfa(point.revenue)}</td>
                  <td className="px-3 py-1.5 text-right">{formatNumber(point.orders)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
