"use client";

import "./universe.css";

import { type CSSProperties, type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import type { PublicProduct } from "@/lib/types";

import { flyToCart, motionAllowed } from "./motion";
import { ProductImage, StockHint, type ThemeProps } from "./parts";

/** Les couleurs qu'un style donne à ses univers ; le fond, lui, vient de la photo quand c'est possible. */
export type UniverseLook = { ink: string; accent: string; onAccent: string; fallback: string };

export type UniverseOpen = { name: string; origin: { x: number; y: number } };

/** Ouvre un univers depuis l'élément touché : le décor s'ouvre en cercle à partir du doigt. */
export function universeFrom(name: string, el: HTMLElement): UniverseOpen {
  const r = el.getBoundingClientRect();
  return { name, origin: { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
}

/** La couleur moyenne d'une photo (même origine seulement), assombrie pour garder le texte lisible. */
function useDominantColor(src: string | null, fallback: string) {
  const [color, setColor] = useState(fallback);
  useEffect(() => {
    if (!src || (src.startsWith("http") && !src.startsWith(window.location.origin))) return;
    let alive = true;
    const img = new Image();
    img.decoding = "async";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 12;
        canvas.height = 12;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 12, 12);
        const data = ctx.getImageData(0, 0, 12, 12).data;
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < data.length; i += 4) {
          r += data[i];
          g += data[i + 1];
          b += data[i + 2];
        }
        const n = data.length / 4;
        // Assombri à 45 % : le texte clair reste lisible sur n'importe quelle photo.
        if (alive) setColor(`rgb(${Math.round((r / n) * 0.45)} ${Math.round((g / n) * 0.45)} ${Math.round((b / n) * 0.45)})`);
      } catch {
        /* image d'une autre origine : on garde la couleur du style */
      }
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return src ? color : fallback;
}

/**
 * L'univers d'une catégorie (décision du 24/11/2026, exemple « Jordan ») : on y entre, l'article tourne au centre,
 * on fait défiler toute la catégorie, et à l'arrêt sur un article son nom et son prix apparaissent.
 */
export function Universe({ open, products, props, look, onClose, uncategorized = "Divers" }: { open: UniverseOpen; products: PublicProduct[]; props: ThemeProps; look: UniverseLook; onClose: () => void; uncategorized?: string }) {
  const items = useMemo(() => {
    const inCat = products.filter((p) => (p.category.trim() || uncategorized) === open.name);
    const popular = props.popular.find((p) => inCat.some((x) => x.id === p.id));
    return popular ? [popular, ...inCat.filter((p) => p.id !== popular.id)] : inCat;
  }, [products, open.name, props.popular, uncategorized]);
  const [index, setIndex] = useState(0);
  const [settled, setSettled] = useState(true);
  const track = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  const current = items[Math.min(index, items.length - 1)];
  const bg = useDominantColor(current?.image_url ?? null, look.fallback);
  const inCart = current ? (props.cart[current.id] ?? 0) : 0;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    back.current?.focus({ preventScroll: true });
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (root.current && motionAllowed(root.current)) {
      root.current.animate(
        [{ clipPath: `circle(0px at ${open.origin.x}px ${open.origin.y}px)` }, { clipPath: `circle(150vmax at ${open.origin.x}px ${open.origin.y}px)` }],
        { duration: 650, easing: "cubic-bezier(.65,0,.35,1)" },
      );
    }
    return () => {
      document.body.style.overflow = previous;
      opener?.focus?.({ preventScroll: true });
    };
  }, [open.origin.x, open.origin.y]);

  // L'article au centre devient l'article courant ; le prix n'apparaît qu'à l'arrêt du défilement.
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pick = () => {
      const center = node.scrollLeft + node.clientWidth / 2;
      let best = 0;
      let distance = Infinity;
      node.querySelectorAll<HTMLElement>("[data-uv-item]").forEach((el, i) => {
        const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - center);
        if (d < distance) {
          distance = d;
          best = i;
        }
      });
      setIndex(best);
      setSettled(true);
    };
    const onScroll = () => {
      setSettled(false);
      clearTimeout(timer);
      timer = setTimeout(pick, 140);
    };
    node.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      node.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, []);

  const goTo = (i: number) => {
    const el = track.current?.querySelectorAll<HTMLElement>("[data-uv-item]")[i];
    el?.scrollIntoView({ behavior: motionAllowed() ? "smooth" : "auto", inline: "center", block: "nearest" });
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowRight") goTo(Math.min(items.length - 1, index + 1));
    if (e.key === "ArrowLeft") goTo(Math.max(0, index - 1));
  };

  const style = { "--uv-bg": bg, "--uv-ink": look.ink, "--uv-accent": look.accent, "--uv-on-accent": look.onAccent } as CSSProperties;

  return (
    <div ref={root} role="dialog" aria-modal="true" aria-label={`Univers ${open.name}`} className="uv" style={style} onKeyDown={onKey}>
      <div className="uv-haut">
        <button ref={back} type="button" onClick={onClose} className="uv-retour">
          ← Retour
        </button>
        <span className="uv-compte">
          {items.length} article{items.length > 1 ? "s" : ""}
        </span>
      </div>
      <p aria-hidden className="uv-titre">
        {open.name}
      </p>

      {current ? (
        <div className="uv-scene">
          <div key={current.id} className={cn("uv-plateau", !settled && "uv-plateau-file")}>
            <span className="uv-objet">
              <ProductImage product={current} />
            </span>
            <span className="uv-sol" aria-hidden />
          </div>
          <div className={cn("uv-info", settled && "uv-info-on")} aria-live="polite">
            <p className="uv-nom">{current.name}</p>
            <p className="uv-prix">
              {formatNumber(current.price)}
              <small> F</small>
            </p>
            {current.in_stock ? <StockHint product={current} className="uv-stock" /> : <span className="uv-stock">Épuisé</span>}
            {current.in_stock && inCart < current.max_quantity ? (
              <button
                type="button"
                className="uv-ajouter"
                onClick={() => {
                  props.onChange(current, inCart + 1);
                  flyToCart(root.current?.querySelector(".uv-objet") ?? null);
                }}
              >
                {inCart ? `Encore un · ${inCart} au panier` : `Ajouter · ${formatFcfa(current.price)}`}
              </button>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="uv-vide">Cette catégorie se remplit bientôt.</p>
      )}

      <div ref={track} className="uv-piste" aria-label={`Tous les articles ${open.name}`}>
        {items.map((p, i) => (
          <button key={p.id} type="button" data-uv-item className={cn("uv-vignette", i === index && "uv-vignette-on")} onClick={() => goTo(i)} aria-label={`${p.name}, ${formatFcfa(p.price)}`}>
            <ProductImage product={p} />
          </button>
        ))}
      </div>
    </div>
  );
}
