"use client";

import Link from "next/link";
import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

import { FormAlert } from "./form-alert";
import { type PasswordFormState, resetPassword } from "./password-actions";

const initial: PasswordFormState = {};

/** Jauge indicative : la vraie règle est vérifiée par Django (liste noire, similarité, motifs locaux). */
function strength(password: string) {
  if (password.length < 10) return { level: password ? 1 : 0, label: password ? "Trop court : au moins 10 caractères" : "" };
  let score = 2;
  if (password.length >= 14) score++;
  if (/[^A-Za-z0-9]/.test(password) || (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) score++;
  return { level: Math.min(score, 4), label: ["", "", "Correct", "Solide", "Très solide"][Math.min(score, 4)] };
}

export function ResetForm({ uid, token }: { uid: string; token: string }) {
  const [state, formAction, pending] = useActionState(resetPassword, initial);
  const [password, setPassword] = useState("");
  const meter = strength(password);

  useEffect(() => {
    // Le jeton ne reste pas dans la barre d'adresse (historique, partage d'écran, capture).
    if (window.location.search) window.history.replaceState(null, "", window.location.pathname);
  }, []);

  if (!uid || !token || state.error?.code === "token_invalid_or_expired") {
    return (
      <div className="flex flex-col gap-4">
        <FormAlert tone="danger">Ce lien n'est plus valable : il a déjà servi ou a dépassé ses 30 minutes.</FormAlert>
        <Link href="/mot-de-passe-oublie" className="text-sm font-semibold text-pistache underline decoration-pistache/40 underline-offset-[3px]">
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
        <div aria-hidden className="grid grid-cols-4 gap-1.5">
          {[1, 2, 3, 4].map((step) => (
            <span key={step} className={`h-1 rounded-full ${meter.level >= step ? (meter.level >= 3 ? "bg-lime" : "bg-alerte") : "bg-white/10"}`} />
          ))}
        </div>
        {meter.label ? <p className="text-[13px] text-texte-3">{meter.label}</p> : null}
      </div>
      <Field id="confirmation" name="confirmation" type="password" label="Confirmer le mot de passe" autoComplete="new-password" error={state.fields?.confirmation} required />
      <Button type="submit" pending={pending} pendingLabel="Enregistrement…" className="w-full py-3.5">
        Enregistrer le mot de passe
      </Button>
    </form>
  );
}
