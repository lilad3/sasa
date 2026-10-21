"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

import { FormAlert } from "./form-alert";
import { type PasswordFormState, resetPassword } from "./password-actions";
import { PasswordMeter } from "./password-meter";

const initial: PasswordFormState = {};

export function ResetForm({ uid, token }: { uid: string; token: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, initial);
  const [password, setPassword] = useState("");

  useEffect(() => {
    // Le jeton ne reste pas dans la barre d'adresse (historique, partage d'écran, capture).
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (!uid || !token || state.error?.code === "token_invalid_or_expired") {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="danger">Ce lien n’est plus valable : il a déjà servi ou a dépassé ses 30 minutes.</FormAlert>
        <Link href="/mot-de-passe-oublie" className="text-sm font-semibold text-sable underline decoration-sable/40 underline-offset-[3px]">
          Demander un nouveau lien
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="uid" value={uid} />
      <input type="hidden" name="token" value={token} />
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      <div className="flex flex-col gap-2">
        <Field
          id="password"
          name="password"
          type="password"
          label="Nouveau mot de passe"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={state.fields?.password}
          required
        />
        <PasswordMeter password={password} />
      </div>
      <Field id="confirmation" name="confirmation" type="password" label="Confirmer le mot de passe" autoComplete="new-password" error={state.fields?.confirmation} required />
      <Button type="submit" pending={pending} pendingLabel="Enregistrement…" className="w-full py-3.5">
        Enregistrer le mot de passe
      </Button>
    </form>
  );
}
