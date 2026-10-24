"use client";

import Link from "next/link";
import { type FormEvent, startTransition, useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/features/auth/form-alert";
import type { DeliverySettings } from "@/lib/types";

import { addZone, type DeliveryState } from "./delivery-actions";

const initial: DeliveryState = {};

/** Ajouter une zone : ville, commune (facultative), frais, délai. Le plafond vient du plan, le serveur le fait respecter. */
export function AddZoneForm({ slug, limits }: { slug: string; limits: DeliverySettings["limits"] }) {
  const [state, formAction, pending] = useActionState(addZone, initial);
  const form = useRef<HTMLFormElement>(null);
  const fields = state.fields ?? {};
  const full = limits.count >= limits.zones;

  useEffect(() => {
    if (state.done) form.current?.reset();
  }, [state.done]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <details className="group rounded-[18px] border border-trait bg-white/[0.03] p-3.5">
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline justify-between gap-2 text-[14.5px] font-semibold">
        <span>Ajouter une zone</span>
        <span className="text-[12.5px] font-normal text-texte-3">
          {limits.count} sur {limits.zones}
        </span>
      </summary>

      {full ? (
        <div className="mt-3 flex flex-col gap-2">
          <FormAlert tone="info">Votre plan permet {limits.zones} zones de livraison, et vous les avez toutes.</FormAlert>
          <Link href={`/app/${slug}/parametres?onglet=plan`} className="self-start text-[13.5px] font-semibold text-indigo-clair underline-offset-2 hover:underline">
            Voir les plans
          </Link>
        </div>
      ) : (
        <form ref={form} onSubmit={submit} noValidate className="mt-3 flex flex-col gap-3">
          <input type="hidden" name="slug" value={slug} />
          {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
          {state.error?.code === "plan_limit_reached" ? (
            <Link href={`/app/${slug}/parametres?onglet=plan`} className="self-start text-[13.5px] font-semibold text-indigo-clair underline-offset-2 hover:underline">
              Voir les plans
            </Link>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="zone-ville" name="city" label="Ville" maxLength={60} required autoComplete="off" error={fields.city} />
            <Field id="zone-commune" name="commune" label="Commune (facultatif)" maxLength={60} autoComplete="off" error={fields.commune} />
            <Field
              id="zone-frais"
              name="fee"
              label="Frais (F)"
              inputMode="numeric"
              autoComplete="off"
              maxLength={7}
              required
              hint="0 à 100 000 F"
              error={fields.fee}
            />
            <Field
              id="zone-delai"
              name="delay_hours"
              label="Délai (h)"
              inputMode="numeric"
              autoComplete="off"
              maxLength={3}
              required
              hint="1 à 240 h, de la commande à la remise"
              error={fields.delay_hours}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" pending={pending} pendingLabel="Ajout…">
              Ajouter la zone
            </Button>
            <p role="status" className="text-[13.5px] text-texte-2">
              {state.done && !pending ? state.done : ""}
            </p>
          </div>
        </form>
      )}
    </details>
  );
}
