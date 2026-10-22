"use client";

import type { CSSProperties } from "react";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { CoverSource, PublicProduct, Storefront } from "@/lib/types";

import { ACCENTS } from "./accent";
import { ProductArt } from "./catalogue";

/** Le sur-titre dit pourquoi ce produit est en couverture (docs/chantier-p5.md §2.4). */
const KICKER: Record<CoverSource, string> = {
  chosen: "À la une",
  best_seller: "La plus demandée",
  price: "La pièce du mois",
};

/**
 * Couverture façon magazine : le nom de la boutique en très grand, et un produit mis en avant :
 * celui que la boutique a mis à la une, sinon le plus vendu du mois, sinon le plus cher en stock.
 */
export function Cover({
  shop,
  featured,
  source,
  onAdd,
}: {
  shop: Storefront;
  featured: PublicProduct | null;
  source: CoverSource;
  onAdd: (product: PublicProduct) => void;
}) {
  const accent = ACCENTS[shop.accent];
  const minFee = Math.min(...shop.delivery_zones.map((zone) => zone.fee));
  const words = shop.name.toUpperCase().split(/\s+/);

  return (
    <section
      aria-label={`Couverture de ${shop.name}`}
      className="zone-sombre relative isolate h-[clamp(520px,60vw,660px)] overflow-hidden rounded-[28px] bg-nuit text-creme"
      style={{ "--accent": accent.hex } as CSSProperties}
    >
      <div aria-hidden className="absolute inset-0 -z-10 bg-[url('/decor.jpg')] bg-cover bg-center" />
      {featured ? (
        <div aria-hidden className="absolute inset-y-0 right-0 -z-10 w-[58%] opacity-55 mix-blend-screen [mask-image:linear-gradient(90deg,transparent,#000_45%)]">
          <ProductArt product={featured} />
        </div>
      ) : null}
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_80%_20%,color-mix(in_srgb,var(--accent)_45%,transparent),transparent_70%),linear-gradient(180deg,rgb(14_12_10/0.55)_0%,rgb(14_12_10/0)_32%,rgb(14_12_10/0)_45%,rgb(14_12_10/0.9)_100%)]"
      />

      <div className="vit-mast absolute inset-x-5 top-5 flex flex-col gap-2.5 md:inset-x-7 md:top-6">
        {shop.logo_version ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo relayé par /boutique/[slug]/logo (vérifié et réencodé par Django)
          <img
            src={`/boutique/${shop.slug}/logo?v=${encodeURIComponent(shop.logo_version)}`}
            alt={`Logo de ${shop.name}`}
            className="vit-fade h-[clamp(44px,5vw,64px)] w-auto max-w-[180px] self-start object-contain"
          />
        ) : null}
        <h1 aria-label={shop.name} className="large flex flex-wrap gap-x-[0.28em] text-[clamp(44px,10vw,132px)] leading-[0.84] font-extrabold tracking-[-0.02em]">
          {words.map((word, i) => (
            <span key={`${word}-${i}`} className="vit-word" aria-hidden>
              <span style={{ "--i": i } as CSSProperties}>{word}</span>
            </span>
          ))}
        </h1>
        <p className="vit-fade flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-texte-2" style={{ "--d": "0.6s" } as CSSProperties}>
          {shop.city ? <span>{shop.city}</span> : null}
          <span>
            {shop.product_count} article{shop.product_count > 1 ? "s" : ""}
          </span>
          <span>À la livraison ou par Mobile Money</span>
        </p>
      </div>

      <dl className="absolute top-[clamp(170px,17vw,220px)] right-7 hidden w-[280px] flex-col gap-3.5 rounded-[18px] border border-white/15 bg-nuit/60 p-4 backdrop-blur-md lg:flex">
        {[
          [`dès ${formatNumber(minFee)} F`, "la livraison dans le Grand Abidjan, en 24\u00a0h"],
          [`${shop.payment_methods.length} façons`, "de payer, dont Wave et Orange Money"],
          [`${shop.delivery_zones.length} zones`, "livrées, du Plateau à Korhogo"],
        ].map(([value, label], i) => (
          <div key={value} className={cn("vit-fade", i > 0 && "border-t border-white/25 pt-2.5")} style={{ "--d": `${0.9 + i * 0.1}s` } as CSSProperties}>
            <dt className="large text-[22px] leading-none font-extrabold" style={{ color: accent.hex }}>
              {value}
            </dt>
            <dd className="mt-1 text-[13.5px] leading-snug text-texte">{label}</dd>
          </div>
        ))}
      </dl>

      {featured ? (
        <>
          <div className="absolute inset-x-5 bottom-5 flex max-w-[560px] flex-col gap-2.5 md:inset-x-7 md:bottom-7">
            <p className="vit-fade font-mono text-xs tracking-[0.08em] text-sable uppercase" style={{ "--d": "1s" } as CSSProperties}>
              {KICKER[source]}
            </p>
            <h2 className="vit-fade large text-[clamp(26px,4vw,48px)] leading-[0.98] font-extrabold text-balance" style={{ "--d": "1.1s" } as CSSProperties}>
              {featured.name}
            </h2>
            {featured.description ? (
              <p className="vit-fade max-w-[46ch] text-sm text-texte-2" style={{ "--d": "1.2s" } as CSSProperties}>
                {featured.description}
              </p>
            ) : null}
            <div className="vit-fade mt-1 flex flex-wrap gap-2" style={{ "--d": "1.3s" } as CSSProperties}>
              <button type="button" onClick={() => onAdd(featured)} className="bouton-nuit rounded-full px-5 py-3 font-bold">
                Ajouter au panier
              </button>
              <a href="#collection" className="rounded-full border border-white/25 bg-white/5 px-5 py-3 font-semibold hover:bg-white/10">
                Voir la collection
              </a>
            </div>
          </div>

          <div aria-hidden className="vit-sticker vit-fade absolute top-[200px] right-4 size-[108px] md:top-auto md:right-8 md:bottom-8 md:size-[132px]" style={{ "--d": "1.5s" } as CSSProperties}>
            <svg viewBox="0 0 132 132" className="absolute inset-0 size-full">
              <defs>
                <path id="vit-cercle" d="M66 66 m-56 0 a56 56 0 1 1 112 0 a56 56 0 1 1 -112 0" />
              </defs>
              <text fontFamily="var(--font-plex-mono), monospace" fontSize="10.5" letterSpacing="2.4" fill="#f0ddba">
                <textPath href="#vit-cercle" textLength="348" lengthAdjust="spacing">
                  {`${KICKER[source].toUpperCase()} · ${shop.name.toUpperCase().slice(0, 18)} ·`}
                </textPath>
              </text>
            </svg>
            <div className={cn("absolute inset-[16px] grid place-items-center rounded-full text-center shadow-[0_10px_30px_rgb(0_0_0/0.35)] md:inset-[18px]", accent.disc)}>
              <span className="large text-[13px] leading-none font-extrabold md:text-[15px]">{formatNumber(featured.price)} F</span>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
