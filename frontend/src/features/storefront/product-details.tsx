import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import type { ProductDetails, PublicProduct } from "@/lib/types";

const CONDITION = { new: "neuf", refurbished: "reconditionné", used: "d’occasion" } as const;
const SOLD_BY = { kg: "au kilo", sachet: "au sachet", tas: "au tas", litre: "au litre" } as const;

/** Les détails renseignés, en phrases courtes (le serveur n'envoie que des valeurs, jamais des libellés). */
export function detailLines(details: ProductDetails): string[] {
  const lines: string[] = [];
  if (details.condition) lines.push(`État : ${CONDITION[details.condition]}`);
  if (details.warranty_months) lines.push(`Garantie : ${details.warranty_months} mois`);
  if (details.sold_by && details.sold_by !== "piece") lines.push(`Vendu ${SOLD_BY[details.sold_by]}`);
  if (details.one_of_a_kind) lines.push("Pièce unique");
  if (details.made_to_order) lines.push("Fabriqué sur commande");
  if (details.bulky) lines.push("Gros colis : livraison à convenir");
  return lines;
}

export function ProductDetailList({ details, className }: { details: ProductDetails; className?: string }) {
  const lines = detailLines(details);
  if (lines.length === 0) return null;
  return (
    <ul className={cn("flex flex-col gap-0.5 text-[12.5px]", className)}>
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/**
 * Le prix avant réduction, barré, puis le pourcentage en texte simple : ni pastille, ni rouge, ni étiquette en coin d'image.
 * `<del>` porte un texte accessible ; la couleur est celle du texte voisin (lisible sur chaque thème).
 */
export function WasPrice({ product, className }: { product: Pick<PublicProduct, "compare_at_price" | "discount_percent">; className?: string }) {
  if (!product.compare_at_price) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-1.5 text-[0.85em] font-normal", className)}>
      <del aria-label={`Ancien prix ${formatFcfa(product.compare_at_price)}`} className="opacity-70">
        {formatFcfa(product.compare_at_price)}
      </del>
      {product.discount_percent ? <span className="font-semibold">−{product.discount_percent} %</span> : null}
    </span>
  );
}

/** Le délai de précommande, en texte simple. */
export function preorderText(days: number | null | undefined) {
  return days ? `Précommande · disponible sous ${days} jour${days > 1 ? "s" : ""}` : "Précommande";
}
