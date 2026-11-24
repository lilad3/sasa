"use client";

import "./tailor.css";

import { Hanken_Grotesk, Young_Serif } from "next/font/google";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { flipFrom, flyToCart } from "../motion";
import { CartButton, ProductImage, Sections, StockHint, ThemeFooter, type ThemeProps, type Tone } from "../parts";
import { Universe, universeFrom, type UniverseLook, type UniverseOpen } from "../universe";

const serif = Young_Serif({ subsets: ["latin"], weight: "400", variable: "--tl-serif" });
const sans = Hanken_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--tl-sans" });

const TONE: Tone = {
  muted: "tl-muted",
  card: "tl-card",
  line: "border-[var(--tl-filet)]",
  heading: "tl-heading",
  button: "tl-encre",
  ghost: "tl-ghost",
};

const LOOK: UniverseLook = { ink: "#fbf8f2", accent: "#e9a46b", onAccent: "#17191d", fallback: "#3a3631" };

type Open = { product: PublicProduct; from: DOMRect; opener: HTMLElement };

function categories(products: PublicProduct[]) {
  const names: string[] = [];
  for (const p of products) {
    const name = p.category.trim() || "Pièces";
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Tailor : le portant en laiton où les pièces pivotent sur leur cintre, le bon de tenue, la craie orange. */
export function TailorTheme(props: ThemeProps) {
  const { shop, products } = props;
  const cats = useMemo(() => categories(products), [products]);
  const [cat, setCat] = useState("Tout");
  const [open, setOpen] = useState<Open | null>(null);
  const [universe, setUniverse] = useState<UniverseOpen | null>(null);
  const shown = cat === "Tout" ? products : products.filter((p) => (p.category.trim() || "Pièces") === cat);

  return (
    <div className={cn(serif.variable, sans.variable, "tl flex min-h-dvh flex-col")}>
      <header className="tl-head">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="tl-serif truncate text-[22px] leading-none">{shop.name}</span>
            <span className="tl-muted truncate text-[11.5px] tracking-[0.08em] uppercase">
              {shop.description ? shop.description.split(/[.:]/)[0] : "Prêt-à-porter"}
              {shop.city ? ` · ${shop.city}` : ""}
            </span>
          </div>
          <span data-cart-target className="inline-flex">
            <CartButton count={props.count} onCheckout={props.onCheckout} closed={props.closed} className="tl-encre rounded-xl" />
          </span>
        </div>
      </header>

      <main className="flex w-full flex-col gap-12 pb-32">
        <Sections
          props={props}
          tone={TONE}
          className="[&>div]:mx-auto [&>div]:w-full [&>div]:max-w-[1180px] [&>div]:px-4"
          collection={
            <section aria-labelledby="tl-portant" className="flex flex-col gap-3">
              <p className="tl-craie">
                {products.length} pièce{products.length > 1 ? "s" : ""} sur le portant
              </p>
              <h2 id="tl-portant" className="tl-serif text-[clamp(2.4rem,8vw,4.6rem)] leading-[0.95]">
                Le portant de la semaine
              </h2>
              <p className="tl-muted max-w-[52ch] text-[15px]">Touchez une pièce pour la voir de face, touchez-la encore pour l’ouvrir.</p>
              <div className="tl-etiquettes" role="group" aria-label="Filtrer le portant">
                {["Tout", ...cats].map((name) => (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={cat === name}
                    onClick={(e) => {
                      setCat(name);
                      if (name !== "Tout") setUniverse(universeFrom(name, e.currentTarget));
                    }}
                    className="tl-etiquette"
                  >
                    {name}
                  </button>
                ))}
              </div>
              <Rail key={cat} items={shown} props={props} onOpen={setOpen} />
              {cats.length > 1 ? <OutfitTicket products={products} cats={cats} props={props} /> : null}
            </section>
          }
        />
      </main>

      <ThemeFooter shop={shop} tone={TONE} className="tl-footer" />
      {open ? <PieceSheet key={open.product.id} {...open} props={props} shopSlug={shop.slug} onClose={() => setOpen(null)} /> : null}
      {universe ? <Universe open={universe} products={products} props={props} look={LOOK} uncategorized="Pièces" onClose={() => setUniverse(null)} /> : null}
    </div>
  );
}

/** Le portant : la pièce active est de face, les autres pivotent sur leur cintre de chaque côté. */
function Rail({ items, props, onOpen }: { items: PublicProduct[]; props: ThemeProps; onOpen: (value: Open) => void }) {
  const [active, setActive] = useState(0);
  const touch = useRef(false);
  if (items.length === 0) return <p className="tl-muted">Rien sur le portant pour l’instant.</p>;
  return (
    <div className="tl-rail" aria-label="Portant">
      <div className="tl-tringle" aria-hidden />
      <ul className="tl-cintres">
        {items.map((product, index) => (
          <li key={product.id} className={cn("tl-cintre", index === active && "tl-on", index < active && "tl-gauche")}>
            <button
              type="button"
              className="tl-piece"
              aria-label={`${product.name}, ${formatFcfa(product.price)}${product.in_stock ? "" : ", épuisé"}`}
              onPointerDown={(e) => {
                touch.current = e.pointerType !== "mouse";
              }}
              onMouseEnter={() => setActive(index)}
              onFocus={() => setActive(index)}
              onClick={(e) => {
                if (touch.current && index !== active) {
                  setActive(index);
                  return;
                }
                const card = e.currentTarget.querySelector<HTMLElement>(".tl-toile");
                onOpen({ product, opener: e.currentTarget, from: (card ?? e.currentTarget).getBoundingClientRect() });
              }}
            >
              <span className="tl-crochet" aria-hidden />
              <span className="tl-toile">
                <ProductImage product={product} />
                {props.cart[product.id] ? <span className="tl-pique">{props.cart[product.id]} au sac</span> : null}
              </span>
              <span className="tl-ticket">
                <b className="tl-serif line-clamp-2 text-[16px] leading-tight">{product.name}</b>
                <span className="text-[13px] tabular-nums">{formatNumber(product.price)} F</span>
                {product.in_stock ? <StockHint product={product} className="tl-craie-txt text-[11.5px]" /> : <span className="text-[11.5px] font-semibold">Épuisé</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Le bon de tenue : une pièce par rayon, cousue sur un bon numéroté, puis tout part au sac. */
function OutfitTicket({ products, cats, props }: { products: PublicProduct[]; cats: string[]; props: ThemeProps }) {
  const rows = cats.slice(0, 4);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const list = useRef<HTMLUListElement>(null);
  const chosen = rows.flatMap((c) => products.filter((p) => p.id === picked[c] && p.in_stock));
  const total = chosen.reduce((sum, p) => sum + p.price, 0);

  const addAll = () => {
    for (const p of chosen) {
      const inCart = props.cart[p.id] ?? 0;
      if (inCart < p.max_quantity) props.onChange(p, inCart + 1);
    }
    list.current?.querySelectorAll<HTMLElement>(".tl-bon-photo").forEach((el, i) => setTimeout(() => flyToCart(el), i * 120));
  };

  return (
    <div className="tl-cabine">
      <p className="tl-craie">Cabine d’essayage</p>
      <h3 className="tl-serif text-[clamp(2rem,6vw,3rem)] leading-none">Composer la tenue</h3>
      {rows.map((c) => (
        <div key={c} className="flex flex-col gap-2">
          <p className="tl-muted text-[12px] font-bold tracking-[0.14em] uppercase">{c}</p>
          <div className="tl-choix">
            {products
              .filter((p) => (p.category.trim() || "Pièces") === c)
              .map((p) => (
                <button key={p.id} type="button" disabled={!p.in_stock} aria-pressed={picked[c] === p.id} onClick={() => setPicked((cur) => ({ ...cur, [c]: cur[c] === p.id ? "" : p.id }))} className="tl-mini">
                  <span className="tl-mini-photo">
                    <ProductImage product={p} />
                  </span>
                  <span className="line-clamp-1 text-[12px] font-semibold">{p.name}</span>
                </button>
              ))}
          </div>
        </div>
      ))}
      <div className="tl-bon">
        <span className="tl-muted text-[11.5px] tracking-[0.12em] uppercase">Bon de tenue n° {String(1000 + products.length * 7).slice(-4)}</span>
        <ul ref={list} className="flex flex-col">
          {chosen.length === 0 ? (
            <li className="tl-muted py-3 text-[14px]">Choisissez une pièce par rayon : elles s’inscrivent ici.</li>
          ) : (
            chosen.map((p) => (
              <li key={p.id} className="tl-bon-ligne">
                <span className="tl-bon-photo">
                  <ProductImage product={p} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px]">{p.name}</span>
                <b className="text-[14px] tabular-nums">{formatNumber(p.price)} F</b>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-baseline justify-between">
          <span className="text-[14px]">Tenue complète</span>
          <b className="tl-serif text-[26px] tabular-nums">{formatFcfa(total)}</b>
        </div>
        <button type="button" onClick={addAll} disabled={chosen.length === 0} className="tl-encre min-h-12 w-full rounded-xl text-[15px] font-bold disabled:opacity-40">
          Ajouter toute la tenue
        </button>
      </div>
    </div>
  );
}

function PieceSheet({ product, from, opener, props, shopSlug, onClose }: Open & { props: ThemeProps; shopSlug: string; onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [back, setBack] = useState(false);
  const inCart = props.cart[product.id] ?? 0;
  const room = Math.max(0, product.max_quantity - inCart);
  const second = product.photos[1];

  useEffect(() => {
    if (card.current) flipFrom(card.current, from, 560);
    title.current?.focus({ preventScroll: true });
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
      opener.focus({ preventScroll: true });
    };
  }, [from, opener]);

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  };

  return (
    <div className="tl-voile" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div role="dialog" aria-modal="true" aria-labelledby="tl-piece" className="tl-sheet">
        <div ref={card} className={cn("tl-carte", back && "tl-retourne")}>
          <div className="tl-face">
            <ProductImage product={product} />
          </div>
          {second ? (
            <div className="tl-face tl-dos">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/boutique/${shopSlug}/photo/${second.id}?v=${second.version}`} alt="" className="absolute inset-0 size-full object-cover" />
            </div>
          ) : null}
        </div>
        <p className="tl-craie">{product.category || "Pièce"}</p>
        <h2 ref={title} tabIndex={-1} id="tl-piece" className="tl-serif text-[28px] leading-tight outline-none">
          {product.name}
        </h2>
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[20px] font-semibold tabular-nums">{formatFcfa(product.price)}</span>
          {second ? (
            <button type="button" onClick={() => setBack((b) => !b)} className="text-[14px] font-semibold underline underline-offset-4">
              {back ? "Voir la face" : "Voir le dos"}
            </button>
          ) : null}
        </div>
        {product.description ? <p className="tl-muted text-[14.5px]">{product.description}</p> : null}
        <StockHint product={product} className="tl-craie-txt text-[13px] font-semibold" />
        {product.in_stock && room > 0 ? (
          <button
            type="button"
            className="tl-encre min-h-12 rounded-xl text-[15.5px] font-bold"
            onClick={() => {
              props.onChange(product, inCart + 1);
              flyToCart(card.current);
              onClose();
            }}
          >
            {inCart ? `Ajouter encore · ${inCart} au sac` : "Ajouter au sac"}
          </button>
        ) : (
          <p className="tl-card rounded-xl p-4 text-[14.5px] font-semibold">{product.in_stock ? "Tout le stock est déjà dans votre sac." : "Épuisé pour le moment."}</p>
        )}
        <button type="button" onClick={onClose} className="tl-ghost min-h-11 rounded-xl text-[14.5px] font-semibold">
          Retour au portant
        </button>
      </div>
    </div>
  );
}
