"use client";

import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import type { Accent, PublicProduct, SectionId, Storefront, StorefrontDesign } from "@/lib/types";

import { ACCENTS } from "../accent";
import type { Line } from "../catalogue";
import { preorderText } from "../product-details";
import { Scene } from "./scene";

/** Ce que la vitrine donne à un thème : les données, le panier et ses gestes. */
export type ThemeProps = {
  shop: Storefront;
  products: PublicProduct[];
  design: StorefrontDesign;
  cart: Readonly<Record<string, number>>;
  lines: Line[];
  count: number;
  closed: boolean;
  /** Le produit de couverture (à la une, sinon le plus vendu, sinon le plus cher). */
  featured: PublicProduct | null;
  popular: PublicProduct[];
  onChange: (product: PublicProduct, quantity: number) => void;
  onCheckout: () => void;
  /** Aperçu de « Ma boutique » : on regarde, on ne commande pas. */
  preview: boolean;
};

/** Les classes d'un thème, que les parties communes reprennent. */
export type Tone = {
  muted: string;
  card: string;
  line: string;
  heading: string;
  button: string;
  ghost: string;
};

// Sur un fond sombre, un texte prend la teinte claire de la couleur (4,5:1 au moins sur la nuit).
const ON_DARK: Record<Accent, string> = { orange: "#ff9b52", indigo: "#a3abff", ocre: "#f2b33d", corail: "#ff8a76", lagune: "#7cc0e8" };

export function accentOf(shop: Storefront) {
  const accent = ACCENTS[shop.accent] ? shop.accent : "orange";
  return { ...ACCENTS[accent], onDark: ON_DARK[accent] };
}

/** Un délai de livraison et ce qu'il couvre : « Abidjan · sous 24 h · dès 1 500 F ». */
export function deliveryGroups(shop: Storefront) {
  const groups = new Map<number, { cities: string[]; from: number }>();
  for (const zone of shop.delivery_zones) {
    const group = groups.get(zone.delay_hours) ?? { cities: [], from: zone.fee };
    if (!group.cities.includes(zone.city)) group.cities.push(zone.city);
    group.from = Math.min(group.from, zone.fee);
    groups.set(zone.delay_hours, group);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hours, { cities, from }]) => ({
      hours,
      from,
      where: cities.length > 2 ? `${cities.slice(0, 2).join(", ")} et ${cities.length - 2} autre${cities.length > 3 ? "s" : ""} ville${cities.length > 3 ? "s" : ""}` : cities.join(" et "),
    }));
}

