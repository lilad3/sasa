"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";
import { FormAlert } from "@/features/auth/form-alert";
import type { DeliverySettings } from "@/lib/types";

import { type DeliveryState, savePickup } from "./delivery-actions";

const initial: DeliveryState = {};

/** Le retrait sur place : pas de frais de livraison, une adresse obligatoire quand il est proposé. */
export function PickupForm({ slug, pickup, hasActiveZone }: { slug: string; pickup: DeliverySettings["pickup"]; hasActiveZone: boolean }) {
  const [state, formAction, pending] = useActionState(savePickup, initial);
  const [enabled, setEnabled] = useState(pickup.enabled);
  const fields = state.fields ?? {};
  // Éteindre le retrait alors qu'aucune zone n'est active ne laisserait aucun moyen de recevoir une commande.
  const lastOption = enabled && !hasActiveZone;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <section aria-labelledby="titre-retrait" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-4">
      <h2 id="titre-retrait" className="text-sm text-texte-2">
        Retrait sur place
      </h2>
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={slug} />
        <div className="flex flex-col gap-1">
          <Switch name="enabled" checked={enabled} locked={lastOption} onChange={(event) => setEnabled(event.target.checked)} label="Proposer le retrait sur place" aria-describedby="retrait-aide" />
          <p id="retrait-aide" className="pl-[54px] text-[12.5px] text-texte-3">
            {lastOption ? "Gardez au moins une zone active ou le retrait sur place. " : ""}Pas de frais de livraison pour un retrait.
          </p>
        </div>
        <div hidden={!enabled} className="flex flex-col gap-4">
          <Field id="retrait-adresse" name="address" label="Adresse de retrait" defaultValue={pickup.address} maxLength={200} autoComplete="off" required={enabled} error={fields.address} />
          <Field
            id="retrait-horaires"
            name="hours"
            label="Horaires (facultatif)"
            defaultValue={pickup.hours}
            maxLength={160}
            autoComplete="off"
            placeholder="Lun-Sam, 9 h-18 h"
            error={fields.hours}
          />
          <Field
            id="retrait-prepa"
            name="prep_hours"
            label="Délai de préparation (h)"
            defaultValue={String(pickup.prep_hours)}
            inputMode="numeric"
            maxLength={3}
            autoComplete="off"
            hint="1 à 168 h, avant que la commande soit prête"
            error={fields.prep_hours}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" pending={pending} pendingLabel="Enregistrement…">
            Enregistrer le retrait
          </Button>
          <p role="status" className="text-[13.5px] text-texte-2">
            {state.done && !pending ? state.done : ""}
          </p>
        </div>
      </form>
    </section>
  );
}
