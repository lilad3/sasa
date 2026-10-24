import type { Metadata } from "next";
import Form from "next/form";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FormAlert } from "@/features/auth/form-alert";
import { getProductOverview, getProducts } from "@/features/products/data";
import { ProductRows } from "@/features/products/product-rows";
import type { ProductFilters, StatusFilter, StockFilter } from "@/features/products/types";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { getMe, getMyShops } from "@/lib/server/session";
import { voice } from "@/lib/voice";

export const metadata: Metadata = { title: "Produits" };

const STOCK_TABS: { stock: StockFilter; label: string }[] = [
  { stock: "low", label: "Stock bas" },
  { stock: "out", label: "En rupture" },
];

// Par défaut : actifs et brouillons. « Tous » ajoute les archivés.
const STATUS_TABS: { status: StatusFilter | undefined; label: string; param: string | undefined }[] = [
  { status: undefined, label: "Actifs et brouillons", param: undefined },
  { status: "draft", label: "Brouillons", param: "brouillon" },
  { status: "active", label: "Actifs", param: "actif" },
  { status: "archived", label: "Archivés", param: "archive" },
  { status: "all", label: "Tous", param: "tous" },
];

const FLASH: Record<string, string> = {
  ajoute: "Produit ajouté. S’il est en vente, il apparaît déjà dans la vitrine.",
  supprime: "Produit supprimé. Les commandes passées gardent son nom et son prix.",
};

function first(value: string | string[] | undefined) {
  return typeof value === "string" ? value : undefined;
}

/** Adresse de la liste avec ses filtres : la pagination et les onglets les gardent. */
function listHref(slug: string, { q, category, stock, status, tag, page }: ProductFilters) {
  const query = new URLSearchParams();
  if (q) query.set("q", q);
  if (category) query.set("rayon", category);
  if (stock) query.set("stock", stock);
  const param = STATUS_TABS.find((tab) => tab.status === status)?.param;
  if (param) query.set("statut", param);
  if (tag) query.set("etiquette", tag);
  if (page > 1) query.set("page", String(page));
  const text = query.toString();
  return `/app/${slug}/produits${text ? `?${text}` : ""}`;
}

