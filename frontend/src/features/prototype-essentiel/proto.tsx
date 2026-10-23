"use client";

import "../storefront/storefront.css";
import "./proto.css";

import Link from "next/link";
import { type CSSProperties, type KeyboardEvent, type ReactNode, useMemo, useState, useSyncExternalStore } from "react";

import { FondOrange } from "@/components/ui/fond-orange";
import { Logo } from "@/components/ui/logo";
import { Basket, MobileBar } from "@/features/storefront/basket";
import type { Line } from "@/features/storefront/catalogue";
import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { FEATURED, PRODUCTS, type ProtoProduct, SHOP } from "./data";
import { infoLine } from "./info-line";

// Prototype P16 (docs/chantier-a2-essentiel.md) : la vitrine Essentiel, la photo d'abord.
// Rien ici n'est relié à Django ni au vrai panier. À supprimer à l'étape 2.

const BASE = "/prototype/essentiel";
const PRODUCT_PAGE = `${BASE}/produit`;

/* ---------- Le panier du prototype ---------- */

type Cart = Record<string, number>;

function useProtoCart() {
  const [cart, setCart] = useState<Cart>({});
  const add = (product: ProtoProduct, quantity = 1) =>
    setCart((current) => ({ ...current, [product.id]: Math.min(product.max_quantity, (current[product.id] ?? 0) + quantity) }));
  const change = (product: PublicProduct, quantity: number) =>
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[product.id];
      else next[product.id] = Math.min(product.max_quantity, quantity);
      return next;
    });
  const lines: Line[] = PRODUCTS.flatMap((product) => (cart[product.id] ? [{ product: asPublic(product), quantity: cart[product.id] }] : []));
  return { cart, add, change, lines, count: lines.reduce((sum, line) => sum + line.quantity, 0) };
}

/** Le panier latéral et la barre mobile existants attendent un PublicProduct. */
function asPublic(product: ProtoProduct): PublicProduct {
  return { ...product, image_url: product.images[0] ?? null, photos: [] };
}

/* ---------- E5 : l'affichage choisi, retenu sur l'appareil ---------- */

type Mode = "grille" | "fil";
const MODE_KEY = "akwaba:vitrine:affichage";
const MODE_EVENT = "akwaba:affichage";

function readMode(): Mode {
  try {
    return localStorage.getItem(MODE_KEY) === "fil" ? "fil" : "grille";
  } catch {
    return "grille";
  }
}

function useMode() {
  const mode = useSyncExternalStore(
    (notify) => {
      window.addEventListener(MODE_EVENT, notify);
      window.addEventListener("storage", notify);
      return () => {
        window.removeEventListener(MODE_EVENT, notify);
        window.removeEventListener("storage", notify);
      };
    },
    readMode,
    () => "grille" as Mode,
  );
  const setMode = (next: Mode) => {
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // Navigation privée : le choix vaut pour la visite seulement.
    }
    window.dispatchEvent(new Event(MODE_EVENT));
  };
  return [mode, setMode] as const;
}

/* ---------- Petites pièces ---------- */

/** E3 : le prix en chiffres nets, l'unité plus petite. Sur la bande nuit, l'unité passe en sable. */
function Price({ value, className, onDark = false }: { value: number; className?: string; onDark?: boolean }) {
  return (
    <span className={cn("chiffres whitespace-nowrap", className)}>
      {formatNumber(value)}
      <span className={cn("ml-[0.22em] text-[0.62em] font-medium", onDark ? "text-sable" : "text-encre-doux")}>F</span>
    </span>
  );
}

function StockNote({ product }: { product: ProtoProduct }) {
  if (!product.in_stock) return <span className="text-xs font-semibold text-[#8a2412]">Épuisé</span>;
  if (product.low_stock) return <span className="text-xs font-semibold text-[#5c3d00]">Plus que {product.max_quantity} pièces</span>;
  return null;
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <path d="M12 6.5v11M6.5 12h11" />
    </svg>
  );
}

/* ---------- E2 : feuilleter les photos comme un statut ---------- */

/**
 * Toucher à droite : photo suivante ; à gauche : précédente. Pas de défilement automatique.
 * Au clavier : flèches gauche et droite quand la galerie a le focus. Lecteur d'écran : deux boutons et « Photo 2 sur 3 ».
 */
