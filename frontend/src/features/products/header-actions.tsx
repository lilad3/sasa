"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";

import { type ActionState, duplicateProduct, setProductStatus } from "./product-actions";
import type { ProductStatus } from "./types";

const initial: ActionState = {};

/**
 * « Dupliquer » (une copie en brouillon, stock à 0) et « Archiver » (ranger sans rien perdre : commandes, historique du stock,
 * photos). Archiver passe avant « Supprimer », qui reste plus bas et refuse un produit qui a un historique.
 */
export function HeaderActions({ slug, productId, status }: { slug: string; productId: string; status: ProductStatus }) {
  const [copy, copyAction, copying] = useActionState(duplicateProduct, initial);
  const [move, moveAction, moving] = useActionState(setProductStatus, initial);
  const error = copy.error ?? move.error;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <form action={copyAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="product" value={productId} />
          <Button type="submit" variant="ghost" pending={copying} pendingLabel="Copie…" className="px-5 py-2.5 text-sm">
            Dupliquer
          </Button>
        </form>
        <form action={moveAction}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="product" value={productId} />
          {/* Un archivé redevient d'abord brouillon : on ne remet pas en vente d'un seul geste ce qu'on avait rangé. */}
          <input type="hidden" name="status" value={status === "archived" ? "draft" : "archived"} />
          <Button type="submit" variant="ghost" pending={moving} pendingLabel="…" className="px-5 py-2.5 text-sm">
            {status === "archived" ? "Désarchiver" : "Archiver"}
          </Button>
        </form>
      </div>
      {error ? <FormAlert tone="danger">{error.message}</FormAlert> : null}
    </div>
  );
}
