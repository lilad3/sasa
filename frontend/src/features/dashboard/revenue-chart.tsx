import { formatDay, formatFcfa } from "@/lib/format";

type Point = { date: string; revenue: number };

const W = 600;
const H = 170;
const TOP = 14;
const BOTTOM = 8;

/** Courbe lissée (Catmull-Rom) à travers les points. */
function smoothPath(points: [number, number][]) {
  if (points.length === 0) return "";
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}

/**
 * Chiffre d'affaires jour par jour, en courbe lumineuse. Rendu côté serveur (aucun JavaScript envoyé au navigateur).
 * Le résumé textuel reste lisible par les lecteurs d'écran.
 */
export function RevenueChart({ series }: { series: Point[] }) {
  if (series.length < 2) return null;
  const max = Math.max(...series.map((p) => p.revenue), 1);
  const points: [number, number][] = series.map((p, i) => [
    (i / (series.length - 1)) * W,
    TOP + (1 - p.revenue / max) * (H - TOP - BOTTOM),
  ]);
  const line = smoothPath(points);
  const best = series.reduce((a, b) => (b.revenue > a.revenue ? b : a));
  const last = points[points.length - 1];

  return (
    <figure className="flex flex-col gap-2">
      <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-[170px] w-full overflow-visible" aria-hidden>
        <defs>
          <linearGradient id="ca-remplissage" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#8bda4b" stopOpacity="0.3" />
            <stop offset="1" stopColor="#8bda4b" stopOpacity="0" />
          </linearGradient>
          <filter id="ca-halo" x="-5%" y="-30%" width="110%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <line x1="0" x2={W} y1={H - BOTTOM} y2={H - BOTTOM} stroke="rgb(215 224 161 / 0.18)" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
        <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#ca-remplissage)" />
        <path d={line} fill="none" stroke="#8bda4b" strokeWidth="6" opacity="0.4" filter="url(#ca-halo)" vectorEffect="non-scaling-stroke" />
        <path d={line} fill="none" stroke="#8bda4b" strokeWidth="2" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Point du dernier jour en HTML : dans un SVG étiré, un cercle deviendrait une ellipse. */}
      <span
        aria-hidden
        className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-lime-clair bg-encre"
        style={{ left: `${(last[0] / W) * 100}%`, top: `${(last[1] / H) * 100}%` }}
      />
      </div>
      <figcaption className="flex justify-between font-mono text-[11px] text-texte-3">
        <span>{formatDay(series[0].date)}</span>
        <span className="sr-only">
          Meilleure journée : {formatDay(best.date)}, {formatFcfa(best.revenue)}.
        </span>
        <span>{formatDay(series[series.length - 1].date)}</span>
      </figcaption>
    </figure>
  );
}
