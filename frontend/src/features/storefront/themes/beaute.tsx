"use client";

import { formatNumber } from "@/lib/format";

import { AddControl, accentOf, CartButton, Letters, ProductImage, Sections, StockHint, ThemeFooter, type ThemeProps, type Tone } from "./parts";
import { Scene } from "./scene";

const TONE: Tone = {
  muted: "text-encre-doux",
  card: "bg-[#fffaf2] shadow-[0_14px_30px_rgb(36_112_159/0.12)]",
  line: "border-[#e8d6b8]",
  heading: "large text-[clamp(1.4rem,3vw,1.9rem)] font-light",
  button: "bg-[#24709f] text-white",
  ghost: "bg-[#24709f] text-white",
};

// Une vague dessinée deux fois de suite : en glissant de la moitié de sa largeur, elle boucle sans à-coup.
const WAVE = "M0 40 C 65 20, 130 20, 195 40 S 325 60, 390 40 S 520 20, 585 40 S 715 60, 780 40 V80 H0 Z";

/** Beauté : de l'air, de la lumière, et la description du produit en avant (docs/chantier-p5.md §3.1). */
export function BeauteTheme(props: ThemeProps) {
  const { shop, design, featured } = props;
  const accent = accentOf(shop);
  // Le soleil prend la couleur de la boutique ; avec la lagune (déjà la couleur de l'eau), il reste ocre.
  const sun = shop.accent === "lagune" ? "#f2b33d" : accent.hex;

  return (
    <div className="flex min-h-dvh flex-col bg-[#f7ecd9] text-encre">
      <section aria-label={`Couverture de ${shop.name}`} className="relative overflow-hidden bg-gradient-to-b from-[#fbf3e6] via-[#f7e2c2] to-[#f3d2a4]">
        <header className="relative z-10 mx-auto flex max-w-[1180px] items-center justify-between gap-3 px-5 py-4">
          <span className="th-enter th-blur text-sm font-semibold tracking-wide">{shop.name}</span>
          <CartButton count={props.count} onCheckout={props.onCheckout} closed={props.closed} className="bg-white/70 text-encre shadow-[0_6px_18px_rgb(36_112_159/0.18)]" />
        </header>
        <div className="relative z-10 mx-auto grid max-w-[1180px] gap-6 px-5 pt-4 pb-28 md:grid-cols-2 md:items-center md:pb-36">
          <div className="flex flex-col gap-3">
            <h1 aria-label={shop.name} className="large text-[clamp(2.6rem,9vw,5rem)] leading-[0.95] font-light">
              {shop.name.split(" ").map((word, index) => (
                <span key={index} className={index % 2 ? "block font-extrabold" : "block"}>
                  <Letters text={word} start={150 + index * 400} step={60} />
                </span>
              ))}
            </h1>
            {design.texts.tagline || shop.description ? (
              <p className="th-enter th-blur max-w-[34ch] text-[15px] leading-relaxed text-encre-doux" style={{ animationDelay: "1100ms" }}>
                {design.texts.tagline || shop.description}
              </p>
            ) : null}
          </div>
          <div className="relative mx-auto h-[260px] w-[260px] md:h-[340px] md:w-[340px]">
            <div aria-hidden className="th-enter th-sun absolute inset-[8%] rounded-full" style={{ background: `radial-gradient(circle at 40% 40%, ${sun}, ${sun} 60%, rgb(255 255 255 / 0) 72%)`, animationDelay: "300ms" }} />
            {featured ? (
              <div className="th-loop th-float absolute inset-x-[16%] top-[12%] bottom-[6%]" style={{ animationDelay: "2.4s" }}>
                <div className="th-enter th-circle absolute inset-0 overflow-hidden rounded-t-[999px] rounded-b-[28px] shadow-[0_20px_40px_rgb(36_112_159/0.25)]" style={{ animationDelay: "1200ms" }}>
                  <ProductImage product={featured} />
                </div>
              </div>
            ) : null}
          </div>
        </div>
        <svg viewBox="0 0 780 80" preserveAspectRatio="none" aria-hidden className="th-loop th-wave-back absolute bottom-6 left-0 h-16 w-[200%]">
          <path d={WAVE} fill="#7cc0e8" opacity="0.55" />
        </svg>
        <svg viewBox="0 0 780 80" preserveAspectRatio="none" aria-hidden className="th-loop th-wave absolute -bottom-1 left-0 h-16 w-[200%]">
          <path d={WAVE} fill="#24709f" />
        </svg>
      </section>

      {featured ? (
        <section aria-labelledby="titre-une" className="bg-[#24709f] text-white">
          <Scene className="mx-auto flex max-w-[1180px] flex-col gap-2 px-5 pt-3 pb-9">
            <p className="th-reveal th-up font-mono text-xs tracking-[0.1em] uppercase">À la une</p>
            <h2 id="titre-une" className="th-reveal th-up large text-[clamp(1.6rem,4vw,2.4rem)] leading-tight font-bold" style={{ animationDelay: "100ms" }}>
              {featured.name}
            </h2>
            {featured.description ? (
              <p className="th-reveal th-up max-w-[56ch] text-[15px] leading-relaxed" style={{ animationDelay: "200ms" }}>
                {featured.description}
              </p>
            ) : null}
            <div className="th-reveal th-up flex items-center gap-4 pt-2" style={{ animationDelay: "300ms" }}>
              <span className="large text-[26px] font-extrabold">{formatNumber(featured.price)} F</span>
              <AddControl product={featured} quantity={props.cart[featured.id] ?? 0} onChange={props.onChange} tone={{ ...TONE, button: accent.disc, ghost: accent.disc }} />
            </div>
          </Scene>
        </section>
      ) : null}

      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-12 px-5 pt-10 pb-32">
        <Sections props={props} tone={TONE} collection={<BeauteCollection {...props} />} />
      </main>
      <ThemeFooter shop={shop} tone={TONE} />
    </div>
  );
}

