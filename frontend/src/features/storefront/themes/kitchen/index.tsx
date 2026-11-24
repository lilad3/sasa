"use client";

import "./kitchen.css";

import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { flipFrom, flyToCart } from "../motion";
import { CartButton, ProductImage, Sections, StockHint, ThemeFooter, type ThemeProps, type Tone } from "../parts";
import { Universe, universeFrom, type UniverseLook, type UniverseOpen } from "../universe";

const display = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "800"], variable: "--kt-display" });
const text = Instrument_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--kt-text" });

const TONE: Tone = {
  muted: "kt-muted",
  card: "kt-card",
  line: "border-[var(--kt-filet)]",
  heading: "kt-heading",
  button: "kt-dark",
  ghost: "kt-ghost",
};

const LOOK: UniverseLook = { ink: "#f7e9d6", accent: "#f4b63f", onAccent: "#22140e", fallback: "#8c321b" };

type Course = { id: string; name: string; items: PublicProduct[] };

function buildMenu(products: PublicProduct[]): Course[] {
  const byName = new Map<string, PublicProduct[]>();
  for (const product of products) {
    const name = product.category.trim() || "La carte";
    byName.set(name, [...(byName.get(name) ?? []), product]);
  }
  return [...byName.entries()].map(([name, items], index) => ({ id: `carte-${index + 1}`, name, items }));
}

