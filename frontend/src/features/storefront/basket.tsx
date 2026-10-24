"use client";

import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { type Line, Price, ProductArt, QuantityStepper } from "./catalogue";

export function articleCount(lines: Line[]) {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

export function subtotalOf(lines: Line[]) {
  return lines.reduce((sum, line) => sum + line.product.price * line.quantity, 0);
}

function articles(count: number) {
  return `${count} article${count > 1 ? "s" : ""}`;
}

/** Panier latéral (ordinateur). Sur téléphone, la barre flottante prend le relais. */
export function Basket({
  lines,
  onChange,
  onCheckout,
  checkingOut,
  closed = false,
}: {
  lines: Line[];
  onChange: (product: PublicProduct, quantity: number) => void;
  onCheckout: () => void;
  checkingOut: boolean;
  /** Boutique en congé : le panier se garde, mais on ne peut pas commander. */
  closed?: boolean;
}) {
  const count = articleCount(lines);
  return (
    <aside aria-label="Votre panier" className="verre-clair sticky top-24 hidden flex-col gap-4 rounded-[24px] p-4 lg:flex">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Votre panier</h2>
        <span className="rounded-full bg-[rgb(255_244_232/0.5)] px-2.5 py-1 text-xs font-semibold">{articles(count)}</span>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-trait-clair p-4 text-[13.5px] text-encre-doux">
          Votre panier est vide. Touchez « Ajouter » sur un article pour commencer.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {lines.map(({ product, quantity }) => (
            <li key={product.id} className="grid grid-cols-[40px_1fr] gap-x-2.5 gap-y-1.5 rounded-2xl bg-[rgb(255_244_232/0.4)] p-2">
              <div className="row-span-2 size-10 overflow-hidden rounded-[10px]">
                <ProductArt product={product} />
              </div>
              <p className="truncate text-[13px] font-semibold">
                {product.name}
                {product.availability === "preorder" ? <span className="font-normal text-[#2f3aa8]"> · précommande</span> : null}
              </p>
              <div className="flex items-center justify-between gap-2">
                <QuantityStepper quantity={quantity} max={product.max_quantity} onChange={(q) => onChange(product, q)} label={product.name} size="sm" />
                <span className="text-[13px] font-semibold whitespace-nowrap">{formatFcfa(product.price * quantity)}</span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-baseline justify-between border-t border-trait-clair pt-3">
        <span className="text-[13px] text-encre-doux">Sous-total</span>
        <Price value={subtotalOf(lines)} className="text-[28px]" />
      </div>
      <p className="-mt-2 text-xs text-encre-doux">Les frais de livraison dépendent de votre commune.</p>
      {checkingOut ? null : (
        <button type="button" disabled={lines.length === 0 || closed} onClick={onCheckout} className="bouton-nuit rounded-full px-5 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-40">
          {closed ? "Boutique en congé" : "Commander"}
        </button>
      )}
    </aside>
  );
}

/**
 * Barre flottante : total et bouton Commander, toujours à portée de pouce. Sur ordinateur, la vitrine
 * Essentiel a son panier latéral ; les autres thèmes gardent la barre (`always`).
 */
export function MobileBar({
  lines,
  onCheckout,
  closed = false,
  always = false,
  preview = false,
}: {
  lines: Line[];
  onCheckout: () => void;
  closed?: boolean;
  always?: boolean;
  /** Aperçu de « Ma boutique » : on ne commande pas. */
  preview?: boolean;
}) {
  const count = articleCount(lines);
  if (count === 0) return null;
  return (
    <div
      className={cn(
        "zone-sombre fixed inset-x-3 bottom-3 z-20 flex items-center justify-between gap-3 rounded-[22px] border border-white/15 bg-nuit/90 py-2.5 pr-2.5 pl-4 text-creme shadow-[0_14px_40px_rgb(0_0_0/0.35)] backdrop-blur-lg",
        always ? "mx-auto max-w-[560px]" : "lg:hidden",
      )}
    >
      <p className="flex flex-col leading-tight">
        <strong className="large text-lg font-extrabold">{formatFcfa(subtotalOf(lines))}</strong>
        <span className="text-xs text-texte-2">{articles(count)} · hors livraison</span>
      </p>
      <button type="button" onClick={onCheckout} disabled={closed || preview} className="bouton-nuit rounded-full px-5 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-50">
        {closed ? "En congé" : preview ? "Aperçu" : "Commander"}
      </button>
    </div>
  );
}
