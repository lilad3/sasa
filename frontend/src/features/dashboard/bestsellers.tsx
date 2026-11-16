import { cn } from "@/lib/cn";

/**
 * Vignette d'un produit sans photo : un motif de pagne tiré du nom, toujours le même pour un produit.
 * Les couleurs viennent d'une liste fermée : aucun texte saisi n'atterrit dans le CSS.
 */
const PATTERNS: ((a: string, b: string) => string)[] = [
  (a, b) => `repeating-linear-gradient(90deg, ${a} 0 6px, ${b} 6px 10px, #17110a 10px 13px)`,
  (a, b) => `radial-gradient(circle at 50% 50%, ${a} 0 3px, transparent 3.5px) 0 0 / 11px 11px, ${b}`,
  (a, b) => `repeating-linear-gradient(45deg, ${a} 0 4px, ${b} 4px 8px)`,
  (a, b) => `conic-gradient(${a} 25%, ${b} 0 50%, ${a} 0 75%, ${b} 0) 0 0 / 14px 14px`,
  (a, b) => `repeating-linear-gradient(0deg, ${a} 0 5px, ${b} 5px 9px, #faf4ea 9px 11px)`,
];
const PAIRS = [
  ["#ff7a1f", "#4a57d6"],
  ["#f2b33d", "#2e8c7a"],
  ["#e8553f", "#f0ddba"],
  ["#4a57d6", "#f2b33d"],
  ["#2e8c7a", "#ff9b52"],
];

function hash(text: string) {
  let h = 0;
  for (const char of text) h = (h * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(h);
}

export function ProductSwatch({ name, imageUrl, className }: { name: string; imageUrl?: string | null; className?: string }) {
  if (imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element -- images des marchands, hôtes non connus d'avance
    return <img src={imageUrl} alt="" className={cn("object-cover", className)} />;
  }
  const h = hash(name);
  const [a, b] = PAIRS[h % PAIRS.length];
  return <span aria-hidden className={cn("block", className)} style={{ background: PATTERNS[(h >> 3) % PATTERNS.length](a, b) }} />;
}
