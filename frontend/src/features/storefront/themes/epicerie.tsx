"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { AddControl, accentOf, CartButton, deliveryGroups, Letters, paymentLine, ProductImage, Sections, StockHint, ThemeFooter, type ThemeProps, type Tone } from "./parts";
import { Scene } from "./scene";
import { WasPrice } from "../product-details";

const TONE: Tone = {
  muted: "text-encre-doux",
  card: "border-[1.5px] border-encre bg-white",
  line: "border-trait-clair",
  heading: "large text-[clamp(1.25rem,2.6vw,1.6rem)] font-black",
  button: "bg-encre text-creme",
  ghost: "border-[1.5px] border-encre bg-white text-encre shadow-[2px_2px_0_#17110a]",
};

/** Épicerie : on vient souvent, on connaît les produits, on veut commander vite (docs/chantier-p5.md §3.1). */
export function EpicerieTheme(props: ThemeProps) {
  const { shop, design, featured } = props;
  const accent = accentOf(shop);
  const facts = [
    ...deliveryGroups(shop).map((group) => `${group.where} : livrée sous ${group.hours} h, dès ${formatNumber(group.from)} F`),
    `Paiement : ${paymentLine(shop)}`,
  ];

  return (
    <div className="flex min-h-dvh flex-col bg-creme text-encre">
      <header className="sticky top-0 z-30 border-b-2 border-encre bg-creme/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 flex-col">
            <span className="large truncate text-xl leading-none font-black md:text-2xl">{shop.name}</span>
            <span className="text-[12.5px] text-encre-doux">
              {shop.city ? `${shop.city} · ` : ""}
              {shop.product_count} article{shop.product_count > 1 ? "s" : ""}
            </span>
          </div>
          <CartButton count={props.count} onCheckout={props.onCheckout} closed={props.closed} className="bg-encre text-creme" />
        </div>
      </header>

      <div role="note" aria-label={facts.join(". ")} className={cn("overflow-hidden border-b-2 border-encre", accent.disc)}>
        <div aria-hidden className="th-loop th-marquee flex w-max">
          {[...facts, ...facts].map((fact, index) => (
            <span key={index} className="inline-flex items-center gap-3 px-4 py-2.5 font-mono text-[12.5px] font-medium whitespace-nowrap">
              {fact}
              <span className="size-1.5 rounded-full bg-current" />
            </span>
          ))}
        </div>
      </div>

      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-8 px-4 pt-6 pb-32">
        <div className="flex flex-col gap-3">
          <h1 aria-label={shop.name} className="large text-[clamp(2rem,7vw,3.5rem)] leading-[0.95] font-black">
            {shop.name.split(" ").map((word, index) => (
              <Letters key={index} text={`${word} `} start={index * 300} step={45} />
            ))}
          </h1>
          {design.texts.tagline || shop.description ? (
            <p className="th-enter th-up max-w-[60ch] text-[15px] text-encre-doux" style={{ animationDelay: "500ms" }}>
              {design.texts.tagline || shop.description}
            </p>
          ) : null}
        </div>

        {featured ? (
          <section aria-labelledby="titre-une" className="th-enter th-up grid gap-4 rounded-[20px] border-[1.5px] border-encre bg-white p-3 shadow-[4px_4px_0_#17110a] sm:grid-cols-[minmax(0,220px)_1fr]" style={{ animationDelay: "650ms" }}>
            <div className="relative h-44 overflow-hidden rounded-[14px] sm:h-full sm:min-h-40">
              <ProductImage product={featured} />
            </div>
            <div className="flex flex-col gap-2 py-1">
              <p className="font-mono text-xs tracking-[0.1em] text-encre-doux uppercase">À la une</p>
              <h2 id="titre-une" className="large text-2xl leading-tight font-black">
                {featured.name}
              </h2>
              {featured.description ? <p className="text-[14px] text-encre-doux">{featured.description}</p> : null}
              <div className="mt-auto flex items-center justify-between gap-3 pt-2">
                <span className="large text-2xl font-black">{formatNumber(featured.price)} F</span>
                <WasPrice product={featured} />
                <AddControl product={featured} quantity={props.cart[featured.id] ?? 0} onChange={props.onChange} tone={TONE} />
              </div>
            </div>
          </section>
        ) : null}

        <Sections props={props} tone={TONE} collection={<EpicerieCollection {...props} />} />
      </main>

      <ThemeFooter shop={shop} tone={TONE} className="border-t-2 border-encre" />
    </div>
  );
}

