import Link from "next/link";
import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";
import { compactFcfa, formatNumber, formatVariation, variation } from "@/lib/format";
import type { TopProduct } from "@/lib/types";

import { smoothPath } from "./curve";
import { TwoTone } from "./parts";

const W = 260;
const H = 96;

/**
 * Vignette d'un produit sans photo : un motif de pagne tiré du nom, toujours le même pour un produit.
 * Les couleurs viennent d'une liste fermée : aucun texte saisi n'atterrit dans le CSS.
 */
const PATTERNS: ((a: string, b: string) => string)[] = [
  (a, b) => `repeating-linear-gradient(90deg, ${a} 0 6px, ${b} 6px 10px, #17110a 10px 13px)`,
  (a, b) => `radial-gradient(circle at 50% 50%, ${a} 0 3px, transparent 3.5px) 0 0 / 11px 11px, ${b}`,
  (a, b) => `repeating-linear-gradient(45deg, ${a} 0 4px, ${b} 4px 8px)`,
  (a, b) => `conic-gradient(${a} 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0) 0 0 / 14px 14px`,
  (a, b) => `repeating-linear-gradient(0deg, ${a} 0 5px, ${b} 5px 9px, #faf4ea 9px 11px)`,
];
const PAIRS = [
  ["#ff7a1f", "#4a57d6"],
  ["#f2b33d", "#2e8c7a"],
  ["#e8553f", "#f0ddba"],
  ["#4a57d6", "#f2b33d"],
  ["#2e8c7a", "#ff9b52"],
];

function hash(text: string) {
  let h = 0;
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function ProductSwatch({ name, imageUrl, className }: { name: string; imageUrl?: string | null; className?: string }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- images des marchands, hôtes non connus d'avance
    return <img src={imageUrl} alt="" className={cn("object-cover", className)} />;
  }
  const h = hash(name);
  const [a, b] = PAIRS[h % PAIRS.length];
  return <span aria-hidden className={cn("block", className)} style={{ background: PATTERNS[(h >> 3) % PATTERNS.length](a, b) }} />;
}

/** Montant signé et court pour la bulle : « +124 k F », « −24 500 F ». */
function signedCompact(value: number) {
  const [number, unit] = compactFcfa(Math.abs(value));
  return `${value >= 0 ? "+" : "−"}${number}${unit}`;
}

/**
 * Un produit ne se vend pas tous les jours : la courbe brute serait une suite de pics.
 * Moyenne glissante sur un sixième de la période (5 jours sur 30) : on lit la tendance.
 */
function smoothed(values: number[]) {
  const window = Math.max(1, Math.round(values.length / 6));
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((sum, n) => sum + n, 0) / slice.length;
  });
}

