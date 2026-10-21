"use client";

import Link from "next/link";
import { type FormEvent, startTransition, useActionState, useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { OneTimeSecret } from "@/components/ui/one-time-secret";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { FormAlert } from "@/features/auth/form-alert";
import { formatDateTime } from "@/lib/format";

import { type AddMemberState, addMember } from "./actions";

const initial: AddMemberState = {};

export const ROLE_HELP = {
  manager: "Commandes, produits, chiffre d’affaires, export des ventes et consignes à l’équipe. Pas les paramètres.",
  seller: "Traite les commandes et consulte le catalogue. Ne voit ni le chiffre d’affaires ni les exports.",
} as const;

type AddMemberFormProps = {
  slug: string;
  mfaEnabled: boolean;
  /** La limite du plan est atteinte : on explique au lieu d'ouvrir un formulaire qui serait refusé. */
  full: { plan: string; limit: number } | null;
};

/**
 * Ajouter un gérant ou un vendeur. Akwaba crée son compte avec un mot de passe provisoire, affiché ici une seule fois :
 * le patron le donne de vive voix, et la personne choisit le sien à sa première connexion.
 */
export function AddMemberForm({ slug, mfaEnabled, full }: AddMemberFormProps) {
  const [state, formAction, pending] = useActionState(addMember, initial);
  const form = useRef<HTMLFormElement>(null);
  const fields = state.fields ?? {};

  // Compte créé : on vide le formulaire pour la personne suivante (le secret reste affiché au-dessus).
  useEffect(() => {
    if (state.created) form.current?.reset();
  }, [state.created]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <section aria-labelledby="titre-ajouter" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-4">
      <h2 id="titre-ajouter" className="text-sm text-texte-2">
        Ajouter quelqu’un
      </h2>

      {state.created ? (
        <OneTimeSecret label={`Mot de passe provisoire de ${state.created.name}`} value={state.created.password}>
          <p className="text-[13px] text-texte-2">
            Donnez-le à {state.created.name.split(" ")[0]} de vive voix ou par appel, pas par SMS. Connexion avec{" "}
            <span className="font-mono text-texte">{state.created.email}</span> : Akwaba lui fera aussitôt choisir son propre mot de passe.
            {state.created.expiresAt ? ` Valable jusqu’au ${formatDateTime(state.created.expiresAt)}.` : null}
          </p>
        </OneTimeSecret>
      ) : null}

      {full ? (
        <p className="rounded-[18px] border border-ocre/35 bg-ocre/10 px-4 py-3 text-sm">
          Le plan {full.plan} permet {full.limit} personne{full.limit > 1 ? "s" : ""}, vous compris.{" "}
          <Link href={`/app/${slug}/parametres?onglet=plan`} className="font-semibold text-ocre underline-offset-2 hover:underline">
            Voir les plans
          </Link>
        </p>
      ) : (
        <form ref={form} onSubmit={submit} noValidate className="flex flex-col gap-4">
          <input type="hidden" name="slug" value={slug} />
          {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            <Field id="prenom-membre" name="first_name" label="Prénom" autoComplete="off" maxLength={80} required error={fields.first_name} />
            <Field id="nom-membre" name="last_name" label="Nom" autoComplete="off" maxLength={80} required error={fields.last_name} />
          </div>
          <Field
            id="email-membre"
            name="email"
            type="email"
            label="Son e-mail"
            autoComplete="off"
            spellCheck={false}
            maxLength={254}
            required
            hint="Une adresse qui n’a pas encore de compte Akwaba."
            error={fields.email}
          />
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-2 text-[13px] font-semibold text-texte-2">Son rôle</legend>
            {(["seller", "manager"] as const).map((role) => (
              <label
                key={role}
                className="flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-trait-doux bg-encre/40 px-3 py-2.5 has-checked:border-sable/45 has-checked:bg-white/10"
              >
                <input type="radio" name="role" value={role} defaultChecked={role === "seller"} className="mt-1 accent-orange" />
                <span>
                  <span className="text-[14px] font-semibold">{role === "seller" ? "Vendeur" : "Gérant"}</span>
                  <span className="block text-[12.5px] text-texte-3">{ROLE_HELP[role]}</span>
                </span>
              </label>
            ))}
            {fields.role ? <p className="text-[13px] text-danger-clair">{fields.role}</p> : null}
          </fieldset>
          {state.reauth ? <ReauthFields mfaEnabled={mfaEnabled} what="donner accès aux commandes et aux clients" error={state.reauthError} /> : null}
          <Button type="submit" pending={pending} pendingLabel="Création du compte…" className="self-start">
            {state.reauth ? "Confirmer et créer le compte" : "Créer son compte"}
          </Button>
        </form>
      )}
    </section>
  );
}
