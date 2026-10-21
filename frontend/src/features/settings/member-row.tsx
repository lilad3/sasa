"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { OneTimeSecret } from "@/components/ui/one-time-secret";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { formatDateTime, ROLE_LABEL } from "@/lib/format";
import type { Member } from "@/lib/types";

import { type MemberActionState, memberAction } from "./actions";
import { ROLE_HELP } from "./add-member-form";

const initial: MemberActionState = {};

type Mode = "role" | "password" | "remove";

/** Une personne de l'équipe. Le propriétaire et soi-même n'ont pas d'actions : Django refuserait de toute façon. */
export function MemberRow({ slug, member, mfaEnabled }: { slug: string; member: Member; mfaEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(memberAction, initial);
  const [mode, setMode] = useState<Mode | null>(null);
  const editable = member.role !== "owner" && !member.is_you;
  const firstName = member.first_name || member.name;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  function open(next: Mode) {
    setMode((current) => (current === next ? null : next));
  }

  // Après une action réussie, le panneau se referme ; le message reste jusqu'à la prochaine.
  const [handled, setHandled] = useState(state);
  if (handled !== state) {
    setHandled(state);
    if (state.done || state.access) setMode(null);
  }
  const panel = mode;

  return (
    <li className="carte flex flex-col gap-3 rounded-[18px] p-3.5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[15px] font-semibold">
            {member.name}
            {member.is_you ? <span className="text-[12.5px] font-normal text-texte-3">(vous)</span> : null}
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[11.5px] font-semibold",
                member.role === "owner" ? "bg-orange/20 text-orange-clair" : member.role === "manager" ? "bg-indigo/25 text-indigo-clair" : "bg-white/10 text-texte-2",
              )}
            >
              {ROLE_LABEL[member.role]}
            </span>
          </p>
          {member.email ? <p className="truncate font-mono text-[12.5px] text-texte-3">{member.email}</p> : null}
          <p className="mt-1 text-[12.5px] text-texte-3">
            {member.pending
              ? member.temporary_password_expires_at && new Date(member.temporary_password_expires_at) > new Date()
                ? `N’a pas encore choisi son mot de passe · provisoire valable jusqu’au ${formatDateTime(member.temporary_password_expires_at)}`
                : "Mot de passe provisoire expiré : refaites-en un."
              : `Dans l’équipe depuis le ${formatDateTime(member.joined_at)}`}
          </p>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => open("role")} aria-expanded={mode === "role"} className="rounded-full border border-trait px-3 py-1.5 text-[13px] text-texte-2 hover:bg-white/10 hover:text-texte">
              Changer le rôle
            </button>
            {member.pending ? (
              <button type="button" onClick={() => open("password")} aria-expanded={mode === "password"} className="rounded-full border border-trait px-3 py-1.5 text-[13px] text-texte-2 hover:bg-white/10 hover:text-texte">
                Nouveau mot de passe provisoire
              </button>
            ) : null}
            <button type="button" onClick={() => open("remove")} aria-expanded={mode === "remove"} className="rounded-full px-3 py-1.5 text-[13px] text-texte-3 hover:text-danger-clair">
              Retirer
            </button>
          </div>
        ) : null}
      </div>

      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      {state.done && !pending ? <FormAlert tone="success">{state.done}</FormAlert> : null}
      {state.access ? (
        <OneTimeSecret label={`Nouveau mot de passe provisoire de ${firstName}`} value={state.access.password}>
          <p className="text-[13px] text-texte-2">
            L’ancien ne fonctionne plus et ses sessions sont fermées. Donnez-le-lui de vive voix.
            {state.access.expiresAt ? ` Valable jusqu’au ${formatDateTime(state.access.expiresAt)}.` : null}
          </p>
        </OneTimeSecret>
      ) : null}

      {editable && panel ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3 border-t border-trait-doux pt-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="member" value={member.user_id} />
          <input type="hidden" name="intent" value={panel} />
          {panel === "role" ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-2 text-[13px] font-semibold text-texte-2">Nouveau rôle de {firstName}</legend>
              {(["seller", "manager"] as const).map((role) => (
                <label
                  key={role}
                  className="flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-trait-doux bg-encre/40 px-3 py-2 has-checked:border-sable/45 has-checked:bg-white/10"
                >
                  <input type="radio" name="role" value={role} defaultChecked={role === member.role} className="mt-1 accent-orange" />
                  <span>
                    <span className="text-[14px] font-semibold">{ROLE_LABEL[role]}</span>
                    <span className="block text-[12.5px] text-texte-3">{ROLE_HELP[role]}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : panel === "password" ? (
            <p className="text-[13.5px] text-texte-2">
              {firstName} a perdu son mot de passe provisoire, ou il a expiré ? Akwaba en crée un nouveau, valable 72 heures. L’ancien cesse de fonctionner.
            </p>
          ) : (
            <p className="text-[13.5px] text-texte-2">
              {firstName} perd l’accès à la boutique tout de suite, sur tous ses appareils. Ses commandes traitées et ses notes restent dans l’historique.
            </p>
          )}
          {state.reauth === panel ? (
            <ReauthFields
              mfaEnabled={mfaEnabled}
              what={panel === "role" ? `changer le rôle de ${firstName}` : `refaire le mot de passe de ${firstName}`}
              error={state.reauthError}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" pending={pending} pendingLabel="Envoi…" className="px-5 py-2.5 text-sm">
              {panel === "role" ? "Changer le rôle" : panel === "password" ? "Créer le mot de passe" : `Retirer ${firstName}`}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setMode(null)} className="px-5 py-2.5 text-sm">
              Annuler
            </Button>
          </div>
        </form>
      ) : null}
    </li>
  );
}
