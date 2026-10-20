import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Compose des classes Tailwind ; en cas de conflit, la dernière gagne (utile pour surcharger une variante). */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
