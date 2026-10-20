"use client";

import Link from "next/link";
import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { formatWait } from "@/lib/messages";

import { FormAlert } from "./form-alert";
import { type PasswordFormState, requestReset } from "./password-actions";
import { useCountdown } from "./use-countdown";

const initial: PasswordFormState = {};

export function ForgotForm() {
  const [state, formAction, pending] = useActionState(requestReset, initial);
  const wait = useCountdown(state.error?.retryAfter, state);

  if (state.done) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="success">
          Si un compte existe pour cette adresse, un e-mail vient de partir. Le lien est valable 30 minutes et ne sert
          qu’une fois.
        </FormAlert>
        <Link href="/connexion" className="text-sm font-semibold text-sable underline decoration-sable/40 underline-offset-[3px]">
          Retour à la connexion
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {state.error ? (
        <FormAlert tone="danger">
          <p>{state.error.message}</p>
          {wait > 0 ? <p className="mt-1 font-semibold">Réessayez dans {formatWait(wait)}.</p> : null}
        </FormAlert>
      ) : null}
      <Field id="email" name="email" type="email" label="Adresse e-mail" placeholder="vous@boutique.ci" autoComplete="email" inputMode="email" error={state.fields?.email} required />
      <Button type="submit" pending={pending} pendingLabel="Envoi…" disabled={wait > 0} className="w-full py-3.5">
        Recevoir le lien
      </Button>
      <Link href="/connexion" className="text-sm text-texte-3 hover:text-texte">
        Retour à la connexion
      </Link>
    </form>
  );
}
