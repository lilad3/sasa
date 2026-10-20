"use client";

import { useState } from "react";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { Accent, PublicProduct } from "@/lib/types";

import { ACCENTS, CATEGORY_ART, DEFAULT_ART } from "./accent";

export type Line = { product: PublicProduct; quantity: number };

/** Prix en deux tons : le montant en avant, l'unité en retrait. */
export function Price({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("chiffres whitespace-nowrap", className)}>
      {formatNumber(value)}
      <span className="ml-1 text-[0.55em] font-medium text-encre-doux">F</span>
    </span>
  );
}

/** Photo du produit, ou un visuel aux couleurs de son rayon quand le marchand n'en a pas mis. */
export function ProductArt({ product, className }: { product: PublicProduct; className?: string }) {
  if (product.image_url) {
    return (
      // Les photos viennent de n'importe quel hébergeur choisi par le marchand : pas de next/image (domaines inconnus).
      // eslint-disable-next-line @next/next/no-img-element
      <img src={product.image_url} alt="" loading="lazy" className={cn("size-full object-cover", className)} />
    );
  }
  return (
    <div aria-hidden className={cn("relative size-full overflow-hidden bg-gradient-to-br", CATEGORY_ART[product.category] ?? DEFAULT_ART, className)}>
      <div className="vit-flutes absolute inset-0" />
      <span className="large absolute right-3 -bottom-4 text-[110px] leading-none font-extrabold text-white/25">
        {product.name.trim().charAt(0).toUpperCase()}
      </span>
    </div>
  );
}

export function QuantityStepper({
  quantity,
  max,
  onChange,
  label,
  size = "md",
}: {
  quantity: number;
  max: number;
  onChange: (quantity: number) => void;
  label: string;
  size?: "sm" | "md";
}) {
  const button = cn(
    "grid place-items-center rounded-full border border-trait-clair bg-white font-bold transition-colors hover:bg-creme-2 disabled:cursor-not-allowed disabled:opacity-40",
    size === "sm" ? "size-7 text-sm" : "size-9",
  );
  return (
    <div className="inline-flex items-center gap-1.5" role="group" aria-label={`Quantité : ${label}`}>
      <button type="button" className={button} onClick={() => onChange(quantity - 1)} aria-label={quantity === 1 ? `Retirer ${label} du panier` : "Une de moins"}>
        −
      </button>
      <output className="chiffres min-w-[2ch] text-center text-base font-normal" aria-live="polite">
        {quantity}
      </output>
      <button type="button" className={button} onClick={() => onChange(quantity + 1)} disabled={quantity >= max} aria-label="Une de plus">
        +
      </button>
    </div>
  );
}

type Sort = "rayon" | "prix-croissant" | "prix-decroissant";

export function Collection({
  products,
  description,
  accent,
  quantities,
  onChange,
}: {
  products: PublicProduct[];
  description: string;
  accent: Accent;
  quantities: Readonly<Record<string, number>>;
  onChange: (product: PublicProduct, quantity: number) => void;
}) {
  const [category, setCategory] = useState<string>("tout");
  const [sort, setSort] = useState<Sort>("rayon");
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))];

  const shown = products
    .filter((p) => category === "tout" || p.category === category)
    .toSorted((a, b) => (sort === "prix-croissant" ? a.price - b.price : sort === "prix-decroissant" ? b.price - a.price : 0));

  return (
    <section id="collection" aria-labelledby="collection-titre" className="flex scroll-mt-24 flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex max-w-[60ch] flex-col gap-1.5">
          <p className="font-mono text-xs tracking-[0.08em] text-encre-doux uppercase">
            Catalogue · {products.length} article{products.length > 1 ? "s" : ""}
          </p>
          <h2 id="collection-titre" className="large text-[clamp(1.5rem,3vw,2rem)] font-bold">
            Toute la collection
          </h2>
          {description ? <p className="text-encre-doux">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {categories.length > 1 ? (
            <div className="flex gap-1 rounded-2xl border border-trait-clair bg-white p-1" role="group" aria-label="Filtrer par rayon">
              {["tout", ...categories].map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                  className="rounded-xl px-3 py-1.5 text-[13px] font-semibold text-encre-doux aria-pressed:bg-encre aria-pressed:text-creme"
                >
                  {c === "tout" ? "Tout" : c}
                </button>
              ))}
            </div>
          ) : null}
          <label className="sr-only" htmlFor="tri">
            Trier
          </label>
          <select
            id="tri"
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className="rounded-2xl border border-trait-clair bg-white px-3 py-2.5 text-[13px] font-semibold"
          >
            <option value="rayon">Par rayon</option>
            <option value="prix-croissant">Prix croissant</option>
            <option value="prix-decroissant">Prix décroissant</option>
          </select>
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="rounded-[20px] border border-dashed border-trait-clair p-6 text-encre-doux">Aucun article dans ce rayon pour le moment.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((product) => (
            <li key={product.id}>
              <ProductCard product={product} accent={accent} quantity={quantities[product.id] ?? 0} onChange={(q) => onChange(product, q)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProductCard({
  product,
  accent,
  quantity,
  onChange,
}: {
  product: PublicProduct;
  accent: Accent;
  quantity: number;
  onChange: (quantity: number) => void;
}) {
  return (
    <article className="flex h-full flex-col overflow-hidden rounded-[22px] border border-trait-clair bg-white p-2">
      <div className="relative h-[200px] overflow-hidden rounded-[16px]">
        <ProductArt product={product} />
        {product.category ? (
          <span className="absolute bottom-2.5 left-2.5 rounded-full bg-encre/70 px-2.5 py-1 text-xs font-semibold text-creme backdrop-blur">
            {product.category}
          </span>
        ) : null}
      </div>
      <div className="flex flex-1 flex-col gap-2 px-2 pt-3 pb-1.5">
        <h3 className="text-[15px] leading-snug font-semibold">{product.name}</h3>
        {product.description ? <p className="line-clamp-2 text-[13px] text-encre-doux">{product.description}</p> : null}
        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          <div className="flex flex-col gap-0.5">
            <Price value={product.price} className="text-[26px]" />
            <StockNote product={product} />
          </div>
          {!product.in_stock ? null : quantity > 0 ? (
            <QuantityStepper quantity={quantity} max={product.max_quantity} onChange={onChange} label={product.name} />
          ) : (
            <button
              type="button"
              onClick={() => onChange(1)}
              className={cn("rounded-full px-4 py-2.5 text-sm font-bold whitespace-nowrap", ACCENTS[accent].button)}
              aria-label={`Ajouter ${product.name} au panier`}
            >
              Ajouter
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function StockNote({ product }: { product: PublicProduct }) {
  if (!product.in_stock) return <span className="text-xs font-semibold text-[#b23a26]">Épuisé</span>;
  if (product.low_stock) return <span className="text-xs font-semibold text-[#7d5300]">Plus que quelques pièces</span>;
  return <span className="text-xs text-[#2c6a14]">En stock</span>;
}
