"use client";

import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import type { Accent, PublicProduct } from "@/lib/types";

import { ACCENTS } from "./accent";
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
  accent,
  onChange,
  onCheckout,
  checkingOut,
}: {
  lines: Line[];
  accent: Accent;
  onChange: (product: PublicProduct, quantity: number) => void;
  onCheckout: () => void;
  checkingOut: boolean;
}) {
  const count = articleCount(lines);
  return (
    <aside aria-label="Votre panier" className="sticky top-24 hidden flex-col gap-4 rounded-[24px] border border-trait-clair bg-white p-4 lg:flex">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Votre panier</h2>
        <span className="rounded-full bg-creme-2 px-2.5 py-1 text-xs font-semibold">{articles(count)}</span>
      </div>

      {lines.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-trait-clair p-4 text-[13.5px] text-encre-doux">
          Votre panier est vide. Touchez « Ajouter » sur un article pour commencer.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {lines.map(({ product, quantity }) => (
            <li key={product.id} className="grid grid-cols-[40px_1fr] gap-x-2.5 gap-y-1.5 rounded-2xl bg-creme p-2">
              <div className="row-span-2 size-10 overflow-hidden rounded-[10px]">
                <ProductArt product={product} />
              </div>
              <p className="truncate text-[13px] font-semibold">{product.name}</p>
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
        <button type="button" disabled={lines.length === 0} onClick={onCheckout} className={cn("rounded-full px-5 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-40", ACCENTS[accent].button)}>
          Commander
        </button>
      )}
    </aside>
  );
}

/** Barre flottante sur téléphone : total et bouton Commander, toujours à portée de pouce. */
export function MobileBar({ lines, accent, onCheckout }: { lines: Line[]; accent: Accent; onCheckout: () => void }) {
  const count = articleCount(lines);
  if (count === 0) return null;
  return (
    <div className="fixed inset-x-3 bottom-3 z-20 flex items-center justify-between gap-3 rounded-[22px] border border-white/15 bg-nuit/90 py-2.5 pr-2.5 pl-4 text-creme shadow-[0_14px_40px_rgb(0_0_0/0.35)] backdrop-blur-lg lg:hidden">
      <p className="flex flex-col leading-tight">
        <strong className="large text-lg font-extrabold">{formatFcfa(subtotalOf(lines))}</strong>
        <span className="text-xs text-texte-2">{articles(count)} · hors livraison</span>
      </p>
      <button type="button" onClick={onCheckout} className={cn("rounded-full px-5 py-3 font-bold", ACCENTS[accent].button)}>
        Commander
      </button>
    </div>
  );
}