function Photos({ product, eager = false, children }: { product: ProtoProduct; eager?: boolean; children?: ReactNode }) {
  const [index, setIndex] = useState(0);
  const count = product.images.length;
  const go = (step: number) => setIndex((current) => Math.min(count - 1, Math.max(0, current + step)));
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") go(1);
    else if (event.key === "ArrowLeft") go(-1);
    else return;
    event.preventDefault();
  };

  return (
    <div
      className="ess-photos"
      role={count > 1 ? "group" : undefined}
      aria-roledescription={count > 1 ? "galerie" : undefined}
      aria-label={count > 1 ? `Photos de ${product.name}` : undefined}
      tabIndex={count > 1 ? 0 : undefined}
      onKeyDown={count > 1 ? keys : undefined}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- prototype : à l'étape 2, la route /boutique/[slug]/photo sert la bonne taille */}
      <img
        key={index}
        src={product.images[index]}
        alt={count > 1 ? `${product.name}, photo ${index + 1} sur ${count}` : product.name}
        loading={eager ? "eager" : "lazy"}
        className="ess-image"
      />
      {count > 1 ? (
        <>
          <div aria-hidden className="ess-barres">
            {product.images.map((image, i) => (
              <span key={image} data-etat={i < index ? "vue" : i === index ? "courante" : "a-venir"} />
            ))}
          </div>
          <button type="button" className="ess-zone ess-zone--avant" onClick={() => go(-1)} disabled={index === 0} aria-label="Photo précédente" />
          <button type="button" className="ess-zone ess-zone--apres" onClick={() => go(1)} disabled={index === count - 1} aria-label="Photo suivante" />
          <p className="sr-only" aria-live="polite">
            Photo {index + 1} sur {count}
          </p>
        </>
      ) : null}
      {children}
    </div>
  );
}

/** E7 : sans photo, une fiche typographique : le nom en grand sur la nuit, un filet de la couleur de la boutique. */
function NoPhoto({ product }: { product: ProtoProduct }) {
  return (
    <div className="ess-sans-photo" style={{ "--accent": SHOP.accent } as CSSProperties}>
      <p className="font-mono text-[11px] tracking-[0.08em] text-sable uppercase">{product.category}</p>
      <span aria-hidden className="ess-filet" />
      <p className="ess-sans-photo-nom large">{product.name}</p>
    </div>
  );
}

/** E1, E3, E4 : la photo au format 4:5, le prix sur une fine bande nuit, l'ajout d'un toucher dans le coin. */
function Frame({ product, quantity, onAdd, size, eager }: { product: ProtoProduct; quantity: number; onAdd: () => void; size: "grille" | "fil" | "page"; eager?: boolean }) {
  const full = quantity >= product.max_quantity;
  return (
    <div className="ess-cadre" data-taille={size} data-panier={quantity > 0} data-epuise={!product.in_stock}>
      {product.images.length ? <Photos product={product} eager={eager} /> : <NoPhoto product={product} />}
      {size === "page" ? null : (
        <div className="ess-bande">
          {product.in_stock ? <Price value={product.price} onDark className="text-[15px]" /> : <span className="text-[13px] font-semibold text-sable">Épuisé</span>}
        </div>
      )}
      {product.in_stock && size !== "page" ? (
        <button
          type="button"
          onClick={onAdd}
          disabled={full}
          className="ess-ajout bouton-nuit"
          aria-label={quantity > 0 ? `${product.name} : ${quantity} dans le panier. En ajouter un` : `Ajouter ${product.name} au panier`}
        >
          {quantity > 0 ? (
            <span aria-hidden className="large text-[15px] font-extrabold">
              {quantity}
            </span>
          ) : (
            <PlusIcon className="size-5" />
          )}
        </button>
      ) : null}
    </div>
  );
}

