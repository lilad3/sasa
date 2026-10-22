"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { OneTimeSecret } from "@/components/ui/one-time-secret";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { FormAlert } from "@/features/auth/form-alert";

import { type ApiKeyState, createApiKey } from "./actions";

const initial: ApiKeyState = {};

export const SCOPE_LABEL = {
  "catalog:read": "Lire le catalogue",
  "orders:read": "Lire les commandes et les clients",
} as const;

const DURATIONS = [
  { value: "30", label: "30 jours" },
  { value: "90", label: "90 jours" },
  { value: "365", label: "1 an" },
  { value: "never", label: "Sans expiration" },
];

/**
 * Créer une clé pour un logiciel (comptabilité, tableur, site). La clé ne lit que ce qu'on lui permet,
 * n'écrit jamais rien, et n'est montrée qu'une fois : Django n'en garde que l'empreinte.
 */
export function ApiKeyForm({ slug, mfaEnabled, blocked }: { slug: string; mfaEnabled: boolean; blocked: string | null }) {
  const [state, formAction, pending] = useActionState(createApiKey, initial);
  const form = useRef<HTMLFormElement>(null);
  const fields = state.fields ?? {};

  useEffect(() => {
    if (state.created) form.current?.reset();
  }, [state.created]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <section aria-labelledby="titre-nouvelle-cle" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-4">
      <h2 id="titre-nouvelle-cle" className="text-sm text-texte-2">
        Nouvelle clé
      </h2>

      {state.created ? (
        <OneTimeSecret label={`Clé « ${state.created.name} »`} value={state.created.key}>
          <p className="text-[13px] text-texte-2">
            Collez-la dans votre logiciel. Si vous la perdez, révoquez-la et créez-en une autre. Ne la mettez jamais dans le code d’un site public.
          </p>
        </OneTimeSecret>
      ) : null}

      {blocked ? (
        <p className="rounded-[18px] border border-ocre/35 bg-ocre/10 px-4 py-3 text-sm">{blocked}</p>
      ) : (
        <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="slug" value={slug} />
          {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
          <Field id="nom-cle" name="name" label="Nom de la clé" placeholder="Comptabilité" maxLength={60} required hint="Pour la reconnaître dans la liste." error={fields.name} />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-2 text-[13px] font-semibold text-texte-2">Ce qu’elle peut lire</legend>
            {(Object.keys(SCOPE_LABEL) as (keyof typeof SCOPE_LABEL)[]).map((scope) => (
              <label key={scope} className="flex cursor-pointer items-center gap-2.5 text-[14px]">
                <input type="checkbox" name="scopes" value={scope} defaultChecked={scope === "catalog:read"} className="size-4 accent-orange" />
                {SCOPE_LABEL[scope]}
                <code className="font-mono text-[12px] text-texte-3">{scope}</code>
              </label>
            ))}
            {fields.scopes ? <p className="text-[13px] text-danger-clair">{fields.scopes}</p> : null}
            <p className="text-[12.5px] text-texte-3">Les commandes contiennent les noms et téléphones des clients : ne cochez que si le logiciel en a besoin.</p>
          </fieldset>
          <div className="flex flex-col gap-[7px]">
            <label htmlFor="duree-cle" className="text-[13px] font-semibold text-texte-2">
              Durée de validité
            </label>
            <select id="duree-cle" name="expires_in_days" defaultValue="90" className="rounded-champ border border-white/15 bg-nuit-2 px-3.5 py-2.5 text-[14.5px] text-texte">
              {DURATIONS.map((duration) => (
                <option key={duration.value} value={duration.value}>
                  {duration.label}
                </option>
              ))}
            </select>
            {fields.expires_in_days ? <p className="text-[13px] text-danger-clair">{fields.expires_in_days}</p> : null}
          </div>
          {state.reauth ? <ReauthFields mfaEnabled={mfaEnabled} what="créer une clé API" error={state.reauthError} /> : null}
          <Button type="submit" pending={pending} pendingLabel="Création…" className="self-start">
            {state.reauth ? "Confirmer et créer la clé" : "Créer la clé"}
          </Button>
        </form>
      )}
    </section>
  );
}
