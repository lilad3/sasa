"use client";

import "./tech.css";

import { IBM_Plex_Sans, Martian_Mono } from "next/font/google";
import { type KeyboardEvent, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { flyToCart, motionAllowed } from "../motion";
import { CartButton, ProductImage, Sections, StockHint, ThemeFooter, type ThemeProps, type Tone } from "../parts";
import { Universe, universeFrom, type UniverseLook, type UniverseOpen } from "../universe";

const mono = Martian_Mono({ subsets: ["latin"], weight: ["400", "600", "800"], variable: "--tc-mono" });
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--tc-sans" });

const TONE: Tone = {
  muted: "tc-muted",
  card: "tc-card",
  line: "border-[var(--tc-line)]",
  heading: "tc-heading",
  button: "tc-ink",
  ghost: "tc-ghost",
};

const MAX_COMPARE = 3;
const LOOK: UniverseLook = { ink: "#f2f3f5", accent: "#ffcf1f", onAccent: "#15171b", fallback: "#23262c" };

/** Tech : l'appareil sur l'établi, qu'on fait tourner au doigt ; le tarif du jour en lignes ; le comparateur. */
export function TechTheme(props: ThemeProps) {
  const { shop, products, featured } = props;
  const [selectedId, setSelectedId] = useState(featured?.id ?? products[0]?.id ?? "");
  const [compare, setCompare] = useState<string[]>([]);
  const [showCompare, setShowCompare] = useState(false);
  const [universe, setUniverse] = useState<UniverseOpen | null>(null);
  const selected = products.find((p) => p.id === selectedId) ?? products[0];

  const toggleCompare = (id: string) =>
    setCompare((list) => (list.includes(id) ? list.filter((x) => x !== id) : list.length >= MAX_COMPARE ? list : [...list, id]));

  return (
    <div className={cn(mono.variable, sans.variable, "tc flex min-h-dvh flex-col")}>
      <p className="tc-bandeau">{shop.city ? `${shop.city} · ` : ""}prix du jour en FCFA · garantie sur chaque appareil</p>
      <header className="tc-head">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="tc-puce" aria-hidden />
            <span className="flex min-w-0 flex-col">
              <span className="tc-mono truncate text-[16px] font-extrabold uppercase">{shop.name}</span>
              <span className="tc-muted truncate text-[12px]">{shop.description || "Téléphones et ordinateurs"}</span>
            </span>
          </div>
          <span data-cart-target className="inline-flex">
            <CartButton count={props.count} onCheckout={props.onCheckout} closed={props.closed} className="tc-ink rounded-xl" />
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-12 px-4 pt-4 pb-36">
        {selected ? <Bench key={selected.id} product={selected} props={props} /> : null}
        <Sections
          props={props}
          tone={TONE}
          collection={<PriceList products={products} selectedId={selected?.id ?? ""} onSelect={setSelectedId} compare={compare} onCompare={toggleCompare} onUniverse={setUniverse} />}
        />
      </main>

      {compare.length > 0 ? (
        <div className="tc-tray">
          <span className="text-[13px]">
            {compare.length} appareil{compare.length > 1 ? "s" : ""} à comparer
          </span>
          <button type="button" onClick={() => setShowCompare(true)} disabled={compare.length < 2} className="tc-jaune min-h-11 rounded-xl px-4 text-[14px] font-bold disabled:opacity-50">
            Comparer
          </button>
        </div>
      ) : null}

      <ThemeFooter shop={shop} tone={TONE} className="tc-footer" />
      {showCompare ? <Comparator items={products.filter((p) => compare.includes(p.id))} onClose={() => setShowCompare(false)} /> : null}
      {universe ? <Universe open={universe} products={products} props={props} look={LOOK} onClose={() => setUniverse(null)} /> : null}
    </div>
  );
}

/** L'établi : tapis quadrillé, règle graduée ; l'appareil oscille et tourne au doigt ; le prix défile comme un compteur. */
function Bench({ product, props }: { product: PublicProduct; props: ThemeProps }) {
  const device = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; angle: number } | null>(null);
  const [angle, setAngle] = useState(0);
  const [spread, setSpread] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inCart = props.cart[product.id] ?? 0;
  const photos = product.photos.length;

  const down = (e: PointerEvent) => {
    drag.current = { x: e.clientX, angle };
    setDragging(true);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!drag.current || !motionAllowed(device.current)) return;
    setAngle(Math.max(-55, Math.min(55, drag.current.angle + (e.clientX - drag.current.x) * 0.5)));
  };
  const up = () => {
    drag.current = null;
    setDragging(false);
    setAngle(0);
  };

  return (
    <section aria-labelledby="tc-appareil" className="tc-etabli">
      <div className="tc-regle" aria-hidden>
        {Array.from({ length: 13 }, (_, i) => (
          <span key={i}>{i % 4 === 0 ? i / 4 : ""}</span>
        ))}
      </div>
      <div className="tc-tapis" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <span className="tc-cote tc-muted">{spread ? "vue éclatée" : "faites tourner l’appareil"}</span>
        <div ref={device} className={cn("tc-appareil", !dragging && angle === 0 && !spread && "tc-oscille", spread && "tc-eclate")} style={{ transform: angle ? `rotateY(${angle}deg)` : undefined }}>
          {spread && photos > 1 ? (
            product.photos.slice(0, 4).map((photo, i) => (
              <span key={photo.id} className="tc-calque" style={{ ["--i" as string]: i }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/boutique/${props.shop.slug}/photo/${photo.id}?v=${photo.version}`} alt="" className="absolute inset-0 size-full object-cover" />
              </span>
            ))
          ) : (
            <span className="tc-calque">
              <ProductImage product={product} />
            </span>
          )}
        </div>
        <span className="tc-ombre" aria-hidden />
      </div>
      <div className="flex flex-col gap-3">
        <p className="tc-mono tc-muted text-[11.5px] tracking-[0.1em] uppercase">{product.category || "Appareil"}</p>
        <h1 id="tc-appareil" className="text-[clamp(1.8rem,6vw,2.8rem)] leading-[1.02] font-bold">
          {product.name}
        </h1>
        <Odometer value={product.price} />
        <StockHint product={product} className="tc-alerte text-[13px] font-semibold" />
        {product.description ? <p className="tc-muted max-w-[60ch] text-[14.5px]">{product.description}</p> : null}
        <div className="flex flex-wrap gap-2">
          {product.in_stock && inCart < product.max_quantity ? (
            <button
              type="button"
              className="tc-ink min-h-12 rounded-xl px-5 text-[15px] font-bold"
              onClick={() => {
                props.onChange(product, inCart + 1);
                flyToCart(device.current?.querySelector(".tc-calque") ?? null);
              }}
            >
              {inCart ? `Ajouter encore · ${inCart} au panier` : "Ajouter au panier"}
            </button>
          ) : (
            <span className="tc-card rounded-xl px-4 py-3 text-[14px] font-semibold">{product.in_stock ? "Tout le stock est dans votre panier" : "Épuisé"}</span>
          )}
          {photos > 1 ? (
            <button type="button" onClick={() => setSpread((s) => !s)} className="tc-ghost min-h-12 rounded-xl px-4 text-[14px] font-semibold">
              {spread ? "Remonter" : `Voir les ${Math.min(photos, 4)} photos`}
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** Le prix en gros chiffres sur la bande jaune : chaque chiffre défile jusqu'à sa valeur. */
function Odometer({ value }: { value: number }) {
  const digits = formatNumber(value).split("");
  return (
    <p className="tc-prix" aria-label={formatFcfa(value)}>
      <span aria-hidden className="inline-flex">
        {digits.map((char, i) =>
          /\d/.test(char) ? (
            <span key={i} className="tc-roue">
              <span className="tc-chiffres" style={{ transform: `translateY(-${Number(char) * 10}%)`, transitionDelay: `${i * 40}ms` }}>
                {"0123456789".split("").map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          ) : (
            <span key={i} className="w-[0.3em]" />
          ),
        )}
      </span>
      <small aria-hidden>FCFA</small>
    </p>
  );
}

function PriceList({
  products,
  selectedId,
  onSelect,
  compare,
  onCompare,
  onUniverse,
}: {
  products: PublicProduct[];
  selectedId: string;
  onSelect: (id: string) => void;
  compare: string[];
  onCompare: (id: string) => void;
  onUniverse: (value: UniverseOpen) => void;
}) {
  const cats = useMemo(() => ["Tout", ...new Set(products.map((p) => p.category.trim() || "Divers"))], [products]);
  const top = useMemo(() => Math.max(0, ...products.map((p) => p.price)), [products]);
  const [cat, setCat] = useState("Tout");
  const [budget, setBudget] = useState(top);
  const rows = products.filter((p) => (cat === "Tout" || (p.category.trim() || "Divers") === cat) && p.price <= budget);

  return (
    <section aria-labelledby="tc-tarif" className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <h2 id="tc-tarif" className="tc-heading">
          Le tarif du jour
        </h2>
        <span className="tc-mono tc-muted text-[11px]">{new Date().toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })}</span>
      </div>
      <div className="tc-onglets" role="group" aria-label="Catégories">
        {cats.map((c) => (
          <button
            key={c}
            type="button"
            aria-pressed={cat === c}
            onClick={(e) => {
              setCat(c);
              if (c !== "Tout") onUniverse(universeFrom(c, e.currentTarget));
            }}
            className="tc-onglet"
          >
            {c}
          </button>
        ))}
      </div>
      {top > 0 ? (
        <label className="flex flex-col gap-1">
          <span className="tc-muted text-[13px]">
            Budget : jusqu’à <b className="tc-mono text-[var(--tc-ink)]">{formatNumber(budget)} F</b>
          </span>
          <input type="range" min={0} max={top} step={Math.max(500, Math.round(top / 40 / 500) * 500)} value={budget} onChange={(e) => setBudget(Number(e.target.value))} className="tc-curseur" />
        </label>
      ) : null}
      <ul className="tc-lignes">
        {rows.length === 0 ? <li className="tc-muted p-4 text-[14px]">Aucun appareil dans ce budget.</li> : null}
        {rows.map((p) => (
          <li key={p.id} className={cn("tc-ligne", p.id === selectedId && "tc-ligne-on")}>
            <button
              type="button"
              className="tc-ligne-ouvrir"
              onClick={() => {
                onSelect(p.id);
                document.getElementById("tc-appareil")?.scrollIntoView({ behavior: motionAllowed() ? "smooth" : "auto", block: "center" });
              }}
              aria-label={`${p.name}, ${formatFcfa(p.price)} : poser sur l’établi`}
            >
              <span className="tc-vignette">
                <ProductImage product={p} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col text-left">
                <b className="truncate text-[15px]">{p.name}</b>
                <span className="tc-muted text-[12.5px]">{p.in_stock ? (p.low_stock ? "Dernières pièces" : "En stock") : "Sur commande"}</span>
              </span>
              <span className="tc-mono text-[14px] font-extrabold tabular-nums">{formatNumber(p.price)}</span>
            </button>
            <label className="tc-comparer">
              <input type="checkbox" checked={compare.includes(p.id)} onChange={() => onCompare(p.id)} disabled={!compare.includes(p.id) && compare.length >= MAX_COMPARE} />
              <span>Comparer</span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Comparator({ items, onClose }: { items: PublicProduct[]; onClose: () => void }) {
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    title.current?.focus({ preventScroll: true });
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);
  const best = Math.min(...items.map((p) => p.price));
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };
  return (
    <div className="tc-voile" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div role="dialog" aria-modal="true" aria-labelledby="tc-comparer" className="tc-sheet">
        <h2 ref={title} tabIndex={-1} id="tc-comparer" className="tc-heading outline-none">
          Comparer
        </h2>
        <div className="tc-table" style={{ gridTemplateColumns: `90px repeat(${items.length}, minmax(0, 1fr))` }}>
          <span />
          {items.map((p) => (
            <span key={p.id} className="tc-vignette tc-vignette-grande">
              <ProductImage product={p} />
            </span>
          ))}
          <span className="tc-muted text-[12px]">Appareil</span>
          {items.map((p) => (
            <b key={p.id} className="text-[13.5px] leading-tight">
              {p.name}
            </b>
          ))}
          <span className="tc-muted text-[12px]">Prix</span>
          {items.map((p) => (
            <span key={p.id} className={cn("tc-mono text-[13px] font-extrabold", p.price === best && "tc-meilleur")}>
              {formatNumber(p.price)} F
            </span>
          ))}
          <span className="tc-muted text-[12px]">Disponible</span>
          {items.map((p) => (
            <span key={p.id} className="text-[13px]">
              {p.in_stock ? (p.low_stock ? "Dernières pièces" : "Oui") : "Sur commande"}
            </span>
          ))}
        </div>
        <button type="button" onClick={onClose} className="tc-ink min-h-12 rounded-xl text-[15px] font-bold">
          Fermer
        </button>
      </div>
    </div>
  );
}
