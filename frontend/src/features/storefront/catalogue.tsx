"use client";

import { type CSSProperties, useState } from "react";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { CATEGORY_ART, DEFAULT_ART } from "./accent";

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
    "bouton-nuit grid place-items-center rounded-full font-bold disabled:cursor-not-allowed disabled:opacity-40",
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

const SORTS: { value: Sort; label: string; spoken: string }[] = [
  { value: "rayon", label: "Par rayon", spoken: "Trier par rayon" },
  { value: "prix-croissant", label: "Prix ↑", spoken: "Prix croissant" },
  { value: "prix-decroissant", label: "Prix ↓", spoken: "Prix décroissant" },
];

export function Collection({
  products,
  description,
  quantities,
  onChange,
}: {
  products: PublicProduct[];
  description: string;
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
          <p className="font-mono text-xs tracking-[0.08em] text-encre uppercase">
            Catalogue · {products.length} article{products.length > 1 ? "s" : ""}
          </p>
          <h2 id="collection-titre" className="large text-[clamp(1.5rem,3vw,2rem)] font-bold">
            Toute la collection
          </h2>
          {description ? <p className="text-encre">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {categories.length > 1 ? (
            <div className="verre-clair flex gap-1 rounded-2xl p-1" role="group" aria-label="Filtrer par rayon">
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
          {/* Trois choix seulement : des boutons plutôt qu'une liste native, grise et carrée sur l'orange. */}
          <div className="verre-clair flex gap-1 rounded-2xl p-1" role="group" aria-label="Trier les articles">
            {SORTS.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={sort === option.value}
                aria-label={option.spoken}
                onClick={() => setSort(option.value)}
                className="rounded-xl px-3 py-1.5 text-[13px] font-semibold text-encre-doux aria-pressed:bg-encre aria-pressed:text-creme"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {shown.length === 0 ? (
        <p className="rounded-[20px] border border-dashed border-trait-clair p-6 text-encre">Aucun article dans ce rayon pour le moment.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((product, index) => (
            <li key={product.id}>
              <ProductCard product={product} index={index} quantity={quantities[product.id] ?? 0} onChange={(q) => onChange(product, q)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ProductCard({
  product,
  index,
  quantity,
  onChange,
}: {
  product: PublicProduct;
  /** Rang dans la grille : décale la lueur de chaque bouton, pour qu'ils ne bougent pas tous ensemble. */
  index: number;
  quantity: number;
  onChange: (quantity: number) => void;
}) {
  return (
    <article className="verre-clair flex h-full flex-col overflow-hidden rounded-[22px] p-2">
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
              className="bouton-nuit rounded-full px-4 py-2.5 text-sm font-bold whitespace-nowrap"
              style={{ "--decalage": index * 1.3 } as CSSProperties}
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
  // Couleurs foncées exprès : sur la vitre orangée, il faut 4,5:1 (l'indigo, l'ocre et le rouge habituels n'y arrivent pas).
  if (!product.in_stock) return <span className="text-xs font-semibold text-[#8a2412]">Épuisé</span>;
  if (product.low_stock) return <span className="text-xs font-semibold text-[#5c3d00]">Plus que quelques pièces</span>;
  return <span className="text-xs text-[#2f3aa8]">En stock</span>;
}