/** Kitchen : le plat en grand vu du dessus, le prix en chiffres dorés, la carte par rubrique. */
export function KitchenTheme(props: ThemeProps) {
  const { shop, products, featured, design } = props;
  const menu = useMemo(() => buildMenu(products), [products]);
  const [open, setOpen] = useState<{ product: PublicProduct; from: DOMRect; opener: HTMLElement } | null>(null);
  const [universe, setUniverse] = useState<UniverseOpen | null>(null);
  const names = products.filter((p) => p.in_stock).map((p) => p.name);
  const heroPlate = useRef<HTMLDivElement>(null);
  const inCartHero = featured ? (props.cart[featured.id] ?? 0) : 0;

  return (
    <div className={cn(display.variable, text.variable, "kt flex min-h-dvh flex-col")}>
      <header className="kt-head">
        <div className="mx-auto flex max-w-[1080px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="kt-display truncate text-[22px] leading-none">{shop.name}</span>
            <span className="kt-muted truncate text-[12.5px]">
              <span className={cn("kt-dot", props.closed && "kt-dot-off")} aria-hidden />
              {props.closed ? "En congé" : "Ouvert"}
              {shop.city ? ` · ${shop.city}` : ""}
            </span>
          </div>
          <span data-cart-target className="inline-flex">
            <CartButton count={props.count} onCheckout={props.onCheckout} closed={props.closed} className="kt-dark" />
          </span>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-[1080px] flex-col gap-10 pb-32">
        {featured ? (
          <section aria-labelledby="kt-jour" className="kt-hero">
            <div ref={heroPlate} className="kt-hero-plate" aria-hidden>
              <span className="kt-plate kt-plate-big">
                <ProductImage product={featured} />
              </span>
            </div>
            <div className="relative z-[1] flex max-w-[56%] flex-col gap-2 md:max-w-[50%]">
              <p className="kt-or text-[12px] font-bold tracking-[0.16em] uppercase">Le plat du jour</p>
              <h1 id="kt-jour" className="kt-display text-[clamp(2rem,7vw,3.6rem)] leading-[0.95]">
                {featured.name}
              </h1>
              <p className="kt-prix" aria-label={formatFcfa(featured.price)}>
                {formatNumber(featured.price)}
                <span>F</span>
              </p>
              {design.texts.tagline ? <p className="kt-muted text-[14.5px]">{design.texts.tagline}</p> : null}
              {featured.in_stock ? (
                <button
                  type="button"
                  className="kt-dark mt-2 min-h-12 self-start rounded-full px-5 text-[15px] font-bold"
                  onClick={() => {
                    if (inCartHero >= featured.max_quantity) return;
                    props.onChange(featured, inCartHero + 1);
                    flyToCart(heroPlate.current?.querySelector(".kt-plate") ?? null);
                  }}
                >
                  {inCartHero ? `Encore un · ${inCartHero} au panier` : "Commander ce plat"}
                </button>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="px-4 pt-6">
            <h1 className="kt-display text-[clamp(2rem,7vw,3.4rem)] leading-[0.95]">{shop.name}</h1>
            {shop.description ? <p className="kt-muted mt-2 max-w-[56ch]">{shop.description}</p> : null}
          </section>
        )}

        {names.length > 1 ? (
          <div className="kt-marquee" role="note" aria-label={`À la carte : ${names.join(", ")}`}>
            <div aria-hidden>
              {[...names, ...names].map((name, index) => (
                <span key={index}>
                  {name}
                  <i>✦</i>
                </span>
              ))}
            </div>
          </div>
        ) : null}

        <div className="px-4">
          <Sections props={props} tone={TONE} collection={<Menu menu={menu} props={props} onOpen={setOpen} onUniverse={setUniverse} />} />
        </div>
      </main>

      <ThemeFooter shop={shop} tone={TONE} className="kt-footer" />
      {open ? <DishSheet key={open.product.id} {...open} props={props} onClose={() => setOpen(null)} /> : null}
      {universe ? <Universe open={universe} products={products} props={props} look={LOOK} uncategorized="La carte" onClose={() => setUniverse(null)} /> : null}
    </div>
  );
}

function Menu({
  menu,
  props,
  onOpen,
  onUniverse,
}: {
  menu: Course[];
  props: ThemeProps;
  onOpen: (value: { product: PublicProduct; from: DOMRect; opener: HTMLElement }) => void;
  onUniverse: (value: UniverseOpen) => void;
}) {
  return (
    <section aria-labelledby="kt-carte" className="flex flex-col gap-5">
      <h2 id="kt-carte" className="kt-heading">
        La carte
      </h2>
      {menu.length > 1 ? (
        <nav aria-label="Rubriques" className="kt-chips">
          {menu.map((course) => (
            <button key={course.id} type="button" onClick={(e) => onUniverse(universeFrom(course.name, e.currentTarget))} className="kt-chip">
              {course.name}
            </button>
          ))}
        </nav>
      ) : null}
      {menu.map((course) => (
        <div key={course.id} id={course.id} className="flex scroll-mt-24 flex-col gap-3">
          <h3 className="kt-display text-[22px]">{course.name}</h3>
          <ul className="grid gap-3 md:grid-cols-2">
            {course.items.map((product) => {
              const quantity = props.cart[product.id] ?? 0;
              return (
                <li key={product.id} className={cn("kt-dish", !product.in_stock && "kt-dish-off")}>
                  <button
                    type="button"
                    className="kt-dish-open"
                    aria-label={`${product.name}, ${formatFcfa(product.price)}${product.in_stock ? "" : ", épuisé"}`}
                    onClick={(e) => {
                      const plate = e.currentTarget.querySelector<HTMLElement>(".kt-plate");
                      onOpen({ product, opener: e.currentTarget, from: (plate ?? e.currentTarget).getBoundingClientRect() });
                    }}
                  >
                    <span className="kt-plate">
                      <ProductImage product={product} />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1 text-left">
                      <b className="text-[16px] leading-tight">{product.name}</b>
                      {product.description ? <span className="kt-muted line-clamp-2 text-[13.5px]">{product.description}</span> : null}
                      <span className="kt-or kt-display text-[20px]">{formatFcfa(product.price)}</span>
                      {product.in_stock ? <StockHint product={product} className="text-[12px] font-semibold" /> : <span className="text-[12px] font-semibold">Épuisé</span>}
                    </span>
                  </button>
                  {product.in_stock ? (
                    quantity > 0 ? (
                      <div role="group" aria-label={`Quantité : ${product.name}`} className="kt-stepper">
                        <button type="button" onClick={() => props.onChange(product, quantity - 1)} aria-label={quantity === 1 ? `Retirer ${product.name}` : "Un de moins"}>
                          −
                        </button>
                        <output aria-live="polite">{quantity}</output>
                        <button type="button" onClick={() => props.onChange(product, quantity + 1)} disabled={quantity >= product.max_quantity} aria-label="Un de plus">
                          +
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="kt-plus"
                        aria-label={`Ajouter ${product.name}`}
                        onClick={(e) => {
                          props.onChange(product, 1);
                          flyToCart(e.currentTarget.closest("li")?.querySelector(".kt-plate") ?? null);
                        }}
                      >
                        +
                      </button>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}

function DishSheet({ product, from, opener, props, onClose }: { product: PublicProduct; from: DOMRect; opener: HTMLElement; props: ThemeProps; onClose: () => void }) {
  const plate = useRef<HTMLSpanElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const inCart = props.cart[product.id] ?? 0;
  const room = Math.max(0, product.max_quantity - inCart);
  const [quantity, setQuantity] = useState(Math.min(1, room));

  useEffect(() => {
    if (plate.current) flipFrom(plate.current, from, 600);
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
    flyToCart(plate.current);
    onClose();
  };

  return (
    <div className="kt-voile" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div role="dialog" aria-modal="true" aria-labelledby="kt-plat" className="kt-sheet">
        <span ref={plate} className="kt-plate kt-plate-sheet" aria-hidden>
          <ProductImage product={product} />
        </span>
        <h2 ref={title} tabIndex={-1} id="kt-plat" className="kt-display text-center text-[26px] leading-tight outline-none">
          {product.name}
        </h2>
        {product.description ? <p className="kt-muted text-center text-[14.5px]">{product.description}</p> : null}
        {product.in_stock && room > 0 ? (
          <>
            <div className="flex items-center justify-center gap-4">
              <div role="group" aria-label="Quantité" className="kt-stepper kt-stepper-big">
                <button type="button" onClick={() => setQuantity((q) => Math.max(1, q - 1))} aria-label="Un de moins">
                  −
                </button>
                <output aria-live="polite">{quantity}</output>
                <button type="button" onClick={() => setQuantity((q) => Math.min(room, q + 1))} disabled={quantity >= room} aria-label="Un de plus">
                  +
                </button>
              </div>
            </div>
            <button type="button" onClick={add} className="kt-gold min-h-13 rounded-full px-6 text-[16px] font-bold">
              Ajouter · {formatFcfa(product.price * quantity)}
            </button>
          </>
        ) : (
          <p className="kt-card rounded-2xl p-4 text-center text-[14.5px] font-semibold">{product.in_stock ? "Tout le stock disponible est déjà dans votre panier." : "Épuisé pour aujourd’hui."}</p>
        )}
        <button type="button" onClick={onClose} className="kt-ghost min-h-11 rounded-full text-[14.5px] font-semibold">
          Retour à la carte
        </button>
      </div>
    </div>
  );
}
