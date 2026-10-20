import type { Accent } from "@/lib/types";

/**
 * La couleur choisie par le marchand. L'API ne renvoie qu'un nom pris dans une liste fermée :
 * c'est ici qu'il devient des classes, vérifiées pour le contraste (4,5:1 au minimum).
 * Les boutons, eux, sont les mêmes partout (verre cannelé sombre) : la couleur du marchand
 * colore la couverture, ses chiffres et la pastille de prix.
 */
export const ACCENTS: Record<Accent, { disc: string; hex: string }> = {
  orange: { disc: "bg-orange text-encre", hex: "#ff7a1f" },
  indigo: { disc: "bg-indigo text-creme", hex: "#4a57d6" },
  ocre: { disc: "bg-ocre text-encre", hex: "#f2b33d" },
  // Crème sur le lagune de la palette ne fait que 3,8:1 : la pastille prend une teinte plus foncée.
  lagune: { disc: "bg-[#237264] text-creme", hex: "#2e8c7a" },
  // Même chose pour le corail : texte encre plutôt que crème.
  corail: { disc: "bg-corail text-encre", hex: "#e8553f" },
};

/**
 * Visuel de remplacement quand le produit n'a pas de photo : une couleur par rayon.
 * Teintes profondes : sur la vitre orangée, un visuel orange clair se confondrait avec le fond.
 */
export const CATEGORY_ART: Record<string, string> = {
  Beauté: "from-[#6e2742] via-corail to-ocre",
  Épicerie: "from-[#8f3410] via-[#d9601c] to-ocre",
  Artisanat: "from-indigo via-[#3b6fb0] to-lagune",
};

export const DEFAULT_ART = "from-[#3a2a20] via-[#6b4a35] to-orange";
