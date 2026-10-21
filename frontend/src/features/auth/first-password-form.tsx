"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { formatWait } from "@/lib/messages";

import { FormAlert } from "./form-alert";
import { chooseFirstPassword, type FirstPasswordState } from "./password-actions";

const initial: FirstPasswordState = {};

export function FirstPasswordForm() {
  const [state, formAction, pending] = useActionState(chooseFirstPassword, initial);
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.error ? (
        <FormAlert tone="danger">
          <p>{state.error.message}</p>
          {state.error.retryAfter ? <p className="mt-1 font-semibold">Réessayez dans {formatWait(state.error.retryAfter)}.</p> : null}
        </FormAlert>
      ) : null}
      <Field
        id="provisoire"
        name="temporary"
        type="password"
        label="Mot de passe provisoire"
        autoComplete="current-password"
        hint="Celui que votre responsable vous a donné : trois blocs de quatre caractères."
        error={state.fields?.temporary}
        className="font-mono"
        required
      />
      <Field
        id="nouveau"
        name="password"
        type="password"
        label="Votre mot de passe"
        autoComplete="new-password"
        hint="Au moins 10 caractères. Personne d’autre que vous ne le connaîtra, pas même votre responsable."
        error={state.fields?.password}
        required
      />
      <Field id="confirmation" name="confirmation" type="password" label="Confirmez votre mot de passe" autoComplete="new-password" error={state.fields?.confirmation} required />
      <Button type="submit" pending={pending} pendingLabel="Enregistrement…" className="w-full py-3.5">
        Choisir ce mot de passe
      </Button>
    </form>
  );
}