function Sparkline({ product, index }: { product: TopProduct; index: number }) {
  const series = smoothed(product.series ?? []);
  if (series.length < 2) return null;
  const top = Math.max(...series, 1);
  const last = series.length - 1;
  const toY = (value: number) => H - 10 - (value / top) * (H - 34);
  const points = series.map((value, i): [number, number] => [(i / last) * W, toY(value)]);
  const line = smoothPath(points);
  // Ligne pointillée : la moyenne par jour de la période précédente, pour situer la courbe.
  const previousAverage = product.previous_revenue !== undefined ? product.previous_revenue / series.length : null;
  const diff = product.previous_revenue !== undefined ? product.revenue - product.previous_revenue : null;
  const up = diff === null || diff >= 0;
  const color = up ? "#ff9b52" : "#e8553f";
  const id = `courbe-${product.id}`;
  const end = points[last];

  return (
    <div className="relative mt-auto h-[96px]" style={{ "--delai": `${0.25 + index * 0.15}s` } as CSSProperties}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id={`${id}-aire`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
          <filter id={`${id}-halo`} x="-5%" y="-40%" width="110%" height="180%">
            <feGaussianBlur stdDeviation="3.5" />
          </filter>
          <clipPath id={`${id}-trace`}>
            <rect className="courbe-trace courbe-trace-carte" x="-6" y="-20" width={W + 12} height={H + 40} />
          </clipPath>
        </defs>
        {previousAverage !== null ? (
          <line x1="0" x2={W} y1={toY(previousAverage)} y2={toY(previousAverage)} stroke="rgb(240 221 186 / 0.22)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
        ) : null}
        <g clipPath={`url(#${id}-trace)`}>
          <path d={`${line} L${W} ${H} L0 ${H} Z`} fill={`url(#${id}-aire)`} className="carte-produit-aire" />
          <path d={line} fill="none" stroke={color} strokeWidth="6" opacity="0.45" filter={`url(#${id}-halo)`} vectorEffect="non-scaling-stroke" className="carte-produit-halo" />
          <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        </g>
      </svg>
      {/* Le point et sa bulle en HTML : dans un SVG étiré, un cercle deviendrait une ellipse. */}
      <span aria-hidden className="absolute inset-y-0 w-px bg-sable/20" style={{ left: `${(end[0] / W) * 100}%` }} />
      <span
        aria-hidden
        className="courbe-point courbe-point-carte absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-encre"
        style={{ left: `${(end[0] / W) * 100}%`, top: `${(end[1] / H) * 100}%`, borderColor: color }}
      />
      {diff !== null ? (
        <span
          className="courbe-point courbe-point-carte absolute -translate-x-[calc(100%-6px)] -translate-y-[calc(100%+10px)] rounded-full border border-white/15 bg-nuit-2/90 px-2.5 py-1 text-[12px] font-bold whitespace-nowrap tabular-nums"
          style={{ left: `${(end[0] / W) * 100}%`, top: `${(end[1] / H) * 100}%` }}
        >
          {signedCompact(diff)}
          <span className="sr-only"> par rapport à la période précédente</span>
        </span>
      ) : null}
    </div>
  );
}

function ProductDelta({ product }: { product: TopProduct }) {
  if (product.previous_revenue === undefined) return <span className="text-xs text-texte-3">{formatNumber(product.units)} vendus</span>;
  const percent = variation(product.revenue, product.previous_revenue);
  if (percent === null) return <span className="text-xs text-texte-3">nouveau sur la période</span>;
  const up = percent >= 0;
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", up ? "text-orange-clair" : "text-danger")}>
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d={up ? "M8 13l4-4 4 4" : "M8 11l4 4 4-4"} />
      </svg>
      {formatVariation(percent)}
      <span className="sr-only">par rapport à la période précédente</span>
    </span>
  );
}

/** Les trois produits qui rapportent le plus sur la période, chacun avec sa courbe. */
export function BestSellers({ products, slug, canOpen }: { products: TopProduct[]; slug: string; canOpen: boolean }) {
  if (products.length === 0) {
    return <p className="carte rounded-carte p-5 text-sm text-texte-3">Aucune vente sur cette période.</p>;
  }
  return (
    <ol className="grid gap-2.5 sm:grid-cols-3 md:gap-3">
      {products.slice(0, 3).map((product, index) => {
        const [value, unit] = compactFcfa(product.revenue);
        return (
          <li key={product.id} className="carte-produit carte group/produit flex min-h-[300px] flex-col overflow-hidden rounded-[22px]">
            <div className="flex items-center gap-2.5 px-4 pt-4">
              <ProductSwatch name={product.name} imageUrl={product.image_url} className="size-[38px] shrink-0 rounded-[10px]" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-texte-3">{product.category || `N° ${index + 1} des ventes`}</span>
              {canOpen ? (
                <Link
                  href={`/app/${slug}/produits/${product.id}`}
                  aria-label={`Ouvrir la fiche de ${product.name}`}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-white/15 text-texte-2 transition-[transform,color,border-color] duration-300 group-hover/produit:rotate-45 hover:border-orange-clair/60 hover:text-texte"
                >
                  <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M7 17L17 7M9 7h8v8" />
                  </svg>
                </Link>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5 px-4 pt-3">
              <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold">{product.name}</h3>
              <span className="mt-2 text-[12.5px] text-texte-3">Chiffre d’affaires</span>
              <TwoTone value={value} unit={unit} className="text-[clamp(30px,3vw,40px)]" />
              <ProductDelta product={product} />
            </div>
            <Sparkline product={product} index={index} />
          </li>
        );
      })}
    </ol>
  );
}
