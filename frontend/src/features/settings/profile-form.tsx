"use client";

import Link from "next/link";
import { type FormEvent, startTransition, useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/features/auth/form-alert";
import { ACCENTS } from "@/features/storefront/accent";
import { cn } from "@/lib/cn";
import type { Accent, ShopSettings } from "@/lib/types";

import { type ProfileState, saveProfile } from "./actions";

const initial: ProfileState = {};

const ACCENT_LABEL: Record<Accent, string> = {
  orange: "Orange",
  indigo: "Indigo",
  ocre: "Ocre",
  lagune: "Lagune",
  corail: "Corail",
};

/**
 * Ce que les clients lisent en haut de la vitrine. L'envoi passe par onSubmit plutôt que par `action` :
 * React viderait sinon les champs après une erreur.
 */
export function ProfileForm({ settings }: { settings: ShopSettings }) {
  const [state, formAction, pending] = useActionState(saveProfile, initial);
  const fields = state.fields ?? {};

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <section aria-labelledby="titre-vitrine" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titre-vitrine" className="text-sm text-texte-2">
          La vitrine
        </h2>
        <Link href={`/boutique/${settings.slug}`} target="_blank" className="text-[13px] text-indigo-clair hover:underline">
          Voir la vitrine ↗
        </Link>
      </div>
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      {state.done && !pending ? <FormAlert tone="success">{state.done}</FormAlert> : null}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={settings.slug} />
        <Field id="nom-boutique" name="name" label="Nom de la boutique" defaultValue={settings.name} minLength={2} maxLength={60} required error={fields.name} />
        <div className="flex flex-col gap-[7px]">
          <label htmlFor="description-boutique" className="text-[13px] font-semibold text-texte-2">
            Présentation
          </label>
          <textarea
            id="description-boutique"
            name="description"
            rows={3}
            maxLength={280}
            defaultValue={settings.description}
            aria-invalid={fields.description ? true : undefined}
            aria-describedby={fields.description ? "description-boutique-erreur" : "description-boutique-aide"}
            className={cn(
              "w-full resize-y rounded-champ border border-white/15 bg-encre/45 px-[15px] py-3 text-[15px] leading-relaxed text-texte outline-none placeholder:text-texte-3 focus-visible:border-orange focus-visible:shadow-[0_0_0_3px_rgb(255_122_31/0.28)]",
              fields.description && "border-danger",
            )}
          />
          {fields.description ? (
            <p id="description-boutique-erreur" className="text-[13px] text-danger-clair">
              {fields.description}
            </p>
          ) : (
            <p id="description-boutique-aide" className="text-[13px] text-texte-3">
              Deux phrases suffisent : ce que vous vendez, et où vous livrez. 280 caractères au plus.
            </p>
          )}
        </div>
        <Field id="ville-boutique" name="city" label="Ville ou quartier" defaultValue={settings.city} maxLength={60} placeholder="Cocody, Abidjan" error={fields.city} />

        <fieldset className="flex flex-col gap-2" aria-describedby="couleur-aide">
          <legend className="mb-2 text-[13px] font-semibold text-texte-2">Couleur de la vitrine</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ACCENTS) as Accent[]).map((accent) => (
              <label
                key={accent}
                className={cn(
                  "flex items-center gap-2 rounded-full border border-trait-doux bg-encre/40 py-1.5 pr-3.5 pl-1.5 text-[13.5px] has-checked:border-sable/55 has-checked:bg-white/10 has-focus-visible:ring-2 has-focus-visible:ring-orange-clair",
                  settings.custom_accent ? "cursor-pointer" : "cursor-not-allowed opacity-55",
                )}
              >
                <input type="radio" name="accent" value={accent} defaultChecked={settings.accent === accent} disabled={!settings.custom_accent} className="sr-only" />
                <span aria-hidden className="size-6 rounded-full border border-white/20" style={{ background: ACCENTS[accent].hex }} />
                {ACCENT_LABEL[accent]}
              </label>
            ))}
          </div>
          <p id="couleur-aide" className="text-[13px] text-texte-3">
            {settings.custom_accent
              ? "Elle colore la couverture, les chiffres et la pastille de prix. Les boutons restent les mêmes partout, pour rester lisibles."
              : "Le choix de la couleur s’ouvre à partir du plan Pro (onglet Plan)."}
          </p>
          {fields.accent ? <p className="text-[13px] text-danger-clair">{fields.accent}</p> : null}
        </fieldset>

        <Button type="submit" pending={pending} pendingLabel="Enregistrement…" className="self-start">
          Enregistrer la vitrine
        </Button>
      </form>
    </section>
  );
}
