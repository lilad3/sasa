"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/features/auth/form-alert";

import { nameVip, setLoyaltyThreshold, type ThresholdState, type VipState } from "./actions";

const vipInitial: VipState = {};
const thresholdInitial: ThresholdState = {};

/**
 * « Nommer un fidèle » : un bouton dans l'en-tête, le formulaire s'ouvre dessous.
 * Pour un habitué qui achète en boutique : il devient fidèle tout de suite, même sans commande en ligne.
 */
export function NameVipForm({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState(nameVip, vipInitial);
  return (
    <details className="group relative" open={state.error || state.fields ? true : undefined}>
      <summary className="bouton-contour flex cursor-pointer list-none items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 24 24" className="size-4 text-ocre" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 4l2.3 4.8 5.2.7-3.8 3.6.9 5.2L12 15.8l-4.6 2.5.9-5.2-3.8-3.6 5.2-.7z" />
        </svg>
        Nommer un fidèle
      </summary>
      <form
        action={formAction}
        noValidate
        className="absolute top-[calc(100%+8px)] left-0 z-20 flex w-[min(380px,calc(100vw-24px))] flex-col gap-3.5 rounded-[20px] border border-trait bg-nuit-2/95 p-[18px] shadow-[0_18px_40px_rgb(0_0_0/0.5)] backdrop-blur-xl sm:right-0 sm:left-auto"
      >
        <input type="hidden" name="slug" value={slug} />
        <p className="text-sm text-texte-2">Un habitué qui n’a pas encore commandé en ligne ? Il devient fidèle tout de suite.</p>
        {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
        <Field id="fidele-telephone" name="phone" label="Son numéro" type="tel" inputMode="tel" autoComplete="off" placeholder="07 07 12 34 56" required error={state.fields?.phone} />
        <Field id="fidele-nom" name="name" label="Son nom" autoComplete="off" placeholder="Aya Kouassi" maxLength={120} error={state.fields?.name} />
        <Button type="submit" pending={pending} pendingLabel="Enregistrement…" className="self-start px-5 py-2.5 text-sm">
          Nommer fidèle
        </Button>
      </form>
    </details>
  );
}

/** Le seuil de fidélité, réglable sur place : « fidèle à partir de 3 commandes livrées ». */
export function ThresholdForm({ slug, threshold }: { slug: string; threshold: number }) {
  const [state, formAction, pending] = useActionState(setLoyaltyThreshold, thresholdInitial);
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2 text-[12.5px] text-texte-3">
      <input type="hidden" name="slug" value={slug} />
      <label htmlFor="seuil-fidelite">Fidèle à partir de</label>
      <input
        id="seuil-fidelite"
        name="threshold"
        type="number"
        min={1}
        max={50}
        defaultValue={threshold}
        className="w-14 rounded-[10px] border border-white/15 bg-encre/45 px-2 py-1 text-center text-[13px] text-texte tabular-nums outline-none focus-visible:border-orange"
      />
      <span>commandes livrées</span>
      <button type="submit" disabled={pending} className="rounded-full px-2.5 py-1 font-semibold text-sable underline decoration-sable/40 underline-offset-[3px] hover:decoration-sable disabled:opacity-60">
        {pending ? "…" : "Enregistrer"}
      </button>
      {state.error ? <span className="basis-full text-danger-clair">{state.error.message}</span> : null}
      {state.done ? <span className="basis-full text-orange-clair">Seuil enregistré.</span> : null}
    </form>
  );
}