export default function ProductsPage({ params, searchParams }: PageProps<"/app/[shop]/produits">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[520px] animate-pulse rounded-[24px]" />}>
      <ProductsFromRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function ProductsFromRoute({ params, searchParams }: Pick<PageProps<"/app/[shop]/produits">, "params" | "searchParams">) {
  const [{ shop }, query] = await Promise.all([params, searchParams]);
  const wantedStock = first(query.stock);
  const filters: ProductFilters = {
    q: first(query.q)?.trim().slice(0, 60) || undefined,
    category: first(query.rayon)?.trim().slice(0, 40) || undefined,
    stock: STOCK_TABS.some((tab) => tab.stock === wantedStock) ? (wantedStock as StockFilter) : undefined,
    status: STATUS_TABS.find((tab) => tab.param && tab.param === first(query.statut))?.status,
    tag: first(query.etiquette)?.trim().slice(0, 30) || undefined,
    page: Math.max(1, Number.parseInt(first(query.page) ?? "1", 10) || 1),
  };

  const [result, overview, shops, me] = await Promise.all([getProducts(shop, filters), getProductOverview(shop), getMyShops(), getMe()]);
  if (!result.ok) {
    if (result.problem.status === 404) notFound();
    throw new Error(result.problem.detail);
  }
  if (!overview.ok) throw new Error(overview.problem.detail);
  const membership = shops.ok ? shops.data.find((membership) => membership.slug === shop) : undefined;
  const canWrite = membership?.permissions.includes("products.write") ?? false;
  const canCost = membership?.permissions.includes("products.cost") ?? false;
  const words = voice(membership?.role ?? "seller", membership?.name ?? "la boutique").catalog;

  const { results, count, pages } = result.data;
  const summary = overview.data;
  const full = summary.limit !== null && summary.count >= summary.limit;
  const filtered = Boolean(filters.q || filters.category || filters.stock || filters.status || filters.tag);
  const flash = FLASH[first(query.ok) ?? ""];

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">
            {formatNumber(summary.count)} produit{summary.count > 1 ? "s" : ""} · {formatNumber(summary.active)} actif{summary.active > 1 ? "s" : ""}
            {summary.limit !== null ? <span className="text-texte-3"> · {formatNumber(summary.limit)} au plus avec votre plan</span> : null}
          </p>
          <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Produits</h1>
        </div>
        {canWrite ? (
          <div className="flex flex-wrap items-center gap-2">
            {summary.csv_import ? (
              <Link href={`/app/${shop}/produits/import`} className="rounded-full border border-sable/25 bg-white/[0.04] px-5 py-2.5 text-sm font-bold hover:bg-white/10">
                Importer
              </Link>
            ) : (
              <span className="rounded-full border border-trait-doux px-5 py-2.5 text-sm font-bold text-texte-3">Importer · à partir du plan Pro</span>
            )}
            {full ? null : (
              <Link href={`/app/${shop}/produits/nouveau`} className="bouton-nuit rounded-full px-5 py-2.5 text-sm font-bold">
                Nouveau produit
              </Link>
            )}
          </div>
        ) : null}
      </header>

      {flash ? (
        <div className="col-span-full">
          <FormAlert tone="success">{flash}</FormAlert>
        </div>
      ) : null}

      {canWrite && full ? (
        <p role="note" className="col-span-full rounded-[18px] border border-ocre/35 bg-ocre/10 px-4 py-3 text-sm">
          <span className="font-semibold text-ocre">Catalogue plein.</span> Votre plan permet {formatNumber(summary.limit ?? 0)} produits.{" "}
          {membership?.permissions.includes("shop.manage") ? (
            <Link href={`/app/${shop}/parametres?onglet=plan`} className="font-semibold underline decoration-texte/40 underline-offset-[3px]">
              Voir les plans
            </Link>
          ) : (
            "Le propriétaire de la boutique peut changer de plan."
          )}
        </p>
      ) : null}

      <div className="col-span-full flex flex-wrap items-center justify-between gap-2.5">
        <nav aria-label="Filtrer par statut" className="flex gap-1 overflow-x-auto rounded-[16px] border border-trait-doux bg-encre/50 p-1">
          {STATUS_TABS.map((tab) => (
            <TabLink
              key={tab.label}
              href={listHref(shop, { ...filters, status: tab.status, page: 1 })}
              active={filters.status === tab.status}
              label={tab.label}
              count={tab.status === "draft" ? summary.draft : tab.status === "active" ? summary.active : tab.status === "archived" ? summary.archived : tab.status === "all" ? summary.count + summary.archived : summary.count}
            />
          ))}
        </nav>
        <nav aria-label="Filtrer par stock" className="flex gap-1 overflow-x-auto rounded-[16px] border border-trait-doux bg-encre/50 p-1">
          <TabLink href={listHref(shop, { ...filters, stock: undefined, page: 1 })} active={!filters.stock} label="Tous" count={summary.count} />
          {STOCK_TABS.map((tab) => (
            <TabLink
              key={tab.stock}
              href={listHref(shop, { ...filters, stock: tab.stock, page: 1 })}
              active={filters.stock === tab.stock}
              label={tab.label}
              count={tab.stock === "low" ? summary.low_stock : summary.out_of_stock}
              alert
            />
          ))}
        </nav>

        <Form action={`/app/${shop}/produits`} role="search" className="flex w-full flex-wrap gap-2 sm:w-auto">
          {filters.stock ? <input type="hidden" name="stock" value={filters.stock} /> : null}
          {/* Le rayon choisi reste actif pendant la recherche. */}
          {filters.category ? <input type="hidden" name="rayon" value={filters.category} /> : null}
          {filters.status ? <input type="hidden" name="statut" value={STATUS_TABS.find((tab) => tab.status === filters.status)?.param} /> : null}
          {filters.tag ? <input type="hidden" name="etiquette" value={filters.tag} /> : null}
          <label htmlFor="recherche" className="sr-only">
            Chercher un produit
          </label>
          <input
            id="recherche"
            name="q"
            type="search"
            defaultValue={filters.q}
            maxLength={60}
            placeholder="Nom ou référence"
            className="min-w-0 flex-1 rounded-full border border-white/15 bg-encre/45 px-4 py-2.5 text-sm text-texte outline-none placeholder:text-texte-3 focus-visible:border-orange sm:w-[220px]"
          />
          <button type="submit" className="bouton-nuit rounded-full px-5 py-2.5 text-sm font-bold">
            Chercher
          </button>
        </Form>
      </div>

      {/* Des pastilles plutôt qu'une liste déroulante : la liste native est dessinée par le système, en gris et sans verre. */}
      {summary.categories.length > 0 ? (
        <nav aria-label="Filtrer par type de produit" className="col-span-full flex flex-wrap gap-1.5">
          {[undefined, ...summary.categories].map((category) => (
            <Link
              key={category ?? "tous"}
              href={listHref(shop, { ...filters, category, page: 1 })}
              aria-current={filters.category === category ? "page" : undefined}
              className="rounded-full border border-trait-doux bg-encre/40 px-3.5 py-1.5 text-[13px] font-semibold text-texte-3 transition-colors hover:border-trait hover:text-texte aria-[current=page]:border-orange/60 aria-[current=page]:bg-orange/15 aria-[current=page]:text-texte"
            >
              {category ?? "Tous les types"}
            </Link>
          ))}
        </nav>
      ) : null}

      {summary.tags.length > 0 ? (
        <nav aria-label="Filtrer par étiquette" className="col-span-full flex flex-wrap gap-1.5">
          {summary.tags.slice(0, 12).map((tag) => (
            <Link
              key={tag.label}
              href={listHref(shop, { ...filters, tag: filters.tag === tag.label ? undefined : tag.label, page: 1 })}
              aria-current={filters.tag === tag.label ? "page" : undefined}
              className="rounded-full border border-trait-doux bg-encre/40 px-3.5 py-1.5 text-[13px] font-semibold text-texte-3 transition-colors hover:border-trait hover:text-texte aria-[current=page]:border-orange/60 aria-[current=page]:bg-orange/15 aria-[current=page]:text-texte"
            >
              {tag.label} <span className="font-normal tabular-nums">{tag.count}</span>
            </Link>
          ))}
        </nav>
      ) : null}

      <section aria-label="Liste des produits" className="vitre col-span-full rounded-[24px] px-[18px] pt-3.5 pb-4">
        {filtered ? (
          <p className="pb-2 text-[13px] text-texte-2">
            {formatNumber(count)} résultat{count > 1 ? "s" : ""}
            {filters.q ? ` pour « ${filters.q} »` : null}
            {filters.category ? ` dans le type ${filters.category}` : null}
            {filters.tag ? ` avec l’étiquette ${filters.tag}` : null}
            {filters.status ? ` · ${STATUS_TABS.find((tab) => tab.status === filters.status)?.label}` : null}{" "}
            <Link href={`/app/${shop}/produits`} className="font-semibold text-sable underline decoration-sable/40 underline-offset-[3px]">
              Tout effacer
            </Link>
          </p>
        ) : null}
        <ProductRows
          products={results}
          slug={shop}
          canWrite={canWrite}
          canCost={canCost}
          mfaEnabled={me.ok ? me.data.mfa_enabled : false}
          tagSuggestions={summary.tags.map((tag) => tag.label)}
          empty={
            filtered ? (
              <>
                Aucun produit ne correspond.{" "}
                <Link href={`/app/${shop}/produits`} className="font-semibold text-sable underline decoration-sable/40 underline-offset-[3px]">
                  Voir tout le catalogue
                </Link>
              </>
            ) : canWrite ? (
              <>
                Votre catalogue est vide.{" "}
                <Link href={`/app/${shop}/produits/nouveau`} className="font-semibold text-sable underline decoration-sable/40 underline-offset-[3px]">
                  Ajoutez un premier produit
                </Link>{" "}
                ou importez votre liste depuis Excel.
              </>
            ) : (
              words.empty
            )
          }
        />
        {pages > 1 ? (
          <nav aria-label="Pages" className="flex items-center justify-between gap-3 border-t border-trait-doux pt-3 text-sm">
            {filters.page > 1 ? (
              <Link href={listHref(shop, { ...filters, page: filters.page - 1 })} className="rounded-full bg-white/[0.06] px-4 py-2 hover:bg-white/12">
                Page précédente
              </Link>
            ) : (
              <span />
            )}
            <span className="text-texte-3">
              Page {filters.page} sur {pages}
            </span>
            {filters.page < pages ? (
              <Link href={listHref(shop, { ...filters, page: filters.page + 1 })} className="rounded-full bg-white/[0.06] px-4 py-2 hover:bg-white/12">
                Page suivante
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </section>
    </>
  );
}

function TabLink({ href, active, label, count, alert }: { href: string; active: boolean; label: string; count: number; alert?: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className="flex shrink-0 items-center gap-2 rounded-[12px] px-3 py-2 text-[13px] font-semibold whitespace-nowrap text-texte-3 hover:text-texte aria-[current=page]:bg-white/12 aria-[current=page]:text-texte"
    >
      {alert ? <span aria-hidden className={cn("h-3 w-1 rounded-sm", count > 0 ? "bg-alerte" : "bg-texte-3/40")} /> : null}
      {label}
      <span className="font-normal text-texte-3 tabular-nums">{formatNumber(count)}</span>
    </Link>
  );
}