function EpicerieCollection({ products, cart, onChange }: ThemeProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const categories = [...new Set(products.map((product) => product.category).filter(Boolean))];
  const needle = query.trim().toLocaleLowerCase("fr");
  const shown = products.filter((product) => (!category || product.category === category) && (!needle || product.name.toLocaleLowerCase("fr").includes(needle)));
  const groups = (category ? [category] : categories.length ? categories : [""]).map((name) => ({
    name,
    items: shown.filter((product) => !name || product.category === name),
  }));
  const uncategorised = categories.length ? shown.filter((product) => !product.category) : [];

  return (
    <section id="collection" aria-labelledby="titre-collection" className="flex scroll-mt-28 flex-col gap-4">
      <h2 id="titre-collection" className={TONE.heading}>
        Tout le magasin
      </h2>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="recherche-produit" className="text-[13px] font-semibold">
          Chercher un produit
        </label>
        <input
          id="recherche-produit"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="karité, café, savon…"
          className="min-h-12 rounded-[14px] border-[1.5px] border-encre bg-white px-4 text-base text-encre shadow-[3px_3px_0_#17110a] outline-none placeholder:text-[#6b5440] focus-visible:shadow-[0_0_0_3px_rgb(74_87_214/0.4)]"
        />
      </div>
      {categories.length > 1 ? (
        <div role="group" aria-label="Rayons" className="flex flex-wrap gap-2">
          {[null, ...categories].map((name) => {
            const count = products.filter((product) => !name || product.category === name).length;
            return (
              <button
                key={name ?? "tout"}
                type="button"
                aria-pressed={category === name}
                onClick={() => setCategory(name)}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-full border-[1.5px] border-encre bg-white px-4 text-[13px] font-bold aria-pressed:bg-encre aria-pressed:text-creme"
              >
                {name ?? "Tout"} <span className="font-mono text-[11px]">{count}</span>
              </button>
            );
          })}
        </div>
      ) : null}

      {shown.length === 0 ? <p className="rounded-[16px] border-[1.5px] border-dashed border-encre p-5 text-[15px]">Rien ne correspond. Essayez un autre mot.</p> : null}

      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <Scene key={group.name || "tout"} className="flex flex-col">
            {group.name ? (
              <div className="flex items-baseline justify-between pb-1.5">
                <h3 className="large text-xl font-black">{group.name}</h3>
                <span className="font-mono text-xs text-encre-doux">
                  {group.items.length} article{group.items.length > 1 ? "s" : ""}
                </span>
              </div>
            ) : null}
            <div aria-hidden className="th-reveal th-grow h-[3px] bg-encre" />
            <ul className="grid md:grid-cols-2 md:gap-x-8">
              {group.items.map((product, index) => (
                <Row key={product.id} product={product} index={index} quantity={cart[product.id] ?? 0} onChange={onChange} />
              ))}
            </ul>
          </Scene>
        ),
      )}
      {uncategorised.length ? (
        <ul className="grid md:grid-cols-2 md:gap-x-8">
          {uncategorised.map((product, index) => (
            <Row key={product.id} product={product} index={index} quantity={cart[product.id] ?? 0} onChange={onChange} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Row({ product, index, quantity, onChange }: { product: PublicProduct; index: number; quantity: number; onChange: ThemeProps["onChange"] }) {
  return (
    <li className="th-reveal th-slide flex items-center gap-3 border-b border-trait-clair py-3" style={{ animationDelay: `${Math.min(index, 8) * 70}ms` }}>
      <div className="relative size-16 shrink-0 overflow-hidden rounded-[12px] border-[1.5px] border-encre">
        <ProductImage product={product} />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-[15px] leading-snug font-bold">{product.name}</span>
        {product.description ? <span className="line-clamp-1 text-[13px] text-encre-doux">{product.description}</span> : null}
        <span className="flex items-baseline gap-2 pt-0.5">
          <span className="large text-[17px] font-black">{formatNumber(product.price)} F</span>
          <WasPrice product={product} className="text-xs" />
          <StockHint product={product} className="text-xs font-semibold text-[#5c3d00]" />
        </span>
      </div>
      <AddControl product={product} quantity={quantity} onChange={onChange} tone={TONE} />
    </li>
  );
}