function ProductCard({ product, quantity, onAdd, mode, eager }: { product: ProtoProduct; quantity: number; onAdd: () => void; mode: Mode; eager?: boolean }) {
  return (
    <article className={cn("flex flex-col gap-2", mode === "fil" && "gap-3")}>
      <Frame product={product} quantity={quantity} onAdd={onAdd} size={mode} eager={eager} />
      <div className={cn("flex flex-col gap-0.5 px-1", mode === "fil" && "gap-1.5")}>
        <h3 className={cn(mode === "fil" ? "large text-[22px] leading-tight font-bold" : "line-clamp-2 text-[14px] leading-snug font-semibold")}>
          <Link href={PRODUCT_PAGE} className="underline-offset-[3px] hover:underline">
            {product.name}
          </Link>
        </h3>
        {mode === "fil" && product.description ? <p className="line-clamp-3 max-w-[52ch] text-[14px] text-encre-doux">{product.description}</p> : null}
        <StockNote product={product} />
      </div>
    </article>
  );
}

/* ---------- En-tête, couverture, onglets ---------- */

function Header({ count }: { count: number }) {
  return (
    <header className="sticky top-0 z-30 px-3 pt-3 md:px-5">
      <div className="verre-clair mx-auto flex max-w-[1180px] items-center justify-between gap-3 rounded-full py-2 pr-2 pl-5 backdrop-blur-lg">
        <Link href={BASE} className="flex min-w-0 items-baseline gap-2.5">
          <span className="large truncate text-base font-extrabold">{SHOP.name}</span>
          <span className="hidden text-xs text-encre-doux sm:inline">une boutique akwaba</span>
        </Link>
        <span className="bouton-nuit inline-flex items-center gap-2 rounded-full py-2 pr-4 pl-3 text-sm font-semibold" aria-label={`Panier : ${count} article${count > 1 ? "s" : ""}`}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M7.5 10c0-4.2 9-4.2 9 0M3.5 10h17M4.8 10l1.7 9.5h11l1.7-9.5" />
          </svg>
          <span aria-hidden>Panier</span>
          <span aria-hidden className="large min-w-[1ch] font-extrabold">
            {count}
          </span>
        </span>
      </div>
    </header>
  );
}

/** E8 + E9 : la vraie photo du produit à la une, le nom de la boutique en très grand, et une ligne vraie dessous. */
function Cover({ onAdd }: { onAdd: () => void }) {
  const words = SHOP.name.toUpperCase().split(/\s+/);
  const info = infoLine(SHOP.delivery_zones, SHOP.payment_methods);
  return (
    <section aria-label={`Couverture de ${SHOP.name}`} className="ess-couverture zone-sombre" style={{ "--accent": SHOP.accent } as CSSProperties}>
      <div aria-hidden className="ess-couverture-decor" />
      {/* eslint-disable-next-line @next/next/no-img-element -- prototype */}
      <img src={FEATURED.images[0]} alt={FEATURED.name} className="ess-couverture-photo" />
      <div aria-hidden className="ess-couverture-voile" />

      <div className="vit-mast ess-couverture-titre">
        <h1 aria-label={SHOP.name} className="large flex flex-wrap gap-x-[0.24em] text-[clamp(58px,17vw,128px)] leading-[0.84] font-extrabold tracking-[-0.02em]">
          {words.map((word, i) => (
            <span key={word} className="vit-word" aria-hidden>
              <span style={{ "--i": i } as CSSProperties}>{word}</span>
            </span>
          ))}
        </h1>
        <p className="vit-fade max-w-[34ch] font-mono text-[12px] leading-relaxed text-sable lg:max-w-[46ch]" style={{ "--d": "0.6s" } as CSSProperties}>
          {info.join(" · ")}
        </p>
      </div>

      <div className="ess-couverture-une">
        <p className="vit-fade font-mono text-xs tracking-[0.08em] text-sable uppercase" style={{ "--d": "0.9s" } as CSSProperties}>
          À la une
        </p>
        <h2 className="vit-fade large text-[clamp(28px,4vw,44px)] leading-[0.98] font-extrabold text-balance" style={{ "--d": "1s" } as CSSProperties}>
          {FEATURED.name}
        </h2>
        <div className="vit-fade mt-1 flex flex-wrap items-center gap-x-4 gap-y-3" style={{ "--d": "1.1s" } as CSSProperties}>
          <Price value={FEATURED.price} onDark className="text-[24px] text-creme" />
          <button type="button" onClick={onAdd} className="bouton-nuit rounded-full px-5 py-3 font-bold">
            Ajouter au panier
          </button>
          <Link href={PRODUCT_PAGE} className="text-sm font-semibold underline decoration-creme/40 underline-offset-4 hover:decoration-creme">
            Voir la pièce
          </Link>
        </div>
      </div>
    </section>
  );
}

function GridIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" fill="currentColor" aria-hidden>
      <rect x="2.5" y="2.5" width="6.5" height="8" rx="1.6" />
      <rect x="11" y="2.5" width="6.5" height="8" rx="1.6" />
      <rect x="2.5" y="12" width="6.5" height="5.5" rx="1.6" />
      <rect x="11" y="12" width="6.5" height="5.5" rx="1.6" />
    </svg>
  );
}

function FeedIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-[18px]" fill="currentColor" aria-hidden>
      <rect x="4" y="2" width="12" height="12.5" rx="2" />
      <rect x="4" y="16" width="12" height="2" rx="1" />
    </svg>
  );
}

/** E10 + E5 : les rayons en onglets de texte qui restent en haut, et le choix de l'affichage. */
function Tabs({ categories, active, onPick, mode, onMode }: { categories: [string, number][]; active: string; onPick: (c: string) => void; mode: Mode; onMode: (m: Mode) => void }) {
  return (
    <div className="ess-onglets">
      <div className="ess-onglets-defile" role="group" aria-label="Rayons">
        {categories.map(([category, count]) => (
          <button key={category} type="button" aria-pressed={active === category} onClick={() => onPick(category)} className="ess-onglet">
            {category}
            <span className="font-mono text-[11px] font-normal text-encre-doux">{count}</span>
          </button>
        ))}
      </div>
      <div className="ess-affichage" role="group" aria-label="Affichage">
        <button type="button" aria-pressed={mode === "grille"} onClick={() => onMode("grille")} aria-label="En grille, deux par ligne">
          <GridIcon />
        </button>
        <button type="button" aria-pressed={mode === "fil"} onClick={() => onMode("fil")} aria-label="Un produit par écran">
          <FeedIcon />
        </button>
      </div>
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-trait-clair px-4 py-8">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 text-sm text-encre">
        <span>
          {SHOP.name} · {SHOP.city} · Suivre une commande
          <span className="ml-3 font-mono text-xs text-encre-doux">Prototype P16 : rien n’est enregistré</span>
        </span>
        <span className="inline-flex items-center gap-2">
          Boutique propulsée par <Logo tone="inherit" className="[&_.large]:text-base" />
        </span>
      </div>
    </footer>
  );
}

/* ---------- Les deux écrans ---------- */

export function PrototypeVitrine() {
  const { cart, add, change, lines, count } = useProtoCart();
  const [mode, setMode] = useMode();
  const [category, setCategory] = useState("Tout");
  const categories = useMemo<[string, number][]>(() => {
    const counts = new Map<string, number>();
    for (const product of PRODUCTS) counts.set(product.category, (counts.get(product.category) ?? 0) + 1);
    return [["Tout", PRODUCTS.length], ...counts];
  }, []);
  const shown = PRODUCTS.filter((product) => category === "Tout" || product.category === category);

  return (
    <div data-motion="full" className="surface-orange relative isolate min-h-dvh scheme-light">
      <FondOrange />
      <Header count={count} />
      <div className="mx-auto flex max-w-[1180px] flex-col gap-6 px-3 pt-3 pb-28 md:px-5 lg:gap-8 lg:pb-16">
        <Cover onAdd={() => add(FEATURED)} />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_330px]">
          <main id="collection" className="flex min-w-0 flex-col gap-4">
            <Tabs categories={categories} active={category} onPick={setCategory} mode={mode} onMode={setMode} />
            <ul className={cn(mode === "grille" ? "grid grid-cols-2 gap-x-3 gap-y-5 xl:grid-cols-3" : "mx-auto flex w-full max-w-[540px] flex-col gap-10")}>
              {shown.map((product, index) => (
                <li key={product.id}>
                  <ProductCard product={product} quantity={cart[product.id] ?? 0} onAdd={() => add(product)} mode={mode} eager={index < 2} />
                </li>
              ))}
            </ul>
          </main>
          <Basket lines={lines} onChange={change} onCheckout={() => {}} checkingOut={false} />
        </div>
      </div>
      <MobileBar lines={lines} onCheckout={() => {}} />
      <Footer />
    </div>
  );
}

