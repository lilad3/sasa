import { formatNumber } from "@/lib/format";
import type { DeliveryZone, PaymentMethod } from "@/lib/types";

const PAYMENT_WORDS: Partial<Record<PaymentMethod, string>> = { cash_on_delivery: "paiement à la livraison" };

function listOf(words: string[], last = "et") {
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} ${last} ${words.at(-1)}`;
}

/**
 * E8 : la ligne sous le nom de la boutique, construite à partir de ses vraies données.
 * Ce qui manque est retiré, rien n'est inventé : sans zone de livraison, il ne reste que le paiement.
 * L'heure limite (« si vous commandez avant 17 h ») n'existe pas encore en base : voir le contrat, décision 2.
 */
export function infoLine(zones: DeliveryZone[], methods: { id: PaymentMethod; label: string }[]) {
  const parts: string[] = [];
  if (zones.length) {
    const fastest = Math.min(...zones.map((zone) => zone.delay_hours));
    const near = zones.filter((zone) => zone.delay_hours === fastest).map((zone) => zone.label);
    const delay = fastest <= 48 ? `en ${fastest} h` : `en ${Math.round(fastest / 24)} jours`;
    const where = near.length <= 2 ? listOf(near) : `${near[0]}, ${near[1]} et ${near.length - 2} autres communes`;
    parts.push(`Livré ${delay} à ${where}`);
    parts.push(`livraison dès ${formatNumber(Math.min(...zones.map((zone) => zone.fee)))} F`);
  }
  if (methods.length) parts.push(listOf(methods.map((method) => PAYMENT_WORDS[method.id] ?? method.label), "ou"));
  return parts;
}
