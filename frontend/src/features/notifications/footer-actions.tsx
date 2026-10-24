"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";
import { formatWait } from "@/lib/messages";

import { resetEvents, sendTest, type SwitchState, type TestState } from "./actions";

const initialSwitch: SwitchState = {};
const initialTest: TestState = {};

/** Remet tous les réglages à ceux d'origine du rôle (les choix personnels disparaissent). */
export function ResetEvents({ slug, anyCustom }: { slug: string; anyCustom: boolean }) {
  const [state, formAction, pending] = useActionState(resetEvents, initialSwitch);
  if (!anyCustom && !state.done) return null;
  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="slug" value={slug} />
      <button type="submit" disabled={pending} className="text-[13.5px] font-semibold text-indigo-clair underline underline-offset-4 disabled:opacity-60">
        Revenir aux réglages d’origine
      </button>
      <span aria-live="polite" className="text-[12.5px]">
        {state.error ? <span className="text-danger-clair">{state.error.message}</span> : state.done ? <span className="text-indigo-clair">Enregistré</span> : null}
      </span>
    </form>
  );
}

/** Un e-mail de test vers l'adresse du compte : le moyen de vérifier que la configuration du serveur marche. */
export function SendTest({ slug, sending }: { slug: string; sending: boolean }) {
  const [state, formAction, pending] = useActionState(sendTest, initialTest);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <input type="hidden" name="slug" value={slug} />
      <div>
        <Button type="submit" variant="ghost" pending={pending} pendingLabel="Envoi…" disabled={!sending}>
          M’envoyer un e-mail de test
        </Button>
      </div>
      <div aria-live="polite">
        {state.done ? <FormAlert tone="success">E-mail de test envoyé. Vérifiez votre boîte de réception, et les courriers indésirables.</FormAlert> : null}
        {state.error ? (
          <FormAlert tone="danger">
            <p>{state.error.message}</p>
            {state.error.retryAfter ? <p className="mt-1 font-semibold">Réessayez dans {formatWait(state.error.retryAfter)}.</p> : null}
          </FormAlert>
        ) : null}
      </div>
    </form>
  );
}