/** E6 : chaque produit a sa page et son lien. Le prototype montre « Ensemble wax Feuillage ». */
export function PrototypeProduit() {
  const product = FEATURED;
  const { cart, add, lines, count } = useProtoCart();
  const [quantity, setQuantity] = useState(1);
  const [shared, setShared] = useState<string | null>(null);
  const inCart = cart[product.id] ?? 0;
  const info = infoLine(SHOP.delivery_zones, SHOP.payment_methods);
  const choices = Array.from({ length: Math.min(product.max_quantity, 5) }, (_, i) => i + 1);

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, text: `${product.name} · ${formatFcfa(product.price)}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared("Lien copié : collez-le dans WhatsApp.");
    } catch {
      setShared(null);
    }
  }

  return (
    <div data-motion="full" className="surface-orange relative isolate min-h-dvh scheme-light">
      <FondOrange />
      <Header count={count} />
      <div className="mx-auto max-w-[1180px] px-3 pt-4 pb-28 md:px-5 lg:pb-16">
        <Link href={BASE} className="text-[13px] font-semibold text-encre-doux hover:text-encre">
          ← La collection
        </Link>
        <article className="mt-3 grid items-start gap-6 lg:grid-cols-[minmax(0,540px)_minmax(0,1fr)] lg:gap-12">
          <div className="lg:sticky lg:top-24">
            <Frame product={product} quantity={inCart} onAdd={() => add(product)} size="page" eager />
            <p className="mt-2 px-1 text-[12px] text-encre-doux">
              <span className="lg:hidden">Touchez à droite ou à gauche pour feuilleter. Écartez deux doigts pour zoomer.</span>
              <span className="hidden lg:inline">Cliquez à droite ou à gauche de la photo, ou utilisez les flèches du clavier.</span>
            </p>
          </div>

          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <p className="font-mono text-xs tracking-[0.08em] text-encre uppercase">
                {product.category} · {product.images.length} photos
              </p>
              <h1 className="large text-[clamp(30px,4vw,46px)] leading-[0.98] font-extrabold text-balance">{product.name}</h1>
              <div className="mt-1 flex items-center justify-between gap-4">
                <Price value={product.price} className="text-[28px]" />
                <button type="button" onClick={share} className="bouton-verre inline-flex size-11 items-center justify-center rounded-full" aria-label={`Partager ${product.name}`}>
                  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 14.5V3.5M8 7.2 12 3.5l4 3.7" />
                    <path d="M8.5 10.5H6.8a1.8 1.8 0 0 0-1.8 1.8v6.4a1.8 1.8 0 0 0 1.8 1.8h10.4a1.8 1.8 0 0 0 1.8-1.8v-6.4a1.8 1.8 0 0 0-1.8-1.8h-1.7" />
                  </svg>
                </button>
              </div>
              <div aria-live="polite">{shared ? <p className="text-[13px] font-semibold">{shared}</p> : null}</div>
            </div>

            <p className="max-w-[56ch] text-[15px] leading-relaxed">{product.description}</p>

            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <span id="quantite" className="text-[13px] font-semibold text-encre-doux">
                  Quantité
                </span>
                <div role="radiogroup" aria-labelledby="quantite" className="flex gap-1.5">
                  {choices.map((choice) => (
                    <button
                      key={choice}
                      type="button"
                      role="radio"
                      aria-checked={quantity === choice}
                      onClick={() => setQuantity(choice)}
                      className="ess-quantite"
                    >
                      {choice}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => add(product, quantity)} className="bouton-nuit rounded-full px-6 py-3.5 text-[15px] font-bold">
                {inCart > 0 ? `Dans le panier : ${inCart} · en ajouter ${quantity}` : `Ajouter au panier · ${formatFcfa(product.price * quantity)}`}
              </button>
            </div>

            <ul className="flex flex-col gap-1.5 border-t border-trait-clair pt-4 text-[13.5px]">
              {info.map((part) => (
                <li key={part} className="first-letter:uppercase">
                  {part}
                </li>
              ))}
            </ul>
          </div>
        </article>
      </div>
      <MobileBar lines={lines} onCheckout={() => {}} />
      <Footer />
    </div>
  );
}
