"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";

import { type DeleteState, deleteProduct } from "./actions";

const initial: DeleteState = {};

/** Suppression en deux temps : on dit ce qui disparaît, et on propose de masquer le produit à la place. */
export function DeleteProduct({ slug, productId, name }: { slug: string; productId: string; name: string }) {
  const [state, formAction, pending] = useActionState(deleteProduct, initial);
  const [asking, setAsking] = useState(false);

  return (
    <section aria-label="Supprimer le produit" className="col-span-full flex flex-col gap-3 lg:col-span-3 lg:col-start-8">
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      {asking ? (
        <form action={formAction} role="group" aria-labelledby="suppression-question" className="flex flex-col gap-3 rounded-[16px] border border-danger/35 bg-danger/10 p-3.5">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="product" value={productId} />
          <p id="suppression-question" className="text-sm">
            Supprimer « {name} » ? Il disparaît du catalogue et de la vitrine. Pour l’arrêter un temps, décochez plutôt « En vente ».
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="ghost" pending={pending} pendingLabel="Suppression…" className="border-danger/50 px-5 py-2.5 text-sm text-danger-clair hover:bg-danger/15">
              Oui, supprimer
            </Button>
            <button type="button" onClick={() => setAsking(false)} className="rounded-full px-4 py-2.5 text-sm text-texte-2 hover:text-texte">
              Garder le produit
            </button>
          </div>
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setAsking(true)}
          className="self-center text-sm text-texte-3 underline decoration-texte-3/40 underline-offset-[3px] hover:text-danger-clair hover:decoration-danger-clair"
        >
          Supprimer ce produit
        </button>
      )}
    </section>
  );
}
