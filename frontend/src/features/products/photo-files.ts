// Les règles d'une photo de produit, partagées par la fiche (photos.tsx) et la création (product-form.tsx).
// Django reste juge (shops/photos.py) : ces contrôles évitent seulement un envoi inutile.

export const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
export const MAX_PHOTOS = 3;
const MAX_SOURCE_BYTES = 15 * 1024 * 1024;
// Une Server Action accepte 1 Mo : on vise moins, en baissant la qualité puis la taille s'il le faut.
const TARGET_BYTES = 900 * 1024;
const STEPS: [side: number, quality: number][] = [
  [1200, 0.85],
  [1200, 0.7],
  [960, 0.7],
  [800, 0.6],
];

/** Les refus de Django qu'on sait expliquer, par code (les autres passent par describeProblem). */
export const PHOTO_PROBLEMS: Record<string, string> = {
  file_too_large: "Photo trop lourde : choisissez une image plus petite.",
  unsupported_file: "Photo refusée : PNG, JPEG ou WebP seulement (pas de SVG ni de GIF).",
  photo_limit: "3 photos au plus par produit : retirez-en une d’abord.",
  product_inactive: "Remettez d’abord le produit en vente, puis mettez-le à la une.",
};

/** Ce qui ne va pas avec le fichier choisi, avant toute réduction ; null s'il peut partir. */
export function photoProblem(file: File) {
  if (!ACCEPTED.includes(file.type)) return "PNG, JPEG ou WebP seulement (pas de SVG ni de GIF).";
  if (file.size > MAX_SOURCE_BYTES) return "Image trop lourde : 15 Mo au maximum avant réduction.";
  return null;
}

export const UNREADABLE = "Cette image ne s’ouvre pas. Essayez une autre photo.";

function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Réduit la photo dans le navigateur (1 200 px au plus) avant l'envoi : léger sur un réseau mobile,
 * et sous la limite des Server Actions. WebP garde la transparence ; un navigateur qui ne sait pas
 * l'écrire envoie du JPEG sur fond blanc. Django redessine de toute façon l'image.
 */
export async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const [side, quality] of STEPS) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let blob = await encode(canvas, "image/webp", quality);
      if (!blob || blob.type !== "image/webp") {
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        blob = await encode(canvas, "image/jpeg", quality);
      }
      if (blob && blob.size <= TARGET_BYTES) return blob;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("image");
}
