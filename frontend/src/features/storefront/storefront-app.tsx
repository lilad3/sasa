"use client";

import "./storefront.css";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { FondOrange } from "@/components/ui/fond-orange";
import { Logo } from "@/components/ui/logo";
import { formatDay } from "@/lib/format";
import type { PublicProduct, Storefront } from "@/lib/types";

import { articleCount, Basket, MobileBar } from "./basket";
import { useCart } from "./cart-store";
import { Collection, type Line } from "./catalogue";
import { rememberChannel } from "./channel";
import { Checkout, Confirmation, type Receipt } from "./checkout";
import { Cover } from "./cover";

type View = "catalogue" | "commande";

/** La vitrine publique d'une boutique : couverture, collection, panier et commande, sans compte. */
export function StorefrontApp({ shop, products }: { shop: Storefront; products: PublicProduct[] }) {
  const { cart, setQuantity, clear } = useCart(shop.slug);
  const [view, setView] = useState<View>("catalogue");
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  // ?via=whatsapp… : retenu pour la visite, envoyé avec la commande (docs/chantier-p5.md §1.7).
  useEffect(() => rememberChannel(shop.slug), [shop.slug]);

  // Le panier garde des identifiants : on ne retient que les articles encore en vente, et jamais plus que le stock.
  const lines: Line[] = useMemo(() => {
    const byId = new Map(products.map((product) => [product.id, product]));
    return Object.entries(cart).flatMap(([id, quantity]) => {
      const product = byId.get(id);
      return product?.in_stock ? [{ product, quantity: Math.min(quantity, product.max_quantity) }] : [];
    });
  }, [cart, products]);

  const featured = useMemo(
    () => products.filter((p) => p.in_stock).reduce<PublicProduct | null>((best, p) => (!best || p.price > best.price ? p : best), null),
    [products],
  );

  const change = (product: PublicProduct, quantity: number) => setQuantity(product.id, Math.min(quantity, product.max_quantity));
  const add = (product: PublicProduct) => change(product, (cart[product.id] ?? 0) + 1);

  const goTo = (next: View) => {
    setView(next);
    document.getElementById("contenu-boutique")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const count = articleCount(lines);
  // En congé, Django refuse les commandes (409 shop_on_vacation) : la vitrine reste à parcourir, le panier se garde.
  const closed = shop.vacation.active;

  return (
    <div className="surface-orange relative isolate min-h-dvh scheme-light">
      <FondOrange />
      <header className="sticky top-0 z-30 px-3 pt-3 md:px-5">
        <div className="verre-clair mx-auto flex max-w-[1180px] items-center justify-between gap-3 rounded-full py-2 pr-2 pl-5 backdrop-blur-lg">
          <p className="flex min-w-0 items-baseline gap-2.5">
            <span className="large truncate text-base font-extrabold">{shop.name}</span>
            <span className="hidden text-xs text-encre-doux sm:inline">une boutique akwaba</span>
          </p>
          <nav aria-label="Boutique" className="flex items-center gap-1">
            <a href="#collection" onClick={() => setView("catalogue")} className="hidden rounded-full px-3 py-2 text-sm font-semibold hover:bg-[rgb(255_244_232/0.45)] sm:inline">
              La collection
            </a>
            <Link href={`/boutique/${shop.slug}/suivi`} className="hidden rounded-full px-3 py-2 text-sm font-semibold hover:bg-[rgb(255_244_232/0.45)] md:inline">
              Suivre une commande
            </Link>
            <button
              type="button"
              onClick={() => count > 0 && !closed && goTo("commande")}
              className="bouton-nuit inline-flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-semibold"
              aria-label={`Panier : ${count} article${count > 1 ? "s" : ""}`}
            >
              <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M7.5 10c0-4.2 9-4.2 9 0M3.5 10h17M4.8 10l1.7 9.5h11l1.7-9.5" />
              </svg>
              <span aria-hidden>Panier</span>
              <span aria-hidden className="large min-w-[1ch] font-extrabold">
                {count}
              </span>
            </button>
          </nav>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1180px] flex-col gap-8 px-3 pt-3 pb-28 md:px-5 lg:pb-16">
        {closed ? <VacationBanner vacation={shop.vacation} name={shop.name} /> : null}
        <Cover shop={shop} featured={featured} onAdd={add} />

        <div id="contenu-boutique" className="grid scroll-mt-24 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
          <main className="min-w-0">
            {receipt ? (
              <Confirmation
                receipt={receipt}
                shop={shop}
                onContinue={() => {
                  setReceipt(null);
                  goTo("catalogue");
                }}
              />
            ) : view === "commande" && lines.length > 0 && !closed ? (
              <Checkout
                shop={shop}
                lines={lines}
                onBack={() => goTo("catalogue")}
                onPlaced={(placed) => {
                  clear();
                  setReceipt(placed);
                  setView("catalogue");
                  document.getElementById("contenu-boutique")?.scrollIntoView({ block: "start" });
                }}
                onStockShortage={(available) => {
                  for (const [index, quantity] of Object.entries(available)) {
                    const line = lines[Number(index)];
                    if (line) setQuantity(line.product.id, quantity);
                  }
                }}
              />
            ) : (
              <Collection products={products} description={shop.description} quantities={cart} onChange={change} />
            )}
          </main>
          <Basket lines={lines} onChange={change} onCheckout={() => goTo("commande")} checkingOut={view === "commande" && !receipt && !closed} closed={closed} />
        </div>
      </div>

      {view === "catalogue" && !receipt ? <MobileBar lines={lines} onCheckout={() => goTo("commande")} closed={closed} /> : null}

      <footer className="border-t border-trait-clair px-4 py-8">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 text-sm text-encre">
          <span>
            {shop.name}
            {shop.city ? ` · ${shop.city}` : ""}
            {" · "}
            <Link href={`/boutique/${shop.slug}/suivi`} className="underline-offset-2 hover:underline">
              Suivre une commande
            </Link>
          </span>
          <Link href="/" className="inline-flex items-center gap-2 text-encre hover:underline">
            Boutique propulsée par <Logo tone="inherit" className="[&_.large]:text-base" />
          </Link>
        </div>
      </footer>
    </div>
  );
}

/** Le mot du marchand en congé, posé au-dessus de la couverture : on le lit avant de remplir un panier. */
function VacationBanner({ vacation, name }: { vacation: Storefront["vacation"]; name: string }) {
  return (
    <section role="status" aria-label="Boutique en congé" className="zone-sombre flex flex-col gap-2 rounded-[24px] bg-nuit px-5 py-4 text-creme md:flex-row md:items-center md:gap-5 md:px-6">
      <span className="large shrink-0 self-start rounded-full bg-ocre px-3 py-1 text-sm font-extrabold text-encre md:self-center">En congé</span>
      <div className="flex flex-col gap-1">
        <p className="text-[15px]">{vacation.message || `${name} fait une pause.`}</p>
        <p className="text-[13px] text-texte-2">
          {vacation.until ? `Retour le ${formatDay(vacation.until)}. ` : null}
          Vous pouvez parcourir la collection et garder votre panier : les commandes reprennent au retour de la boutique.
        </p>
      </div>
    </section>
  );
}
