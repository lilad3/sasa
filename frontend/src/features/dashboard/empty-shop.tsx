"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";

import { type DemoState, generateDemoData } from "./actions";

const initial: DemoState = {};

/** Boutique sans aucune commande : on explique quoi faire, et le propriétaire peut la remplir de données de démo. */
export function EmptyShop({ slug, canFillDemo }: { slug: string; canFillDemo: boolean }) {
  const [state, formAction, pending] = useActionState(generateDemoData, initial);

  return (
    <section aria-labelledby="titre-boutique-vide" className="vitre col-span-full grid gap-6 rounded-[24px] p-6 md:grid-cols-2 md:p-8">
      <div className="flex flex-col gap-3">
        <h2 id="titre-boutique-vide" className="large text-[clamp(22px,2.4vw,28px)] font-bold">
          Votre boutique attend sa première commande.
        </h2>
        <p className="max-w-[48ch] text-texte-2">
          Envoyez le lien de votre vitrine à vos clients, sur WhatsApp ou Facebook. Chaque commande arrivera ici, avec le numéro et le repère de livraison.
        </p>
        <Link href={`/boutique/${slug}`} className="self-start font-mono text-sm text-sable underline decoration-sable/40 underline-offset-[3px] hover:decoration-sable">
          /boutique/{slug}
        </Link>
      </div>

      <div className="carte flex flex-col gap-3 rounded-carte p-5">
        <h3 className="font-semibold">Voir le tableau de bord en action</h3>
        {canFillDemo ? (
          <>
            <p className="text-sm text-texte-2">
              Remplissez la boutique avec 180 jours de ventes fictives : des produits d’ici, des clients d’Abidjan et de l’intérieur, en FCFA. Elles restent marquées « démo » et
              ne se mélangent jamais à de vraies commandes.
            </p>
            {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
            <form action={formAction}>
              <input type="hidden" name="slug" value={slug} />
              <Button type="submit" pending={pending} pendingLabel="Génération…" className="mt-1">
                Remplir avec des données de démo
              </Button>
            </form>
          </>
        ) : (
          <p className="text-sm text-texte-2">Le propriétaire de la boutique peut la remplir avec des données de démo pour découvrir le tableau de bord.</p>
        )}
      </div>
    </section>
  );
}
