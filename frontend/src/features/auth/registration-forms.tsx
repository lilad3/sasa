"use client";

import Link from "next/link";
import { type FormEvent, startTransition, useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { formatWait } from "@/lib/messages";

import { FormAlert } from "./form-alert";
import { PasswordMeter } from "./password-meter";
import {
  type RegistrationState,
  completeSignup,
  requestSignup,
  unlockAccount,
} from "./registration-actions";

const initial: RegistrationState = {};

/**
 * Inscription. Avec `emailVerification`, un lien part par e-mail et le mot de passe se choisit ensuite ;
 * sans, le mot de passe est demandé ici et la boutique est créée tout de suite.
 * Envoi par onSubmit : React viderait sinon les champs après une erreur.
 */
export function SignupRequestForm({ emailVerification }: { emailVerification: boolean }) {
  const [state, formAction, pending] = useActionState(requestSignup, initial);
  const [password, setPassword] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  if (state.done) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="success">Si cette adresse peut être utilisée, un e-mail vient de partir. Ouvrez-le pour choisir votre mot de passe et créer votre boutique.</FormAlert>
        <Link href="/connexion" className="text-sm font-semibold text-sable underline decoration-sable/40 underline-offset-[3px]">Retour à la connexion</Link>
      </div>
    );
  }
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {state.error ? (
        <FormAlert tone="danger">
          <p>{state.error.message}</p>
          {state.error.retryAfter ? <p className="mt-1 font-semibold">Réessayez dans {formatWait(state.error.retryAfter)}.</p> : null}
        </FormAlert>
      ) : null}
      <Field id="email" name="email" type="email" label="Adresse e-mail" autoComplete="email" inputMode="email" error={state.fields?.email} required />
      <Field id="first_name" name="first_name" label="Prénom" autoComplete="given-name" error={state.fields?.first_name} required />
      <Field id="last_name" name="last_name" label="Nom" autoComplete="family-name" error={state.fields?.last_name} required />
      <Field id="shop_name" name="shop_name" label="Nom de la boutique" autoComplete="organization" error={state.fields?.shop_name} required />
      {emailVerification ? null : (
        <div className="flex flex-col gap-2">
          <Field
            id="password"
            name="password"
            type="password"
            label="Mot de passe"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            hint="Au moins 10 caractères. Une phrase de quelques mots est plus facile à retenir."
            error={state.fields?.password}
            required
          />
          <PasswordMeter password={password} />
        </div>
      )}
      <Button type="submit" pending={pending} pendingLabel={emailVerification ? "Envoi…" : "Création…"} className="w-full py-3.5">
        {emailVerification ? "Recevoir le lien d’inscription" : "Créer ma boutique"}
      </Button>
      <Link href="/connexion" className="text-sm text-texte-3 hover:text-texte">Déjà inscrit ? Se connecter</Link>
    </form>
  );
}

export function SignupCompletionForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(completeSignup, initial);
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  if (!token || state.error?.code === "token_invalid_or_expired") {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="danger">{state.error?.message ?? "Ce lien d'inscription est incomplet."}</FormAlert>
        <Link href="/inscription" className="text-sm font-semibold text-sable underline decoration-sable/40 underline-offset-[3px]">Demander un nouveau lien</Link>
      </div>
    );
  }
  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      <Field id="password" name="password" type="password" label="Mot de passe" autoComplete="new-password" error={state.fields?.password} required />
      <Button type="submit" pending={pending} pendingLabel="Création…" className="w-full py-3.5">Créer mon compte et ma boutique</Button>
    </form>
  );
}

export function UnlockForm({ token }: { token: string }) {
  const [state, formAction, pending] = useActionState(unlockAccount, initial);
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);
  if (!token) {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="danger">Le lien de déverrouillage est incomplet.</FormAlert>
        <Link href="/connexion" className="text-sm font-semibold text-sable underline decoration-sable/40 underline-offset-[3px]">Retour à la connexion</Link>
      </div>
    );
  }
  return (
    <form action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="token" value={token} />
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      <Button type="submit" pending={pending} pendingLabel="Déverrouillage…" className="w-full py-3.5">Déverrouiller mon compte</Button>
      <Link href="/connexion" className="text-sm text-texte-3 hover:text-texte">Retour à la connexion</Link>
    </form>
  );
}
