"use client";

import Link from "next/link";
import { useActionState, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { formatWait } from "@/lib/messages";

import { type AuthFormState, login } from "./actions";
import { FormAlert } from "./form-alert";
import { useCountdown } from "./use-countdown";

type DemoAccount = { email: string; name: string; role: string };

type LoginFormProps = {
  notice?: string;
  next: string;
  demo: { accounts: DemoAccount[]; password: string } | null;
};

const initial: AuthFormState = {};

export function LoginForm({ notice, next, demo }: LoginFormProps) {
  const [state, formAction, pending] = useActionState(login, initial);
  const [showPassword, setShowPassword] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const wait = useCountdown(state.error?.retryAfter, state);
  const blocked = wait > 0;

  function fillDemo(account: DemoAccount) {
    if (!demo || !emailRef.current || !passwordRef.current) return;
    emailRef.current.value = account.email;
    passwordRef.current.value = demo.password;
    passwordRef.current.focus();
  }

  return (
    <>
      <form action={formAction} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="suite" value={next} />

        {notice && !state.error ? <FormAlert tone="info">{notice}</FormAlert> : null}
        {state.error ? (
          <FormAlert tone="danger">
            <p>{state.error.message}</p>
            {blocked ? <p className="mt-1 font-semibold">Réessayez dans {formatWait(wait)}.</p> : null}
            {state.error.attemptsRemaining !== undefined && !blocked ? (
              <p className="mt-1">
                {state.error.attemptsRemaining === 1
                  ? "Dernier essai avant un blocage de 15 minutes."
                  : `Encore ${state.error.attemptsRemaining} essais avant un blocage de 15 minutes.`}
              </p>
            ) : null}
            {state.error.requestId ? <p className="mt-1 font-mono text-xs">Référence : {state.error.requestId}</p> : null}
          </FormAlert>
        ) : null}

        <Field
          ref={emailRef}
          id="email"
          name="email"
          type="email"
          label="Adresse e-mail"
          placeholder="vous@boutique.ci"
          autoComplete="username"
          inputMode="email"
          defaultValue={state.email}
          error={state.fields?.email}
          required
        />
        <Field
          ref={passwordRef}
          id="password"
          name="password"
          type={showPassword ? "text" : "password"}
          label="Mot de passe"
          autoComplete="current-password"
          error={state.fields?.password}
          required
          trailing={
            <button
              type="button"
              onClick={() => setShowPassword((shown) => !shown)}
              aria-controls="password"
              aria-pressed={showPassword}
              className="rounded-[9px] bg-white/[0.08] px-2.5 py-1.5 text-[13px] font-semibold text-sable hover:bg-white/15"
            >
              {showPassword ? "Masquer" : "Afficher"}
            </button>
          }
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <label className="group inline-flex cursor-pointer items-center gap-2.5 text-sm text-texte-2">
            <input type="checkbox" name="shared" role="switch" className="peer sr-only" />
            <span
              aria-hidden
              className="relative h-6 w-10 rounded-full bg-white/15 transition-colors peer-checked:bg-orange peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange-clair after:absolute after:top-[3px] after:left-[3px] after:size-[18px] after:rounded-full after:bg-texte after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-encre"
            />
            Appareil partagé
          </label>
          <Link
            href="/mot-de-passe-oublie"
            className="text-sm font-semibold text-sable underline decoration-sable/40 underline-offset-[3px] hover:decoration-sable"
          >
            Mot de passe oublié ?
          </Link>
        </div>
        <p className="-mt-2 text-[13px] text-texte-3">
          Cybercafé, téléphone prêté : vous serez déconnecté en fermant le navigateur ou après 15 min d’inactivité.
        </p>

        <Button type="submit" pending={pending} pendingLabel="Connexion…" disabled={blocked} className="w-full py-3.5">
          {blocked ? `Réessayez dans ${formatWait(wait)}` : "Se connecter"}
        </Button>
      </form>

      {demo ? (
        <div className="flex flex-col gap-2.5 border-t border-trait pt-4">
          <span className="font-mono text-xs text-texte-3">Comptes de démonstration · Maison Adjoua</span>
          <div className="flex flex-wrap gap-2">
            {demo.accounts.map((account) => (
              <button
                key={account.email}
                type="button"
                onClick={() => fillDemo(account)}
                className="inline-flex items-center gap-2 rounded-full border border-trait bg-encre/35 py-[7px] pr-3.5 pl-[7px] text-[13.5px] hover:bg-white/10"
              >
                <span aria-hidden className="grid size-6 place-items-center rounded-full bg-sable text-[11px] font-bold text-encre">
                  {account.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")}
                </span>
                {account.name.split(" ")[0]}
                <span className="text-texte-3">· {account.role}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}
