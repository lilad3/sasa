"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";

import { type PhotoState, setFeatured } from "./photo-actions";

const initial: PhotoState = {};

type FeaturedCardProps = { slug: string; productId: string; isFeatured: boolean; isActive: boolean; inStock: boolean };

/**
 * « À la une » : le produit de la couverture de la vitrine (storefront.edit). Sans choix,
 * Django prend le plus vendu sur 30 jours, sinon le plus cher en stock (docs/chantier-p5.md §2.4).
 */
export function FeaturedCard({ slug, productId, isFeatured, isActive, inStock }: FeaturedCardProps) {
  const [state, formAction, pending] = useActionState(setFeatured, initial);

  return (
    <section aria-labelledby="titre-une" className="vitre col-span-full flex flex-col gap-3 self-start rounded-[24px] p-[18px] lg:col-span-3">
      <h2 id="titre-une" className="text-sm text-texte-2">
        À la une
      </h2>
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      {/* Le texte d'état suit la une : il sert aussi de confirmation, annoncée aux lecteurs d'écran. */}
      <p aria-live="polite" className="text-[13.5px] text-texte-2">
        {isFeatured
          ? inStock
            ? "Ce produit fait la couverture de votre vitrine."
            : "En rupture : la vitrine montre un autre produit en attendant le retour du stock."
          : "Sans choix de votre part, la couverture montre le produit le plus vendu sur 30 jours, sinon le plus cher en stock."}
      </p>
      {isActive || isFeatured ? (
        <form action={formAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="product" value={productId} />
          <input type="hidden" name="featured" value={isFeatured ? "off" : "on"} />
          <Button type="submit" variant={isFeatured ? "ghost" : "nuit"} pending={pending} pendingLabel="…" className="px-5 py-2.5 text-sm">
            {isFeatured ? "Retirer de la une" : "Mettre à la une"}
          </Button>
        </form>
      ) : (
        <p className="text-[13px] text-texte-3">Remettez le produit en vente pour le mettre à la une.</p>
      )}
    </section>
  );
}
