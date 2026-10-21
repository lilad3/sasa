"use client";

import { useState } from "react";

import { SubmitButton } from "@/components/ui/submit-button";

import { revokeApiKey } from "./actions";

/** Révoquer en deux temps : la coupure est immédiate et sans retour pour le logiciel qui utilise la clé. */
export function RevokeKey({ slug, id, name }: { slug: string; id: string; name: string }) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="rounded-full px-3 py-1.5 text-[13px] text-texte-3 hover:text-danger-clair">
        Révoquer
      </button>
    );
  }
  return (
    <form action={revokeApiKey} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="key" value={id} />
      <span className="text-[13px] text-texte-2">Le logiciel qui utilise « {name} » sera coupé tout de suite.</span>
      <SubmitButton pendingLabel="Révocation…" className="px-4 py-2 text-[13px]">
        Révoquer
      </SubmitButton>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-full px-3 py-2 text-[13px] text-texte-3 hover:text-texte">
        Annuler
      </button>
    </form>
  );
}
