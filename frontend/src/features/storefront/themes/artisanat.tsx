"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

import { AddControl, accentOf, CartButton, ProductImage, Sections, StockHint, ThemeFooter, type ThemeProps, type Tone } from "./parts";
import { Scene } from "./scene";

const TONE: Tone = {
  muted: "text-encre-doux",
  card: "border-2 border-encre bg-[#f6ecda]",
  line: "border-encre",
  heading: "large text-[clamp(1.35rem,3vw,1.75rem)] font-extrabold",
  button: "bg-encre text-[#efe3cc]",
  ghost: "border-[1.5px] border-encre bg-transparent text-encre",
};

// Les traits sont tracés à la main (des courbes un peu irrégulières) : la toile peinte, pas la règle.
// Chaque tracé est dessiné pour une taille (viewBox) puis recalculé à la taille réelle du bloc : un SVG étiré
// avec un trait fixe (non-scaling-stroke) fausse pathLength dans Chrome, et le trait s'arrêtait avant la fin.
const FRAME = { d: "M8 10 C 100 4, 260 12, 354 7 C 358 120, 352 300, 356 422 C 250 427, 110 420, 6 425 C 10 300, 3 130, 8 10 Z", width: 362, height: 430 };
const PICTURE_FRAME = { d: "M5 6 C 90 2, 270 9, 357 4 C 360 80, 355 170, 358 235 C 260 239, 100 233, 4 237 C 8 170, 2 80, 5 6 Z", width: 362, height: 240 };
const DIVIDER = { d: "M2 4 C 40 1, 80 7, 120 4 S 200 1, 240 4 S 320 7, 348 3", width: 350, height: 8 };

/** Les tracés ci-dessus n'ont que des commandes absolues à paires de coordonnées : on met à l'échelle x, puis y. */
function scalePath(d: string, sx: number, sy: number) {
  let index = 0;
  return d.replace(/-?\d+(\.\d+)?/g, (value) => (Number(value) * (index++ % 2 === 0 ? sx : sy)).toFixed(1));
}

type DrawnProps = { shape: { d: string; width: number; height: number }; className?: string; pathClassName: string; strokeWidth: number; style?: CSSProperties };

function Drawn({ shape, className, pathClassName, strokeWidth, style }: DrawnProps) {
  const ref = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.round(entry.contentRect.width);
      const height = Math.round(entry.contentRect.height);
      if (width > 0 && height > 0) setSize((current) => (current?.width === width && current.height === height ? current : { width, height }));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const d = useMemo(() => (size ? scalePath(shape.d, size.width / shape.width, size.height / shape.height) : shape.d), [shape, size]);
  // Avant la première mesure (rendu serveur), le dessin est étiré : le trait reste fixe le temps d'un instant.
  return (
    <svg ref={ref} aria-hidden viewBox={size ? `0 0 ${size.width} ${size.height}` : `0 0 ${shape.width} ${shape.height}`} preserveAspectRatio={size ? undefined : "none"} className={className}>
      <path
        pathLength={1}
        d={d}
        fill="none"
        stroke="#17110a"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect={size ? undefined : "non-scaling-stroke"}
        className={pathClassName}
        style={style}
      />
    </svg>
  );
}

