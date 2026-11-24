"use client";

import "./wardrobe.css";

import { Figtree, Syne } from "next/font/google";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { flipFrom, flyToCart, motionAllowed } from "../motion";
import { CartButton, ProductImage, Sections, StockHint, ThemeFooter, type ThemeProps, type Tone } from "../parts";

const display = Syne({ subsets: ["latin"], weight: ["700", "800"], variable: "--wd-display" });
const text = Figtree({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--wd-text" });

const TONE: Tone = {
  muted: "wd-muted",
  card: "wd-card",
  line: "border-[var(--wd-filet)]",
  heading: "wd-heading",
  button: "wd-encre",
  ghost: "wd-ghost",
};

type Open = { product: PublicProduct; from: DOMRect; opener: HTMLElement };
const STORY_MS = 5000;

function byCategory(products: PublicProduct[]) {
  const map = new Map<string, PublicProduct[]>();
  for (const p of products) {
    const name = p.category.trim() || "Nouveautés";
    map.set(name, [...(map.get(name) ?? []), p]);
  }
  return [...map.entries()].map(([name, items]) => ({ name, items }));
}

/** Wardrobe : le fil façon story, la cabine en arche où l'on compose sa tenue, la boutique en cartes. */
export function WardrobeTheme(props: ThemeProps) {
  const { shop, products } = props;
  const [open, setOpen] = useState<Open | null>(null);
  const groups = useMemo(() => byCategory(products), [products]);
  const [filter, setFilter] = useState<string>("Tout");
  const shown = filter === "Tout" ? products : (groups.find((g) => g.name === filter)?.items ?? []);
  const stories = useMemo(() => products.filter((p) => p.in_stock).slice(0, 6), [products]);

  return (
    <div className={cn(display.variable, text.variable, "wd flex min-h-dvh flex-col")}>
      <header className="wd-head">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="wd-display truncate text-[20px] leading-none sm:text-[24px]">{shop.name}</span>
            <span className="wd-muted truncate text-[12.5px]">{shop.city ? `${shop.city} · ` : ""}livraison partout à Abidjan</span>
          </div>
          <span data-cart-target className="inline-flex">
            <CartButton count={props.count} onCheckout={props.onCheckout} closed={props.closed} className="wd-encre" />
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-12 px-4 pt-4 pb-32">
        {stories.length ? <Stories items={stories} onOpen={setOpen} /> : null}
        {groups.length > 1 ? <Cabin groups={groups} props={props} /> : null}
        <Sections
          props={props}
          tone={TONE}
          collection={
            <section aria-labelledby="wd-boutique" className="flex flex-col gap-4">
              <div className="flex items-end justify-between gap-3">
                <h2 id="wd-boutique" className="wd-heading">
                  Toute la boutique
                </h2>
                <span className="wd-muted text-[13px]">
                  {shown.length} article{shown.length > 1 ? "s" : ""}
                </span>
              </div>
              <div className="wd-filtres" role="group" aria-label="Filtrer">
                {["Tout", ...groups.map((g) => g.name)].map((name) => (
                  <button key={name} type="button" aria-pressed={filter === name} onClick={() => setFilter(name)} className="wd-filtre">
                    {name}
                  </button>
                ))}
              </div>
              <ul className="wd-grille">
                {shown.map((product, index) => (
                  <li key={product.id}>
                    <button
                      type="button"
                      className={cn("wd-carte", index % 3 === 1 && "wd-carte-soleil")}
                      aria-label={`${product.name}, ${formatFcfa(product.price)}${product.in_stock ? "" : ", épuisé"}`}
                      onClick={(e) => {
                        const photo = e.currentTarget.querySelector<HTMLElement>(".wd-photo");
                        setOpen({ product, opener: e.currentTarget, from: (photo ?? e.currentTarget).getBoundingClientRect() });
                      }}
                    >
                      <span className="wd-photo">
                        <ProductImage product={product} />
                        {props.cart[product.id] ? <span className="wd-pastille">{props.cart[product.id]}</span> : null}
                      </span>
                      <span className="line-clamp-2 text-[14.5px] leading-tight font-semibold">{product.name}</span>
                      <span className="wd-display text-[17px]">{formatNumber(product.price)} F</span>
                      {product.in_stock ? <StockHint product={product} className="wd-cerise text-[12px] font-semibold" /> : <span className="text-[12px] font-semibold">Épuisé</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          }
        />
      </main>

      <ThemeFooter shop={shop} tone={TONE} className="wd-footer" />
      {open ? <PieceSheet key={open.product.id} {...open} props={props} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** Le fil façon story : une pièce toutes les 5 s (les vidéos de 10 s prendront cette place), on touche pour passer. */
function Stories({ items, onOpen }: { items: PublicProduct[]; onOpen: (value: Open) => void }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const current = items[index % items.length];

  useEffect(() => {
    if (paused || !motionAllowed(stage.current)) return;
    const timer = setTimeout(() => setIndex((i) => (i + 1) % items.length), STORY_MS);
    return () => clearTimeout(timer);
  }, [index, paused, items.length]);

  if (!current) return null;
  const word = current.category.trim() || "Nouveauté";
  return (
    <section aria-label="Les nouveautés en story" className="wd-story">
      <div className="wd-barres" aria-hidden>
        {items.map((p, i) => (
          <span key={p.id} className={cn(i < index && "wd-barre-vue")}>
            {i === index ? <i key={`${index}-${paused}`} className={cn(paused && "wd-pause")} style={{ animationDuration: `${STORY_MS}ms` }} /> : null}
          </span>
        ))}
      </div>
      <div
        ref={stage}
        className="wd-scene"
        onPointerDown={() => setPaused(true)}
        onPointerUp={() => setPaused(false)}
        onPointerLeave={() => setPaused(false)}
      >
        <p aria-hidden className="wd-mot">
          {word}
        </p>
        <div key={current.id} className="wd-story-photo">
          <ProductImage product={current} />
        </div>
        <button type="button" className="wd-zone wd-zone-g" aria-label="Story précédente" onClick={() => setIndex((i) => (i - 1 + items.length) % items.length)} />
        <button type="button" className="wd-zone wd-zone-d" aria-label="Story suivante" onClick={() => setIndex((i) => (i + 1) % items.length)} />
      </div>
      <div className="wd-story-info">
        <div className="min-w-0">
          <p className="truncate text-[15px] font-semibold">{current.name}</p>
          <p className="wd-display text-[18px]">{formatFcfa(current.price)}</p>
        </div>
        <button
          type="button"
          className="wd-encre min-h-11 shrink-0 rounded-full px-4 text-[14px] font-bold"
          onClick={(e) => {
            const photo = stage.current?.querySelector<HTMLElement>(".wd-story-photo");
            onOpen({ product: current, opener: e.currentTarget, from: (photo ?? e.currentTarget).getBoundingClientRect() });
          }}
        >
          Voir l’article
        </button>
      </div>
    </section>
  );
}

/**
 * La cabine en arche : une pièce par rayon, le rideau s'ouvre sur la tenue composée, puis tout part au panier.
 * Le mannequin qui porte la tenue viendra avec les photos détourées (étape serveur).
 */
function Cabin({ groups, props }: { groups: { name: string; items: PublicProduct[] }[]; props: ThemeProps }) {
  const slots = groups.slice(0, 4);
  const [slot, setSlot] = useState(0);
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [curtain, setCurtain] = useState(0);
  const board = useRef<HTMLDivElement>(null);
  const chosen = slots.flatMap((g) => g.items.filter((p) => p.id === picked[g.name] && p.in_stock));
  const total = chosen.reduce((sum, p) => sum + p.price, 0);
  const active = slots[slot];

  const pick = (group: string, id: string) => {
    setPicked((current) => ({ ...current, [group]: current[group] === id ? "" : id }));
    setCurtain((n) => n + 1);
  };
  const addAll = () => {
    for (const p of chosen) {
      const inCart = props.cart[p.id] ?? 0;
      if (inCart < p.max_quantity) props.onChange(p, inCart + 1);
    }
    board.current?.querySelectorAll<HTMLElement>(".wd-piece").forEach((el, i) => setTimeout(() => flyToCart(el), i * 120));
  };

  return (
    <section aria-labelledby="wd-cabine" className="wd-cabine">
      <h2 id="wd-cabine" className="wd-titre-cabine">
        Essayer <span>le look</span>
      </h2>
      <div className="wd-arche">
        <div key={curtain} className="wd-rideau" aria-hidden />
        <div ref={board} className="wd-tenue" aria-live="polite">
          {chosen.length === 0 ? (
            <p className="wd-muted px-6 text-center text-[14px]">Choisissez une pièce dans chaque rayon : la tenue apparaît ici.</p>
          ) : (
            chosen.map((p, i) => (
              <span key={p.id} className="wd-piece" style={{ animationDelay: `${i * 90}ms` }}>
                <ProductImage product={p} />
              </span>
            ))
          )}
        </div>
      </div>
      <div className="wd-onglets" role="tablist" aria-label="Rayons de la cabine">
        {slots.map((g, i) => (
          <button key={g.name} type="button" role="tab" aria-selected={i === slot} onClick={() => setSlot(i)} className="wd-onglet">
            <span className={cn("wd-point", picked[g.name] && "wd-point-plein")} aria-hidden />
            {g.name}
          </button>
        ))}
      </div>
      {active ? (
        <ul className="wd-choix" role="tabpanel" aria-label={active.name}>
          {active.items.map((p) => (
            <li key={p.id}>
              <button type="button" aria-pressed={picked[active.name] === p.id} disabled={!p.in_stock} onClick={() => pick(active.name, p.id)} className="wd-mini">
                <span className="wd-mini-photo">
                  <ProductImage product={p} />
                </span>
                <span className="line-clamp-1 text-[12.5px] font-semibold">{p.name}</span>
                <span className="text-[12px]">{formatNumber(p.price)} F</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button type="button" onClick={addAll} disabled={chosen.length === 0} className="wd-cerise-btn min-h-13 w-full rounded-full px-5 text-[15.5px] font-bold">
        {chosen.length ? `Ajouter toute la tenue · ${formatFcfa(total)}` : "Ajouter toute la tenue"}
      </button>
    </section>
  );
}

function PieceSheet({ product, from, opener, props, onClose }: Open & { props: ThemeProps; onClose: () => void }) {
  const photo = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const inCart = props.cart[product.id] ?? 0;
  const room = Math.max(0, product.max_quantity - inCart);

  useEffect(() => {
    if (photo.current) flipFrom(photo.current, from, 560);
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
    <div className="wd-voile" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div role="dialog" aria-modal="true" aria-labelledby="wd-piece" className="wd-sheet">
        <div ref={photo} className="wd-sheet-photo">
          <ProductImage product={product} />
          <button type="button" onClick={onClose} className="wd-fermer">
            Fermer
          </button>
        </div>
        <div className="flex items-start justify-between gap-3">
          <h2 ref={title} tabIndex={-1} id="wd-piece" className="wd-display text-[24px] leading-tight outline-none">
            {product.name}
          </h2>
          <span className="wd-display shrink-0 text-[20px]">{formatFcfa(product.price)}</span>
        </div>
        {product.description ? <p className="wd-muted text-[14.5px]">{product.description}</p> : null}
        <StockHint product={product} className="wd-cerise text-[13px] font-semibold" />
        {product.in_stock && room > 0 ? (
          <button
            type="button"
            className="wd-cerise-btn min-h-13 rounded-full text-[16px] font-bold"
            onClick={() => {
              props.onChange(product, inCart + 1);
              flyToCart(photo.current);
              onClose();
            }}
          >
            {inCart ? `Ajouter encore · ${inCart} au panier` : "Ajouter au panier"}
          </button>
        ) : (
          <p className="wd-card rounded-2xl p-4 text-[14.5px] font-semibold">{product.in_stock ? "Tout le stock est déjà dans votre panier." : "Épuisé pour le moment."}</p>
        )}
      </div>
    </div>
  );
}
