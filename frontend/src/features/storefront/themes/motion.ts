/**
 * Les gestes communs aux 5 styles : l'objet touché ne disparaît jamais (FLIP) et une copie vole jusqu'au panier.
 * Web Animations seulement (transform, opacity) ; rien ne bouge si le téléphone demande moins d'animations
 * ou si le marchand a choisi « Aucun » (data-motion="none" sur la vitrine).
 */

export function motionAllowed(node?: Element | null): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return false;
  const root = (node ?? document.body).closest("[data-motion]");
  return root?.getAttribute("data-motion") !== "none";
}

/** Fait grandir `el` depuis la place de `from` (rectangle mesuré avant l'ouverture). */
export function flipFrom(el: HTMLElement, from: DOMRect, duration = 520): Animation | null {
  if (!motionAllowed(el)) return null;
  const to = el.getBoundingClientRect();
  if (!to.width || !to.height) return null;
  const dx = from.left - to.left;
  const dy = from.top - to.top;
  const sx = from.width / to.width;
  const sy = from.height / to.height;
  return el.animate(
    [
      { transformOrigin: "top left", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
      { transformOrigin: "top left", transform: "none" },
    ],
    { duration, easing: "cubic-bezier(.22,1,.36,1)" },
  );
}

/** Le compteur du panier rebondit : la cible porte data-cart-target. */
export function bumpCart() {
  const target = document.querySelector<HTMLElement>("[data-cart-target]");
  if (!target || !motionAllowed(target)) return;
  target.animate([{ transform: "scale(1)" }, { transform: "scale(1.18)" }, { transform: "scale(1)" }], { duration: 420, easing: "cubic-bezier(.22,1,.36,1)" });
}

/**
 * Une copie de `from` (une photo, une carte) vole en arc jusqu'à l'élément [data-cart-target].
 * x avance d'un pas régulier, y accélère : l'arc retombe dans le panier.
 */
export function flyToCart(from: Element | null) {
  const target = document.querySelector<HTMLElement>("[data-cart-target]");
  if (!from || !target || !motionAllowed(from)) {
    bumpCart();
    return;
  }
  const a = from.getBoundingClientRect();
  const b = target.getBoundingClientRect();
  const ghost = from.cloneNode(true) as HTMLElement;
  ghost.removeAttribute("id");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${a.left}px`,
    top: `${a.top}px`,
    width: `${a.width}px`,
    height: `${a.height}px`,
    margin: "0",
    zIndex: "80",
    pointerEvents: "none",
    borderRadius: "16px",
    overflow: "hidden",
  });
  const lane = document.createElement("div");
  Object.assign(lane.style, { position: "fixed", inset: "0", zIndex: "80", pointerEvents: "none" });
  lane.appendChild(ghost);
  document.body.appendChild(lane);
  const tx = b.left + b.width / 2 - (a.left + a.width / 2);
  const ty = b.top + b.height / 2 - (a.top + a.height / 2);
  const across = lane.animate([{ transform: "translateX(0)" }, { transform: `translateX(${tx}px)` }], { duration: 680, easing: "linear", fill: "forwards" });
  ghost.animate(
    [
      { transform: "translateY(0) scale(1)", opacity: 1 },
      { transform: `translateY(${ty}px) scale(0.14)`, opacity: 0.85 },
    ],
    { duration: 680, easing: "cubic-bezier(.55,0,1,.45)", fill: "forwards" },
  );
  across.onfinish = () => {
    lane.remove();
    bumpCart();
  };
}

/** Sans accents ni majuscules : « Pointe » trouve « pointes », « ciment » trouve « Ciment CPJ ». */
export function fold(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}