/** Artisanat : la main qui fabrique, l'histoire, la pièce unique (docs/chantier-p5.md §3.1). */
export function ArtisanatTheme(props: ThemeProps) {
  const { shop, design, featured } = props;
  const accent = accentOf(shop);

  return (
    <div
      className="flex min-h-dvh flex-col text-encre"
      style={{ backgroundColor: "#efe3cc", backgroundImage: "repeating-linear-gradient(0deg, rgb(92 81 70 / 0.06) 0 1px, transparent 1px 4px), repeating-linear-gradient(90deg, rgb(92 81 70 / 0.05) 0 1px, transparent 1px 5px)" }}
    >
      <header className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-3 px-5 pt-4">
        <span className="th-enter th-up font-mono text-xs tracking-[0.12em] uppercase">{shop.city || shop.name}</span>
        <CartButton count={props.count} onCheckout={props.onCheckout} closed={props.closed} className="border-[1.5px] border-encre text-encre" />
      </header>

      <section aria-label={`Couverture de ${shop.name}`} className="relative mx-auto mt-4 w-[calc(100%-24px)] max-w-[1150px]">
        <Drawn shape={FRAME} strokeWidth={2.4} className="pointer-events-none absolute inset-0 size-full" pathClassName="th-enter th-trace" style={{ animationDelay: "200ms", animationDuration: "2.2s" }} />
        <div className="relative grid gap-6 px-6 pt-8 pb-10 md:grid-cols-[1.2fr_1fr] md:items-end md:px-12 md:pt-12">
          <div className="flex flex-col gap-3">
            <h1 className="th-enter th-ink large text-[clamp(2.6rem,9vw,5.2rem)] leading-[0.95] font-black" style={{ animationDelay: "500ms" }}>
              {shop.name}
            </h1>
            {design.texts.tagline || shop.description ? (
              <p className="th-enter th-up max-w-[46ch] text-[15px] leading-relaxed text-encre-doux" style={{ animationDelay: "1300ms" }}>
                {design.texts.tagline || shop.description}
              </p>
            ) : null}
          </div>
          <div aria-hidden className="flex items-end justify-between gap-4">
            <svg viewBox="0 0 150 100" className="th-loop th-bob h-auto w-[44%] max-w-[180px]" style={{ animationDelay: "3.6s" }}>
              <path pathLength={1} d="M12 62 C 28 40, 58 34, 82 44 C 92 32, 110 28, 124 36 C 116 39, 111 44, 109 49 C 118 54, 122 63, 117 70 C 100 75, 72 77, 50 73 C 38 80, 22 80, 12 72 Z" fill="none" stroke="#17110a" strokeWidth="2.2" strokeLinejoin="round" className="th-enter th-trace" style={{ animationDelay: "1600ms" }} />
              <path pathLength={1} d="M52 72 L46 92 M70 74 L68 94 M40 50 C 55 48, 70 52, 84 60 M44 58 C 58 56, 72 60, 84 66" fill="none" stroke="#17110a" strokeWidth="1.8" strokeLinecap="round" className="th-enter th-trace" style={{ animationDelay: "2600ms", animationDuration: "1.2s" }} />
              <circle cx="113" cy="40" r="2.4" fill="#17110a" className="th-enter th-up" style={{ animationDelay: "3200ms" }} />
              <path d="M60 60 C 66 52, 78 52, 86 60 C 78 66, 66 66, 60 60 Z" fill={accent.hex} className="th-enter th-up" style={{ animationDelay: "3300ms" }} />
            </svg>
            <svg viewBox="0 0 130 64" className="th-loop th-bob h-auto w-[38%] max-w-[150px]" style={{ animationDelay: "4s" }}>
              <path pathLength={1} d="M8 32 C 28 10, 70 10, 92 32 C 70 54, 28 54, 8 32 Z M92 32 L118 14 L110 32 L118 50 Z" fill="none" stroke="#17110a" strokeWidth="2.2" strokeLinejoin="round" className="th-enter th-trace" style={{ animationDelay: "2100ms", animationDuration: "1.6s" }} />
              <path pathLength={1} d="M36 22 q 7 10 0 20 M52 18 q 8 14 0 28 M68 21 q 7 11 0 22" fill="none" stroke="#17110a" strokeWidth="1.6" strokeLinecap="round" className="th-enter th-trace" style={{ animationDelay: "3000ms", animationDuration: "1s" }} />
            </svg>
          </div>
        </div>
      </section>

      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-12 px-5 pt-10 pb-32">
        {featured ? (
          <Scene as="section" aria-labelledby="titre-une" className="grid gap-5 md:grid-cols-2 md:items-center">
            <div className="relative h-[240px] md:h-[320px]">
              <div className="th-reveal th-up absolute inset-[10px] overflow-hidden" style={{ animationDelay: "900ms" }}>
                <ProductImage product={featured} />
              </div>
              <Drawn shape={PICTURE_FRAME} strokeWidth={2.4} className="pointer-events-none absolute inset-0 size-full" pathClassName="th-reveal th-trace" style={{ animationDuration: "1.6s" }} />
              <span
                className={cn("th-reveal th-stamp absolute right-4 -bottom-4 grid size-[92px] place-items-center rounded-full border-[2.5px] border-dashed text-center text-[15px] leading-tight font-black", accent.disc)}
                style={{ animationDelay: "1500ms", borderColor: "currentColor" }}
              >
                {formatNumber(featured.price)}
                <br />F
              </span>
            </div>
            <div className="flex flex-col gap-2.5">
              <p className="th-reveal th-up font-mono text-xs tracking-[0.1em] text-encre-doux uppercase" style={{ animationDelay: "1200ms" }}>
                À la une
              </p>
              <h2 id="titre-une" className="th-reveal th-up large text-[clamp(1.7rem,4vw,2.4rem)] leading-tight font-extrabold" style={{ animationDelay: "1300ms" }}>
                {featured.name}
              </h2>
              {featured.description ? (
                <p className="th-reveal th-up text-[15px] leading-relaxed text-encre-doux" style={{ animationDelay: "1400ms" }}>
                  {featured.description}
                </p>
              ) : null}
              <StockHint product={featured} className="th-reveal th-up text-sm font-bold" />
              <div className="th-reveal th-up pt-1" style={{ animationDelay: "1500ms" }}>
                <AddControl product={featured} quantity={props.cart[featured.id] ?? 0} onChange={props.onChange} tone={{ ...TONE, ghost: "bg-encre text-[#efe3cc]" }} />
              </div>
            </div>
          </Scene>
        ) : null}

        <Sections props={props} tone={TONE} collection={<ArtisanatCollection {...props} />} />
      </main>
      <ThemeFooter shop={shop} tone={TONE} className="border-t-2 border-encre" />
    </div>
  );
}

function ArtisanatCollection({ products, cart, onChange }: ThemeProps) {
  return (
    <section id="collection" aria-labelledby="titre-collection" className="flex scroll-mt-24 flex-col gap-3">
      <h2 id="titre-collection" className={TONE.heading}>
        Dans l’atelier
      </h2>
      <ul className="grid md:grid-cols-2 md:gap-x-10">
        {products.map((product, index) => (
          <Scene as="li" key={product.id} className="flex flex-col">
            <div className="th-reveal th-up flex items-center gap-4 py-3" style={{ animationDelay: `${(index % 2) * 120}ms` }}>
              <div className="relative size-[72px] shrink-0 overflow-hidden rounded-full border-2 border-encre">
                <ProductImage product={product} />
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <h3 className="text-[15.5px] leading-snug font-bold">{product.name}</h3>
                {product.description ? <p className="line-clamp-2 text-[13px] leading-snug text-encre-doux">{product.description}</p> : null}
                <StockHint product={product} className="text-xs font-bold" />
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span className="large text-base font-black whitespace-nowrap">{formatNumber(product.price)} F</span>
                <AddControl product={product} quantity={cart[product.id] ?? 0} onChange={onChange} tone={TONE} compact />
              </div>
            </div>
            <Drawn shape={DIVIDER} strokeWidth={1.3} className="h-2 w-full" pathClassName="th-reveal th-trace" style={{ animationDelay: "250ms", animationDuration: "1.1s" }} />
          </Scene>
        ))}
      </ul>
    </section>
  );
}
