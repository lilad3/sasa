"use client";

import "./market.css";

import { Barlow, Big_Shoulders } from "next/font/google";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { flipFrom, flyToCart, fold } from "../motion";
import { CartButton, ProductImage, Sections, StockHint, ThemeFooter, type ThemeProps, type Tone } from "../parts";

const enseigne = Big_Shoulders({ subsets: ["latin"], weight: ["700", "900"], variable: "--mk-enseigne" });
const texte = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--mk-texte" });

const TONE: Tone = {
  muted: "mk-muted",
  card: "mk-card",
  line: "border-[var(--mk-filet)]",
  heading: "mk-heading",
  button: "mk-button",
  ghost: "mk-ghost",
};

type Aisle = { id: string; name: string; items: PublicProduct[] };

/** Les rayons : une catégorie du marchand = un rayon, dans l'ordre où ils apparaissent. */
function buildAisles(products: PublicProduct[]): Aisle[] {
  const byName = new Map<string, PublicProduct[]>();
  for (const product of products) {
    const name = product.category.trim() || "Divers";
    byName.set(name, [...(byName.get(name) ?? []), product]);
  }
  return [...byName.entries()].map(([name, items], index) => ({ id: `rayon-${index + 1}`, name, items }));
}

/**
 * Market (« Un peu de tout ») : la recherche d'abord, des rayons à parcourir comme une allée,
 * des étiquettes de prix accrochées sous les tablettes et le carton qui se remplit.
 */
