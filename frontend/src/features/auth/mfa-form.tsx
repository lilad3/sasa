"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { formatWait } from "@/lib/messages";

import { type AuthFormState, cancelMfa, verifyMfa } from "./actions";
import { FormAlert } from "./form-alert";
import { useCountdown } from "./use-countdown";

const initial: AuthFormState = {};

export function MfaForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(verifyMfa, initial);
  const [recovery, setRecovery] = useState(false);
  const wait = useCountdown(state.error?.retryAfter, state);
  const blocked = wait > 0;

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="suite" value={next} />
        {state.error ? (
          <FormAlert tone="danger">
            <p>{state.error.message}</p>
            {blocked ? <p className="mt-1 font-semibold">Réessayez dans {formatWait(wait)}.</p> : null}
            {state.error.attemptsRemaining !== undefined && !blocked ? (
              <p className="mt-1">
                {state.error.attemptsRemaining === 1
                  ? "Dernier essai : ensuite, il faudra recommencer depuis le mot de passe."
                  : `Encore ${state.error.attemptsRemaining} essais.`}
              </p>
            ) : null}
          </FormAlert>
        ) : null}

        {recovery ? (
          <Field
            key="secours"
            id="code"
            name="code"
            label="Code de secours"
            placeholder="xxxx-xxxx"
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            hint="Un des 10 codes reçus en activant la double authentification. Chaque code ne sert qu'une fois."
            error={state.fields?.code}
            className="font-mono tracking-[0.2em]"
            required
          />
        ) : (
          <Field
            key="totp"
            id="code"
            name="code"
            label="Code à 6 chiffres"
            inputMode="numeric"
            pattern="[0-9 ]*"
            maxLength={7}
            autoComplete="one-time-code"
            autoFocus
            error={state.fields?.code}
            className="text-center font-mono text-2xl tracking-[0.5em]"
            required
          />
        )}

        <Button type="submit" pending={pending} pendingLabel="Vérification…" disabled={blocked} className="w-full py-3.5">
          {blocked ? `Réessayez dans ${formatWait(wait)}` : "Vérifier"}
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
        <button
          type="button"
          onClick={() => setRecovery((value) => !value)}
          className="font-semibold text-pistache underline decoration-pistache/40 underline-offset-[3px] hover:decoration-pistache"
        >
          {recovery ? "Utiliser l'application" : "Utiliser un code de secours"}
        </button>
        <form action={cancelMfa}>
          <button type="submit" className="text-texte-3 hover:text-texte">
            Changer de compte
          </button>
        </form>
      </div>
    </div>
  );
}