export function paymentLine(shop: Storefront) {
  const labels = shop.payment_methods.map((method) => method.label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} ou ${labels.at(-1)?.toLowerCase()}` : (labels[0] ?? "");
}

/** Un mot découpé en lettres qui montent une à une ; le lecteur d'écran lit le mot entier (aria-label du parent). */
export function Letters({ text, start = 0, step = 60, className }: { text: string; start?: number; step?: number; className?: string }) {
  return (
    <span aria-hidden className={cn("inline-flex overflow-hidden pb-[0.06em]", className)}>
      {Array.from(text).map((char, index) => (
        <span key={index} className="th-enter th-rise inline-block" style={{ animationDelay: `${start + index * step}ms` }}>
          {char === " " ? " " : char}
        </span>
      ))}
    </span>
  );
}

/** Ajouter, ou la quantité si l'article est déjà au panier. */
export function AddControl({
  product,
  quantity,
  onChange,
  tone,
  compact = false,
}: {
  product: PublicProduct;
  quantity: number;
  onChange: (product: PublicProduct, quantity: number) => void;
  tone: Tone;
  compact?: boolean;
}) {
  if (!product.orderable) return <span className={cn("text-[13px] font-semibold", tone.muted)}>Épuisé</span>;
  if (quantity > 0) {
    return (
      <div role="group" aria-label={`Quantité : ${product.name}`} className={cn("inline-flex items-center gap-0.5 rounded-full p-0.5", tone.button)}>
        <button type="button" onClick={() => onChange(product, quantity - 1)} aria-label={quantity === 1 ? `Retirer ${product.name} du panier` : "Une de moins"} className="grid size-10 place-items-center rounded-full text-lg font-bold">
          −
        </button>
        <output aria-live="polite" className="min-w-[2ch] text-center text-sm font-bold">
          {quantity}
        </output>
        <button type="button" onClick={() => onChange(product, quantity + 1)} disabled={quantity >= product.max_quantity} aria-label="Une de plus" className="grid size-10 place-items-center rounded-full text-lg font-bold disabled:opacity-40">
          +
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onChange(product, 1)}
      aria-label={`Ajouter ${product.name} au panier`}
      className={cn("min-h-11 rounded-full font-bold whitespace-nowrap", compact ? "min-w-11 px-3 text-lg" : "px-4 text-sm", tone.ghost)}
    >
      {compact ? "+" : "Ajouter"}
    </button>
  );
}

/** « Plus qu'une pièce », « Plus que quelques pièces » : ce qui aide à décider, sans le stock exact. */
export function StockHint({ product, className }: { product: PublicProduct; className?: string }) {
  if (!product.orderable) return null;
  if (!product.in_stock) return <span className={className}>{preorderText(product.backorder_days)}</span>;
  if (product.max_quantity === 1) return <span className={className}>Plus qu’une pièce</span>;
  if (product.low_stock) return <span className={className}>Plus que quelques pièces</span>;
  return null;
}

export function SectionTitle({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  return (
    <h2 id={id} className={cn("th-reveal th-up", className)}>
      {children}
    </h2>
  );
}

/* ---------- Les parties communes, dans l'ordre choisi par le marchand ---------- */

export function DeliverySection({ shop, tone, className }: { shop: Storefront; tone: Tone; className?: string }) {
  return (
    <Scene as="section" aria-labelledby="titre-livraison" className={cn("flex flex-col gap-3", className)}>
      <SectionTitle id="titre-livraison" className={tone.heading}>
        Livraison et paiement
      </SectionTitle>
      <ul className="grid gap-2.5 md:grid-cols-3">
        {deliveryGroups(shop).map((group, index) => (
          <li key={group.hours} className={cn("th-reveal th-up flex flex-col gap-1 rounded-[18px] p-4", tone.card)} style={{ animationDelay: `${120 + index * 110}ms` }}>
            <span className="large text-2xl font-extrabold">sous {group.hours} h</span>
            <span className="text-[14px] font-semibold">{group.where}</span>
            <span className={cn("text-[13px]", tone.muted)}>livraison dès {formatFcfa(group.from)}</span>
          </li>
        ))}
      </ul>
      <p className={cn("th-reveal th-up text-[14px]", tone.muted)} style={{ animationDelay: "420ms" }}>
        Paiement : {paymentLine(shop)}.
      </p>
    </Scene>
  );
}

export function PopularSection({ props, tone, className }: { props: ThemeProps; tone: Tone; className?: string }) {
  if (props.popular.length === 0) return null;
  return (
    <Scene as="section" aria-labelledby="titre-demandes" className={cn("flex flex-col gap-3", className)}>
      <SectionTitle id="titre-demandes" className={tone.heading}>
        Les plus demandés
      </SectionTitle>
      <ul className="grid grid-cols-3 gap-2.5">
        {props.popular.map((product, index) => (
          <li key={product.id} className={cn("th-reveal th-up relative flex flex-col gap-2 rounded-[16px] p-2", tone.card)} style={{ animationDelay: `${100 + index * 110}ms` }}>
            <div className="relative h-20 overflow-hidden rounded-[11px] md:h-32">
              <ProductImage product={product} />
            </div>
            <span className="line-clamp-2 text-[12.5px] leading-tight font-semibold md:text-sm">{product.name}</span>
            <span
              className={cn("th-reveal th-drop absolute -top-2 -right-1.5 rounded-lg border-[1.5px] border-encre px-2 py-1 text-[13px] font-extrabold shadow-[2px_2px_0_#17110a]", accentOf(props.shop).disc)}
              style={{ animationDelay: `${380 + index * 150}ms` }}
            >
              {formatNumber(product.price)} F
            </span>
            <div className="mt-auto">
              <AddControl product={product} quantity={props.cart[product.id] ?? 0} onChange={props.onChange} tone={tone} compact />
            </div>
          </li>
        ))}
      </ul>
    </Scene>
  );
}

export function StorySection({ shop, design, tone, className, kicker = true }: { shop: Storefront; design: StorefrontDesign; tone: Tone; className?: string; kicker?: boolean }) {
  if (!design.texts.story) return null;
  return (
    <Scene as="section" aria-labelledby="titre-histoire" className={cn("flex max-w-[62ch] flex-col gap-3", className)}>
      {kicker ? (
        <p className={cn("th-reveal th-up font-mono text-xs tracking-[0.1em] uppercase", tone.muted)}>
          Notre histoire{shop.city ? ` · ${shop.city}` : ""}
        </p>
      ) : null}
      <h2 id="titre-histoire" className="sr-only">
        Notre histoire
      </h2>
      <p className="th-reveal th-blur text-[clamp(1.15rem,2.4vw,1.5rem)] leading-snug whitespace-pre-line" style={{ animationDelay: "150ms" }}>
        {design.texts.story}
      </p>
    </Scene>
  );
}

export function TrackSection({ shop, tone, className }: { shop: Storefront; tone: Tone; className?: string }) {
  return (
    <Scene as="section" aria-labelledby="titre-suivi" className={cn("th-reveal th-up flex flex-wrap items-center justify-between gap-3 rounded-[20px] p-5", tone.card, className)}>
      <div className="flex flex-col gap-1">
        <h2 id="titre-suivi" className="text-base font-bold">
          Déjà commandé ?
        </h2>
        <p className={cn("text-[14px]", tone.muted)}>La référence et les 4 derniers chiffres de votre numéro suffisent.</p>
      </div>
      <Link href={`/boutique/${shop.slug}/suivi`} className={cn("inline-flex min-h-11 items-center rounded-full px-5 text-sm font-bold", tone.ghost)}>
        Suivre une commande
      </Link>
    </Scene>
  );
}

/** Rend les sections dans l'ordre du marchand ; `collection` est fournie par le thème. */
export function Sections({ props, tone, collection, className }: { props: ThemeProps; tone: Tone; collection: ReactNode; className?: string }) {
  const render: Record<SectionId, () => ReactNode> = {
    livraison: () => <DeliverySection shop={props.shop} tone={tone} />,
    demandes: () => <PopularSection props={props} tone={tone} />,
    collection: () => collection,
    histoire: () => <StorySection shop={props.shop} design={props.design} tone={tone} />,
    suivi: () => <TrackSection shop={props.shop} tone={tone} />,
  };
  return (
    <div className={cn("flex flex-col gap-10", className)}>
      {props.design.sections.map((section) => (
        <div key={section}>{render[section]()}</div>
      ))}
    </div>
  );
}

/** La photo du produit, ou le visuel de son rayon (le même que la vitrine Essentiel). */
export function ProductImage({ product, className, style }: { product: PublicProduct; className?: string; style?: CSSProperties }) {
  if (product.image_url) {
    return (
      // Photo relayée par /boutique/[slug]/photo, ou hébergée ailleurs (https vérifié par Django) : pas de next/image.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={product.image_url} alt="" loading="lazy" className={cn("absolute inset-0 size-full object-cover", className)} style={style} />
    );
  }
  return (
    <div aria-hidden className={cn("absolute inset-0 bg-gradient-to-br", ART[product.category] ?? DEFAULT_ART_CLASS, className)} style={style}>
      <div className="vit-flutes absolute inset-0" />
      <span className="large absolute right-2 -bottom-3 text-[clamp(56px,9vw,110px)] leading-none font-extrabold text-white/25">{product.name.trim().charAt(0).toUpperCase()}</span>
    </div>
  );
}

const ART: Record<string, string> = {
  Beauté: "from-[#6e2742] via-corail to-ocre",
  Épicerie: "from-[#8f3410] via-[#d9601c] to-ocre",
  Artisanat: "from-indigo via-[#3b6fb0] to-lagune",
};
const DEFAULT_ART_CLASS = "from-[#3a2a20] via-[#6b4a35] to-orange";

/** Le pied de page commun : suivi, et la mention Akwaba. */
export function ThemeFooter({ shop, tone, className }: { shop: Storefront; tone: Tone; className?: string }) {
  return (
    <footer className={cn("mt-auto px-4 py-8", className)}>
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-4 text-sm">
        <span>
          {shop.name}
          {shop.city ? ` · ${shop.city}` : ""}
          {" · "}
          <Link href={`/boutique/${shop.slug}/suivi`} className="underline-offset-2 hover:underline">
            Suivre une commande
          </Link>
        </span>
        <Link href="/" className={cn("hover:underline", tone.muted)}>
          Boutique propulsée par <strong className="large font-extrabold">akwaba</strong>
        </Link>
      </div>
    </footer>
  );
}

/** Le bouton panier des en-têtes de thème. */
export function CartButton({ count, onCheckout, closed, className }: { count: number; onCheckout: () => void; closed: boolean; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => count > 0 && !closed && onCheckout()}
      aria-label={`Panier : ${count} article${count > 1 ? "s" : ""}`}
      className={cn("inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold", className)}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M7.5 10c0-4.2 9-4.2 9 0M3.5 10h17M4.8 10l1.7 9.5h11l1.7-9.5" />
      </svg>
      <span aria-hidden>Panier {count}</span>
    </button>
  );
}