function BeauteCollection({ products, cart, onChange }: ThemeProps) {
  return (
    <Scene as="section" id="collection" aria-labelledby="titre-collection" className="flex scroll-mt-24 flex-col gap-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="titre-collection" className={`th-reveal th-up ${TONE.heading}`}>
          La <strong className="font-extrabold">collection</strong>
        </h2>
        <span className="text-[13px] text-encre-doux">
          {products.length} article{products.length > 1 ? "s" : ""}
        </span>
      </div>
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {products.map((product, index) => (
          <li key={product.id} className="th-reveal th-up" style={{ animationDelay: `${Math.min(index, 8) * 90}ms` }}>
            <article className={`th-loop th-float flex h-full flex-col gap-2 rounded-[28px] p-2.5 ${TONE.card}`} style={{ animationDelay: `${-index * 1.3}s` }}>
              <div className="relative aspect-square overflow-hidden rounded-[22px]">
                <ProductImage product={product} />
              </div>
              <h3 className="px-1.5 text-[14px] leading-snug font-semibold">{product.name}</h3>
              {product.description ? <p className="line-clamp-2 px-1.5 text-[12.5px] leading-snug text-encre-doux">{product.description}</p> : null}
              <div className="mt-auto flex items-center justify-between gap-2 px-1.5 pt-1">
                <span className="flex min-w-0 flex-col">
                  <span className="large text-[clamp(14.5px,4vw,17px)] font-extrabold whitespace-nowrap text-[#1d5d85]">{formatNumber(product.price)} F</span>
                  <StockHint product={product} className="text-[11.5px] font-semibold text-[#5c3d00]" />
                </span>
                <AddControl product={product} quantity={cart[product.id] ?? 0} onChange={onChange} tone={TONE} compact />
              </div>
            </article>
          </li>
        ))}
      </ul>
    </Scene>
  );
}
