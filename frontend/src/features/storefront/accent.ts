import type { Accent } from "@/lib/types";

/**
 * La couleur choisie par le marchand. L'API ne renvoie qu'un nom pris dans une liste fermée :
 * c'est ici qu'il devient des classes, toutes vérifiées pour le contraste (4,5:1 au minimum).
 */
export const ACCENTS: Record<Accent, { button: string; text: string; soft: string; hex: string }> = {
  orange: { button: "bg-orange text-encre hover:bg-orange-clair", text: "text-[#b04a06]", soft: "bg-orange/15", hex: "#ff7a1f" },
  indigo: { button: "bg-indigo text-creme hover:bg-[#5d69e0]", text: "text-indigo", soft: "bg-indigo/12", hex: "#4a57d6" },
  ocre: { button: "bg-ocre text-encre hover:bg-[#f5c262]", text: "text-[#7d5300]", soft: "bg-ocre/20", hex: "#f2b33d" },
  // Crème sur le lagune de la palette ne fait que 3,8:1 : le bouton prend une teinte plus foncée.
  lagune: { button: "bg-[#237264] text-creme hover:bg-[#2b8273]", text: "text-[#237264]", soft: "bg-lagune/15", hex: "#2e8c7a" },
  // Même chose pour le corail : texte encre plutôt que crème.
  corail: { button: "bg-corail text-encre hover:bg-[#ee6c58]", text: "text-[#b23a26]", soft: "bg-corail/15", hex: "#e8553f" },
};

/** Visuel de remplacement quand le produit n'a pas de photo : une couleur par rayon. */
export const CATEGORY_ART: Record<string, string> = {
  Beauté: "from-ocre via-[#e9905a] to-corail",
  Épicerie: "from-orange via-[#f59a3a] to-ocre",
  Artisanat: "from-indigo via-[#3b6fb0] to-lagune",
};

export const DEFAULT_ART = "from-[#3a2a20] via-[#6b4a35] to-orange";
