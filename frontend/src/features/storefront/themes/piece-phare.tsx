"use client";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

import { AddControl, accentOf, CartButton, ProductImage, Sections, StockHint, StorySection, ThemeFooter, type ThemeProps, type Tone } from "./parts";
import { Scene } from "./scene";

const TONE: Tone = {
  muted: "text-texte-2",
  card: "border border-trait bg-nuit-2",
  line: "border-trait",
  heading: "large text-[clamp(1.4rem,3vw,1.9rem)] font-bold",
  button: "bg-creme text-encre",
  ghost: "border border-[rgb(240_221_186/0.4)] text-creme",
};

/** Pièce phare : une image qui prend toute la place, puis de grandes fiches (docs/chantier-p5.md §3.1). */
export function PiecePhareTheme(props: ThemeProps) {
  const { shop, design, featured } = props;
  const accent = accentOf(shop);
  const words = (featured ? featured.name : shop.name).split(" ");
  // L'histoire est racontée sous la couverture : on ne la répète pas dans les sections.
  const sections = { ...props, design: { ...design, sections: design.sections.filter((section) => section !== "histoire") } };
  const storyFirst = design.sections.includes("histoire");
  // Le grand titre est la pièce à la une : le nom de la boutique, en haut, reste le titre de la page.
  const ShopName = featured ? "h1" : "span";
  const Title = featured ? "h2" : "h1";

  return (
    <div className="flex min-h-dvh flex-col bg-nuit text-creme">
      <section aria-label={`Couverture de ${shop.name}`} className="relative isolate flex min-h-[min(86svh,760px)] flex-col overflow-hidden">
        <div className="th-loop th-drift absolute inset-0 -z-10">
          {featured ? <ProductImage product={featured} /> : <div className="absolute inset-0 bg-[#3b2417]" />}
        </div>
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(circle,rgb(250_244_234/0.06)_0_1px,transparent_1px)] [background-size:5px_5px]" />
        <div aria-hidden className="absolute inset-0 -z-10" style={{ backgroundImage: `linear-gradient(180deg, rgb(14 12 10 / 0.55) 0%, rgb(14 12 10 / 0.1) 35%, rgb(14 12 10 / 0.92) 82%), radial-gradient(60% 40% at 80% 70%, ${accent.hex}55, transparent 70%)` }} />
        <header className="mx-auto flex w-full max-w-[1180px] items-center justify-between gap-3 px-5 py-4">
          <ShopName className="th-enter th-blur font-mono text-xs tracking-[0.16em] uppercase">{shop.name}</ShopName>
          <CartButton count={props.count} onCheckout={props.onCheckout} closed={props.closed} className="text-creme underline underline-offset-4" />
        </header>
        <div className="mx-auto mt-auto flex w-full max-w-[1180px] flex-col gap-3 px-5 pb-10">
          {featured ? (
            <p className="th-enter th-blur font-mono text-xs tracking-[0.12em] uppercase" style={{ animationDelay: "500ms", color: accent.onDark }}>
              À la une
            </p>
          ) : null}
          <Title className="large max-w-[16ch] text-[clamp(2.4rem,8vw,5.4rem)] leading-[0.98] font-extrabold">
            {words.map((word, index) => (
              <span key={index}>
                <span className="th-enter th-blur inline-block" style={{ animationDelay: `${700 + index * 140}ms` }}>
                  {word}
                </span>{" "}
              </span>
            ))}
          </Title>
          {featured ? (
            <>
              {featured.description ? (
                <p className="th-enter th-blur max-w-[52ch] text-[15px] leading-relaxed text-texte-2" style={{ animationDelay: "1400ms" }}>
                  {featured.description}
                </p>
              ) : null}
              <div className="th-enter th-blur flex flex-wrap items-center gap-4 pt-1" style={{ animationDelay: "1600ms" }}>
                <span className="large text-[28px] font-extrabold" style={{ color: accent.onDark }}>
                  {formatNumber(featured.price)} F
                </span>
                <AddControl product={featured} quantity={props.cart[featured.id] ?? 0} onChange={props.onChange} tone={{ ...TONE, button: accent.disc, ghost: accent.disc }} />
              </div>
            </>
          ) : design.texts.tagline || shop.description ? (
            <p className="th-enter th-blur max-w-[52ch] text-[16px] leading-relaxed text-texte-2" style={{ animationDelay: "1300ms" }}>
              {design.texts.tagline || shop.description}
            </p>
          ) : null}
        </div>
      </section>

      <main className="mx-auto flex w-full max-w-[1180px] flex-col gap-14 px-5 pt-12 pb-32">
        {storyFirst ? <StorySection shop={shop} design={design} tone={TONE} /> : null}
        <Sections props={sections} tone={TONE} collection={<PiecePhareCollection {...props} />} />
      </main>
      <ThemeFooter shop={shop} tone={TONE} className="border-t border-trait" />
    </div>
  );
}

function PiecePhareCollection({ products, cart, onChange, shop }: ThemeProps) {
  const accent = accentOf(shop);
  return (
    <section id="collection" aria-labelledby="titre-collection" className="flex scroll-mt-24 flex-col gap-8">
      <Scene className="flex flex-col gap-2">
        <h2 id="titre-collection" className="th-reveal th-up text-[13px] font-semibold tracking-[0.08em] text-texte-2 uppercase">
          Les pièces · {products.length}
        </h2>
        <div aria-hidden className="th-reveal th-grow h-px bg-[rgb(240_221_186/0.35)]" />
      </Scene>
      <ul className="grid gap-12 md:grid-cols-2 md:gap-x-10">
        {products.map((product, index) => (
          <Scene as="li" key={product.id}>
            <article className="flex flex-col gap-3">
              <div className="th-reveal th-curtain relative aspect-[4/5] overflow-hidden rounded-[4px] md:aspect-[4/4.4]" style={{ animationDelay: `${(index % 2) * 160}ms` }}>
                <div className="th-loop th-drift absolute inset-0" style={{ animationDelay: `${-index * 3}s` }}>
                  <ProductImage product={product} />
                </div>
              </div>
              <div className="th-reveal th-blur flex items-baseline justify-between gap-3" style={{ animationDelay: "500ms" }}>
                <h3 className="large text-[clamp(1.15rem,2.4vw,1.4rem)] font-bold">{product.name}</h3>
                <span className="large text-lg font-extrabold whitespace-nowrap" style={{ color: accent.onDark }}>
                  {formatNumber(product.price)} F
                </span>
              </div>
              {product.description ? (
                <p className="th-reveal th-blur text-[14.5px] leading-relaxed text-texte-2" style={{ animationDelay: "600ms" }}>
                  {product.description}
                </p>
              ) : null}
              <div className={cn("th-reveal th-blur flex items-center gap-3")} style={{ animationDelay: "700ms" }}>
                <AddControl product={product} quantity={cart[product.id] ?? 0} onChange={onChange} tone={TONE} />
                <StockHint product={product} className="text-[13px] font-semibold text-texte-2" />
              </div>
            </article>
          </Scene>
        ))}
      </ul>
    </section>
  );
}
