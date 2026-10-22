import { CHANNELS, type Channel } from "@/lib/types";

/**
 * Le canal d'arrivée (?via=whatsapp…), gardé le temps de la visite (docs/chantier-p5.md §1.7).
 * Liste fermée : une valeur inconnue devient « autre », jamais le texte de l'adresse.
 * Le stockage peut être bloqué (navigation privée) : on retombe alors sur l'adresse, puis sur « direct ».
 */
const key = (slug: string) => `akwaba:via:${slug}`;

function fromAddress(): Channel | null {
  const wanted = new URLSearchParams(window.location.search).get("via")?.trim().toLowerCase();
  if (!wanted) return null;
  return (CHANNELS as readonly string[]).includes(wanted) ? (wanted as Channel) : "autre";
}

/** À l'arrivée sur la vitrine : retient le canal de l'adresse, s'il y en a un. */
export function rememberChannel(slug: string) {
  const channel = fromAddress();
  if (!channel) return;
  try {
    window.sessionStorage.setItem(key(slug), channel);
  } catch {
    // Stockage bloqué : la commande relira l'adresse.
  }
}

/** Au moment de commander. */
export function readChannel(slug: string): Channel {
  try {
    const stored = window.sessionStorage.getItem(key(slug));
    if (stored && (CHANNELS as readonly string[]).includes(stored)) return stored as Channel;
  } catch {
    // Stockage bloqué : on lit l'adresse.
  }
  return fromAddress() ?? "direct";
}
