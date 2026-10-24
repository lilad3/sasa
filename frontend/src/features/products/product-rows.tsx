"use client";

import Link from "next/link";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import { memberPhotoUrl } from "@/lib/photos";

import { BulkBar, BulkSheet, MAX_SELECTED, type Picked } from "./bulk";
import { StockAdjust } from "./stock-sheet";
import type { Product } from "./types";

/** Vignette : la photo du produit (envoyée, ou à une adresse externe), sinon son initiale. */
export function ProductThumb({ name, src, className }: { name: string; src: string | null; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center overflow-hidden rounded-[12px] border border-trait-doux bg-encre/60 text-sm font-bold text-texte-2", className)}>
      {src ? (
        // Photo relayée par /boutique/[slug]/photo, ou hébergée ailleurs (https vérifié par Django) : pas d'optimisation Next.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        name.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

/**
 * Niveau de stock. Rupture et stock bas passent par l'ocre (la couleur des alertes) :
 * un stock confortable n'a pas besoin d'être signalé.
 */
export function StockLevel({ stock, threshold, preorderDays }: { stock: number; threshold: number; preorderDays?: number | null }) {
  // En rupture mais vendu en précommande : ce n'est pas un manque, c'est une promesse de délai (indigo, la couleur de l'information).
  if (stock === 0 && preorderDays) {
    return <span className="text-[13px] font-semibold whitespace-nowrap text-indigo-clair">Précommande · {preorderDays} jours</span>;
  }
  if (stock === 0) {
    return (
      <span className="inline-flex items-center rounded-full border border-ocre/45 bg-nuit/70 px-2.5 py-0.5 text-[12.5px] font-semibold whitespace-nowrap text-ocre">
        Rupture
      </span>
    );
  }
  if (stock <= threshold) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold whitespace-nowrap text-alerte">
        <span aria-hidden className="h-3.5 w-1 rounded-sm bg-current" />
        {formatNumber(stock)}
        <span className="font-normal text-texte-3">· stock bas</span>
      </span>
    );
  }
  return <span className="text-[13px] whitespace-nowrap text-texte-2 tabular-nums">{formatNumber(stock)} en stock</span>;
}

type ProductRowsProps = {
  products: Product[];
  slug: string;
  canWrite: boolean;
  /** Droit products.cost : la colonne « Marge » n'existe pas sans lui. */
  canCost: boolean;
  empty: ReactNode;
  mfaEnabled: boolean;
  tagSuggestions: string[];
};

const STATUS: Record<Product["status"], { label: string; text: string }> = {
  active: { label: "Actif", text: "text-texte-2" },
  // Brouillon : sable, avec un trait pointillé à gauche de la ligne.
  draft: { label: "Brouillon", text: "text-sable" },
  archived: { label: "Archivé", text: "text-texte-3" },
};

const LONG_PRESS_MS = 500;
const storageKey = (slug: string) => `akwaba:selection:${slug}`;

/** La sélection survit à la pagination : sessionStorage, protégé (navigation privée, stockage bloqué). */
function readSelection(slug: string): { selecting: boolean; picked: Picked } {
  try {
    const raw = window.sessionStorage.getItem(storageKey(slug));
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && parsed.picked && typeof parsed.picked === "object") {
      const picked: Picked = {};
      for (const [id, entry] of Object.entries(parsed.picked as Record<string, { name?: unknown; price?: unknown }>).slice(0, MAX_SELECTED)) {
        if (/^[0-9a-f-]{36}$/i.test(id) && typeof entry?.name === "string" && typeof entry?.price === "number") picked[id] = { name: entry.name, price: entry.price };
      }
      return { selecting: Boolean(parsed.selecting), picked };
    }
  } catch {
    // Stockage indisponible : la sélection ne dure que pour cette page.
  }
  return { selecting: false, picked: {} };
}

function writeSelection(slug: string, value: { selecting: boolean; picked: Picked }) {
  try {
    if (!value.selecting && Object.keys(value.picked).length === 0) window.sessionStorage.removeItem(storageKey(slug));
    else window.sessionStorage.setItem(storageKey(slug), JSON.stringify(value));
  } catch {
    // Idem.
  }
}

/**
 * Catalogue en tableau : on parcourt vite des dizaines de produits. Hors du mode « Sélectionner », une ligne ouvre la fiche
 * (si le rôle permet de la modifier). En mode sélection, toute la ligne coche, et un bandeau fixé en bas porte l'action.
 */
export function ProductRows({ products, slug, canWrite, canCost, empty, mfaEnabled, tagSuggestions }: ProductRowsProps) {
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<Picked>({});
  const [sheet, setSheet] = useState(false);
  const [flash, setFlash] = useState("");
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);

  useEffect(() => {
    const saved = readSelection(slug);
    // Lecture du stockage au montage : le rendu serveur ne la connaît pas.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelecting(saved.selecting);
    setPicked(saved.picked);
  }, [slug]);

  const update = useCallback(
    (nextSelecting: boolean, nextPicked: Picked) => {
      setSelecting(nextSelecting);
      setPicked(nextPicked);
      writeSelection(slug, { selecting: nextSelecting, picked: nextPicked });
    },
    [slug],
  );

  const count = Object.keys(picked).length;
  const toggle = (product: Product) => {
    const next = { ...picked };
    if (next[product.id]) delete next[product.id];
    else if (count < MAX_SELECTED) next[product.id] = { name: product.name, price: product.price };
    update(true, next);
  };
  const selectPage = () => {
    const next = { ...picked };
    for (const product of products) {
      if (Object.keys(next).length >= MAX_SELECTED) break;
      next[product.id] = { name: product.name, price: product.price };
    }
    update(true, next);
  };

  if (products.length === 0) {
    return <div className="rounded-[16px] border border-dashed border-trait p-4 text-sm text-texte-3">{empty}</div>;
  }

  const columns = cn(
    "grid items-center gap-x-4 gap-y-1.5",
    selecting ? "grid-cols-[48px_1fr_auto]" : "grid-cols-[1fr_auto]",
    selecting
      ? canCost
        ? "md:grid-cols-[48px_minmax(0,1fr)_100px_140px_150px_70px]"
        : "md:grid-cols-[48px_minmax(0,1fr)_100px_140px_150px]"
      : canCost
        ? "md:grid-cols-[minmax(0,1fr)_100px_140px_150px_70px_auto]"
        : "md:grid-cols-[minmax(0,1fr)_100px_140px_150px_auto]",
  );

  const startPress = (product: Product) => {
    if (!canWrite || selecting) return;
    longPressed.current = false;
    pressTimer.current = setTimeout(() => {
      longPressed.current = true;
      update(true, { [product.id]: { name: product.name, price: product.price } });
    }, LONG_PRESS_MS);
  };
  const endPress = () => {
    if (pressTimer.current) clearTimeout(pressTimer.current);
    pressTimer.current = null;
  };

  return (
    <div className={cn("flex flex-col", selecting && "pb-24")}>
      {flash ? (
        <p role="status" className="mb-2 rounded-[14px] border border-indigo/40 bg-indigo/10 px-3.5 py-2.5 text-sm">
          {flash}
        </p>
      ) : null}
      {canWrite ? (
        <div className="flex items-center justify-end pb-2">
          <button
            type="button"
            onClick={() => (selecting ? update(false, {}) : update(true, picked))}
            aria-pressed={selecting}
            className="min-h-11 rounded-full border border-sable/25 bg-white/[0.04] px-4 text-sm font-semibold hover:bg-white/10"
          >
            {selecting ? "Terminer la sélection" : "Sélectionner"}
          </button>
        </div>
      ) : null}
      <div aria-hidden className={cn(columns, "hidden border-b border-trait-doux pb-2 text-xs text-texte-3 md:grid")}>
        {selecting ? <span /> : null}
        <span>Produit</span>
        <span>Statut</span>
        <span>Prix</span>
        <span>Stock</span>
        {canCost ? <span>Marge</span> : null}
        {selecting ? null : <span />}
      </div>
      <ul className="flex flex-col">
        {products.map((product) => {
          const checked = Boolean(picked[product.id]);
          const blocked = !checked && count >= MAX_SELECTED;
          const state = STATUS[product.status];
          const rowClass = cn(
            columns,
            "py-2.5",
            product.status === "draft" && "border-l-2 border-dashed border-sable/60 pl-2",
            product.status === "archived" && "opacity-70",
          );
          return (
            <li key={product.id} className="border-b border-trait-doux last:border-0" onPointerDown={() => startPress(product)} onPointerUp={endPress} onPointerLeave={endPress} onPointerCancel={endPress}>
              {selecting ? (
                // Toute la ligne est un libellé : un appui coche, au pouce comme à la souris.
                <label className={cn(rowClass, "-mx-2 cursor-pointer rounded-xl px-2 hover:bg-white/[0.05]", blocked && "cursor-not-allowed opacity-60")}>
                  <span className="grid size-12 place-items-center">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={blocked}
                      onChange={() => toggle(product)}
                      aria-label={`Sélectionner ${product.name}`}
                      className="size-5 accent-orange"
                    />
                  </span>
                  <ProductCells product={product} slug={slug} canCost={canCost} state={state} />
                  {blocked ? <span className="col-span-full text-xs text-texte-3">100 produits au plus à la fois</span> : null}
                </label>
              ) : canWrite ? (
                <div className={cn(rowClass, "relative -mx-2 rounded-xl px-2 transition-colors hover:bg-white/[0.05]")}>
                  <ProductCells product={product} slug={slug} canCost={canCost} state={state} link={`/app/${slug}/produits/${product.id}`} onLink={(event) => {
                    if (longPressed.current) {
                      event.preventDefault();
                      longPressed.current = false;
                    }
                  }} />
                  <span className="relative z-10 col-span-full flex md:col-span-1">
                    <StockAdjust slug={slug} productId={product.id} productName={product.name} stock={product.stock} label="Ajuster" />
                  </span>
                </div>
              ) : (
                <div className={rowClass}>
                  <ProductCells product={product} slug={slug} canCost={canCost} state={state} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {selecting ? (
        <>
          <BulkBar count={count} allCount={products.length} onAll={selectPage} onCancel={() => update(false, {})} onChoose={() => setSheet(true)} />
          <BulkSheet
            open={sheet}
            onClose={() => setSheet(false)}
            slug={slug}
            picked={picked}
            mfaEnabled={mfaEnabled}
            suggestions={tagSuggestions}
            onDone={(done) => {
              setSheet(false);
              update(false, {});
              setFlash(`${done} produit${done > 1 ? "s" : ""} modifié${done > 1 ? "s" : ""}.`);
            }}
          />
        </>
      ) : null}
    </div>
  );
}

function ProductCells({
  product, slug, canCost, state, link, onLink,
}: { product: Product; slug: string; canCost: boolean; state: { label: string; text: string }; link?: string; onLink?: (event: React.MouseEvent) => void }) {
  const image = product.photos[0] ? memberPhotoUrl(slug, product.id, product.photos[0]) : product.image_url || null;
  const name = (
    <span className="truncate text-sm font-semibold">{product.name}</span>
  );
  return (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <ProductThumb name={product.name} src={image} />
        <span className="min-w-0">
          <span className="flex items-baseline gap-2">
            {link ? (
              <Link href={link} onClick={onLink} className="truncate after:absolute after:inset-0 after:content-['']">
                {name}
              </Link>
            ) : (
              name
            )}
            {product.is_featured ? <span className="shrink-0 text-[12px] font-semibold text-sable">à la une</span> : null}
          </span>
          <span className="block truncate text-xs text-texte-3">
            <span className="font-mono">{product.sku}</span>
            {product.category ? ` · ${product.category}` : null}
            {product.tags.length ? ` · ${product.tags.join(", ")}` : null}
          </span>
        </span>
      </span>
      <span className={cn("text-right text-[13px] md:order-none md:text-left", state.text)}>{state.label}</span>
      <span className="flex flex-wrap items-baseline gap-x-2 pl-[52px] text-sm font-semibold tabular-nums md:pl-0">
        {formatFcfa(product.price)}
        {product.compare_at_price ? <del aria-label={`Ancien prix ${formatFcfa(product.compare_at_price)}`} className="text-xs font-normal text-texte-3">{formatFcfa(product.compare_at_price)}</del> : null}
      </span>
      <span className="pl-[52px] md:pl-0">
        <StockLevel stock={product.stock} threshold={product.low_stock_threshold} preorderDays={product.allow_backorder ? product.backorder_days : null} />
      </span>
      {canCost ? (
        <span className={cn("hidden text-[13px] tabular-nums md:block", (product.margin_percent ?? 0) < 0 ? "text-alerte" : "text-texte-2")}>
          {product.margin_percent == null ? "—" : `${product.margin_percent} %`}
        </span>
      ) : null}
    </>
  );
}