export function MarketTheme(props: ThemeProps) {
  const { shop, products } = props;
  const aisles = useMemo(() => buildAisles(products), [products]);
  const [aisleId, setAisleId] = useState(aisles[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<{ product: PublicProduct; from: DOMRect; opener: HTMLElement } | null>(null);
  const aisle = aisles.find((a) => a.id === aisleId) ?? aisles[0];

  const words = fold(query.trim());
  const results = useMemo(
    () => (words ? products.filter((p) => fold(`${p.name} ${p.category} ${p.description}`).includes(words)) : []),
    [products, words],
  );

  const [first, ...rest] = shop.name.trim().split(" ");

  return (
    <div className={cn(enseigne.variable, texte.variable, "mk flex min-h-dvh flex-col")}>
      <div aria-hidden className="mk-lumiere" />
      <header className="mk-head">
        <div className="mx-auto flex max-w-[1180px] items-start justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="mk-enseigne truncate text-[clamp(1.7rem,6vw,2.6rem)] leading-[0.9]">
              {first} {rest.length ? <span className="mk-orange">{rest.join(" ")}</span> : null}
            </span>
            <span className="mk-muted truncate text-[13px]">
              {shop.description || "Boutique"}
              {shop.city ? ` · ${shop.city}` : ""}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={cn("mk-badge hidden sm:inline-flex", props.closed && "mk-badge-off")}>{props.closed ? "En congé" : "Ouvert"}</span>
            <span data-cart-target className="inline-flex">
              <CartButton count={props.count} onCheckout={props.onCheckout} closed={props.closed} className="mk-button" />
            </span>
          </div>
        </div>
      </header>

      <main className="relative mx-auto flex w-full max-w-[1180px] flex-col gap-10 px-4 pt-4 pb-32">
        <Search query={query} onQuery={setQuery} results={results} onPick={(product, opener) => setOpen({ product, opener, from: opener.getBoundingClientRect() })} />
        <Sections
          props={props}
          tone={TONE}
          collection={
            words ? (
              <Shelves title={`Résultats pour « ${query.trim()} »`} kicker={`${results.length} article${results.length > 1 ? "s" : ""}`} items={results} props={props} onOpen={setOpen} />
            ) : (
              <section aria-labelledby="titre-rayons" className="flex flex-col gap-5">
                <h2 id="titre-rayons" className="sr-only">
                  Les rayons
                </h2>
                <nav aria-label="Rayons" className="mk-panneaux">
                  {aisles.map((a, index) => (
                    <button key={a.id} type="button" aria-pressed={a.id === aisle?.id} onClick={() => setAisleId(a.id)} className="mk-panneau">
                      <b>{index + 1}</b>
                      <span>{a.name}</span>
                    </button>
                  ))}
                </nav>
                {aisle ? (
                  <Shelves
                    key={aisle.id}
                    title={aisle.name}
                    kicker={`Rayon ${aisles.indexOf(aisle) + 1}`}
                    items={aisle.items}
                    props={props}
                    onOpen={setOpen}
                    wall
                  />
                ) : (
                  <p className="mk-muted">Les rayons se remplissent bientôt.</p>
                )}
              </section>
            )
          }
        />
      </main>

      <ThemeFooter shop={shop} tone={TONE} className="mk-footer" />
      {open ? <ProductSheet key={open.product.id} {...open} props={props} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Search({
  query,
  onQuery,
  results,
  onPick,
}: {
  query: string;
  onQuery: (value: string) => void;
  results: PublicProduct[];
  onPick: (product: PublicProduct, opener: HTMLElement) => void;
}) {
  const [focused, setFocused] = useState(false);
  const suggestions = results.slice(0, 6);
  const show = focused && query.trim().length > 0 && suggestions.length > 0;
  return (
    <div className="relative" role="search">
      <label htmlFor="mk-recherche" className="sr-only">
        Chercher un article
      </label>
      <div className="mk-search">
        <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          id="mk-recherche"
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          placeholder="Ciment, peinture, ampoule…"
          autoComplete="off"
          enterKeyHint="search"
          className="min-w-0 flex-1 bg-transparent text-[16px] outline-none placeholder:text-[var(--mk-gris)]"
        />
        {query ? (
          <button type="button" onClick={() => onQuery("")} aria-label="Effacer la recherche" className="grid size-9 place-items-center rounded-full text-lg">
            ×
          </button>
        ) : null}
      </div>
      {show ? (
        <ul className="mk-sugg" aria-label="Suggestions">
          {suggestions.map((product) => (
            <li key={product.id}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={(e) => onPick(product, e.currentTarget)} className="mk-sugg-item">
                <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-[var(--mk-nuit-3)]">
                  <ProductImage product={product} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col text-left">
                  <b className="truncate">{product.name}</b>
                  <span className="mk-muted truncate text-[13px]">{product.category || "Divers"}</span>
                </span>
                <span className="mk-enseigne text-xl">{formatNumber(product.price)} F</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Shelves({
  title,
  kicker,
  items,
  props,
  onOpen,
  wall = false,
}: {
  title: string;
  kicker: string;
  items: PublicProduct[];
  props: ThemeProps;
  onOpen: (value: { product: PublicProduct; from: DOMRect; opener: HTMLElement }) => void;
  wall?: boolean;
}) {
  return (
    <div className="mk-allee">
      {wall ? (
        <p aria-hidden className="mk-mur">
          {title}
        </p>
      ) : null}
      <div className="relative flex flex-wrap items-end justify-between gap-2">
        <h3 className="mk-enseigne text-[clamp(1.6rem,5vw,2.4rem)] leading-none uppercase">
          <span className="mk-orange">{kicker}</span> <span>{title}</span>
        </h3>
      </div>
      {items.length === 0 ? (
        <p className="mk-muted relative">Aucun article ne correspond. Essayez un autre mot.</p>
      ) : (
        <ul className="mk-etagere">
          {items.map((product) => {
            const inCart = props.cart[product.id] ?? 0;
            return (
              <li key={product.id} className="mk-case">
                <button
                  type="button"
                  className="mk-article"
                  onClick={(e) => {
                    const img = e.currentTarget.querySelector<HTMLElement>("[data-mk-photo]");
                    onOpen({ product, opener: e.currentTarget, from: (img ?? e.currentTarget).getBoundingClientRect() });
                  }}
                  aria-label={`${product.name}, ${formatFcfa(product.price)}${product.in_stock ? "" : ", épuisé"}`}
                >
                  <span data-mk-photo className="mk-photo">
                    <ProductImage product={product} />
                    {inCart ? <span className="mk-dans">{inCart} au carton</span> : null}
                  </span>
                  <span className="mk-tablette" aria-hidden />
                  <span className={cn("mk-etiquette", !product.in_stock && "mk-etiquette-off")}>
                    <span className="line-clamp-2 text-[13.5px] leading-tight font-semibold">{product.name}</span>
                    <span className="mk-enseigne text-[26px] leading-none">
                      {formatNumber(product.price)}
                      <small className="ml-1 font-[var(--mk-texte)] text-[12px] font-semibold">F</small>
                    </span>
                    {product.in_stock ? <StockHint product={product} className="mk-ocre text-[12px] font-semibold" /> : <span className="text-[12px] font-semibold">Épuisé</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const STEPS = [1, 5, 10, 20];

function ProductSheet({
  product,
  from,
  opener,
  props,
  onClose,
}: {
  product: PublicProduct;
  from: DOMRect;
  opener: HTMLElement;
  props: ThemeProps;
  onClose: () => void;
}) {
  const photo = useRef<HTMLDivElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const inCart = props.cart[product.id] ?? 0;
  const room = Math.max(0, product.max_quantity - inCart);
  const [quantity, setQuantity] = useState(Math.min(1, room));

  useEffect(() => {
    if (photo.current) flipFrom(photo.current, from);
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

  const add = () => {
    if (quantity < 1) return;
    props.onChange(product, inCart + quantity);
    flyToCart(photo.current);
    onClose();
  };

  return (
    <div className="mk-voile" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div role="dialog" aria-modal="true" aria-labelledby="mk-fiche-titre" className="mk-feuille">
        <span aria-hidden className="mk-poignee" />
        <div className="flex gap-4">
          <div ref={photo} className="mk-fiche-photo">
            <ProductImage product={product} />
          </div>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="mk-orange mk-enseigne text-sm tracking-[0.08em] uppercase">{product.category || "Divers"}</p>
            <h2 ref={title} tabIndex={-1} id="mk-fiche-titre" className="text-[19px] leading-tight font-bold outline-none">
              {product.name}
            </h2>
            <StockHint product={product} className="mk-ocre text-[13px] font-semibold" />
            {inCart ? <span className="mk-muted text-[13px]">Déjà {inCart} dans le carton</span> : null}
          </div>
        </div>
        {product.description ? <p className="mk-muted text-[14.5px]">{product.description}</p> : null}

        {product.in_stock && room > 0 ? (
          <>
            <fieldset className="flex flex-col gap-2">
              <legend className="mk-muted mb-1 text-[12px] font-semibold tracking-[0.12em] uppercase">Quantité</legend>
              <div className="flex flex-wrap gap-2">
                {STEPS.filter((step) => step <= room).map((step) => (
                  <button key={step} type="button" aria-pressed={quantity === step} onClick={() => setQuantity(step)} className="mk-qte">
                    {step}
                  </button>
                ))}
                <label className="mk-qte-autre">
                  <span className="mk-muted text-[13px]">Autre</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={room}
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Math.min(room, Number(e.target.value) || 1)))}
                    className="w-16 bg-transparent text-center text-[16px] outline-none"
                  />
                </label>
              </div>
            </fieldset>
            <div className="flex items-center justify-between gap-3">
              <span className="mk-enseigne text-[34px] leading-none">{formatFcfa(product.price * quantity)}</span>
              <button type="button" onClick={add} className="mk-button min-h-12 rounded-2xl px-5 text-[15px] font-bold">
                Mettre dans le carton
              </button>
            </div>
          </>
        ) : (
          <p className="mk-card rounded-2xl p-4 text-[14.5px] font-semibold">
            {product.in_stock ? "Vous avez déjà tout le stock disponible dans votre carton." : "Épuisé pour le moment."}
          </p>
        )}
        <button type="button" onClick={onClose} className="mk-ghost min-h-11 rounded-2xl text-[14.5px] font-semibold">
          Revenir au rayon
        </button>
      </div>
    </div>
  );
}
