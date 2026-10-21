"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/features/auth/form-alert";
import { formatWait } from "@/lib/messages";

import { changePassword, type PasswordChangeState } from "./actions";

const initial: PasswordChangeState = {};

export function PasswordForm({ demo }: { demo: boolean }) {
  const [state, formAction, pending] = useActionState(changePassword, initial);

  return (
    <section aria-labelledby="titre-mot-de-passe" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-4">
      <h2 id="titre-mot-de-passe" className="text-sm text-texte-2">
        Mot de passe
      </h2>
      {state.done ? <FormAlert tone="success">Mot de passe changé. Vos autres appareils ont été déconnectés.</FormAlert> : null}
      {state.error ? (
        <FormAlert tone="danger">
          <p>{state.error.message}</p>
          {state.error.retryAfter ? <p className="mt-1 font-semibold">Réessayez dans {formatWait(state.error.retryAfter)}.</p> : null}
        </FormAlert>
      ) : null}
      <form action={formAction} noValidate className="flex flex-col gap-3.5">
        <Field
          id="mot-de-passe-actuel"
          name="current_password"
          type="password"
          label="Mot de passe actuel"
          autoComplete="current-password"
          error={state.fields?.current_password}
          disabled={demo}
          required
        />
        <Field
          id="nouveau-mot-de-passe"
          name="password"
          type="password"
          label="Nouveau mot de passe"
          autoComplete="new-password"
          hint="Au moins 10 caractères. Une phrase de quelques mots est plus facile à retenir."
          error={state.fields?.password}
          disabled={demo}
          required
        />
        <Field
          id="confirmation-mot-de-passe"
          name="confirmation"
          type="password"
          label="Confirmez le nouveau mot de passe"
          autoComplete="new-password"
          error={state.fields?.confirmation}
          disabled={demo}
          required
        />
        <Button type="submit" pending={pending} pendingLabel="Changement…" disabled={demo} className="mt-1 self-start">
          Changer le mot de passe
        </Button>
      </form>
    </section>
  );
}
