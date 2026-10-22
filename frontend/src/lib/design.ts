import { z } from "zod";

import { MOTIONS, SECTION_IDS, type SectionId, type StorefrontDesign, THEME_IDS, type ThemeId } from "./types";

// Les thèmes de la vitrine (docs/chantier-p5.md §3.1). Les règles sont celles de Django : ce fichier
// ne sert qu'à afficher et à revalider l'aperçu, qui reçoit sa configuration dans l'adresse.

export const THEME_META: Record<ThemeId, { label: string; pitch: string; forWho: string }> = {
  essentiel: { label: "Essentiel", pitch: "Une couverture façon magazine et la collection en cartes.", forWho: "Toute boutique" },
  epicerie: { label: "Épicerie", pitch: "Recherche, rayons et quantités sur place : on commande vite.", forWho: "Alimentation, produits du quotidien" },
  beaute: { label: "Beauté", pitch: "Fond sable, vagues et produits qui flottent, la description en avant.", forWho: "Cosmétiques, karité, soins" },
  artisanat: { label: "Artisanat", pitch: "Toile écrue, dessins au trait et l’histoire de la boutique.", forWho: "Fait main, pièces uniques" },
  "piece-phare": { label: "Pièce phare", pitch: "Une grande image pleine page et de grandes fiches.", forWho: "Peu de produits, ou un lancement" },
};

export const SECTION_LABEL: Record<SectionId, string> = {
  livraison: "Livraison et paiement",
  demandes: "Les plus demandés",
  collection: "La collection",
  histoire: "Notre histoire",
  suivi: "Suivre une commande",
};

export const MOTION_LABEL = {
  full: { label: "Complet", hint: "Toutes les animations du thème." },
  soft: { label: "Discret", hint: "Les entrées seulement, rien qui bouge en boucle." },
  none: { label: "Aucun", hint: "Une vitrine immobile." },
} as const;

/** Le même schéma fermé que Django : une clé inconnue fait échouer la lecture. */
export const designSchema = z
  .object({
    version: z.literal(1),
    theme: z.enum(THEME_IDS),
    motion: z.enum(MOTIONS),
    cover: z.enum(["featured", "name"]),
    sections: z
      .array(z.enum(SECTION_IDS))
      .min(1)
      .max(SECTION_IDS.length)
      .refine((list) => new Set(list).size === list.length && list.includes("collection")),
    texts: z
      .object({
        tagline: z.string().max(80).regex(/^[^<>]*$/),
        story: z.string().max(400).regex(/^[^<>]*$/),
      })
      .strict(),
  })
  .strict();

/** La configuration en base64url, pour l'adresse de l'aperçu (UTF-8 compris). */
export function encodeDesign(design: StorefrontDesign) {
  const bytes = new TextEncoder().encode(JSON.stringify(design));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeDesign(raw: string | undefined | null): StorefrontDesign | null {
  if (!raw || raw.length > 4000) return null;
  try {
    const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const json = new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
    const parsed = designSchema.safeParse(JSON.parse(json));
    return parsed.success ? (parsed.data as StorefrontDesign) : null;
  } catch {
    return null;
  }
}
