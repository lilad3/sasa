import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";

import type { Product } from "./types";

/** Vignette : la photo du produit, sinon son initiale. */
export function ProductThumb({ product, className }: { product: Pick<Product, "name" | "image_url">; className?: string }) {
  return (
    <span aria-hidden className={cn("grid size-10 shrink-0 place-items-center overflow-hidden rounded-[12px] border border-trait-doux bg-encre/60 text-sm font-bold text-texte-2", className)}>
      {product.image_url ? (
        // Images hébergées ailleurs (https uniquement, vérifié par Django) : pas d'optimisation Next.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={product.image_url} alt="" loading="lazy" className="size-full object-cover" />
      ) : (
        product.name.trim().charAt(0).toUpperCase()
      )}
    </span>
  );
}

/**
 * Niveau de stock. Rupture et stock bas passent par l'ocre (la couleur des alertes) :
 * un stock confortable n'a pas besoin d'être signalé.
 */
export function StockLevel({ stock, threshold }: { stock: number; threshold: number }) {
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

type ProductRowsProps = { products: Product[]; slug: string; canWrite: boolean; empty: ReactNode };

/** Catalogue en tableau : on parcourt vite des dizaines de produits. Une ligne ouvre la fiche si le rôle permet de la modifier. */
export function ProductRows({ products, slug, canWrite, empty }: ProductRowsProps) {
  if (products.length === 0) {
    return <div className="rounded-[16px] border border-dashed border-trait p-4 text-sm text-texte-3">{empty}</div>;
  }
  const columns = "grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 md:grid-cols-[minmax(0,1fr)_120px_150px_96px]";
  return (
    <div className="flex flex-col">
      <div aria-hidden className={cn(columns, "hidden border-b border-trait-doux pb-2 text-xs text-texte-3 md:grid")}>
        <span>Produit</span>
        <span>Prix</span>
        <span>Stock</span>
        <span>Vitrine</span>
      </div>
      <ul className="flex flex-col">
        {products.map((product) => (
          <li key={product.id} className="border-b border-trait-doux last:border-0">
            {canWrite ? (
              <Link href={`/app/${slug}/produits/${product.id}`} className={cn(columns, "-mx-2 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.05]")}>
                <ProductCells product={product} />
              </Link>
            ) : (
              <div className={cn(columns, "py-2.5")}>
                <ProductCells product={product} />
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProductCells({ product }: { product: Product }) {
  return (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <ProductThumb product={product} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold">{product.name}</span>
          <span className="block truncate text-xs text-texte-3">
            <span className="font-mono">{product.sku}</span>
            {product.category ? ` · ${product.category}` : null}
          </span>
        </span>
      </span>
      <span className="text-right text-sm font-semibold tabular-nums md:text-left">{formatFcfa(product.price)}</span>
      <span className="pl-[52px] md:pl-0">
        <StockLevel stock={product.stock} threshold={product.low_stock_threshold} />
      </span>
      <span className={cn("text-right text-[13px] md:text-left", product.is_active ? "text-texte-2" : "text-texte-3")}>
        {product.is_active ? "En vente" : "Masqué"}
      </span>
    </>
  );
}
