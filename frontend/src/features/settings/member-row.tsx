"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { OneTimeSecret } from "@/components/ui/one-time-secret";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { formatDateTime, formatSince, ROLE_LABEL } from "@/lib/format";
import type { Member, PresenceEntry } from "@/lib/types";

import { type MemberActionState, memberAction } from "./actions";
import { ROLE_HELP } from "./add-member-form";
import { GRANT_TEXT, GRANTABLE } from "./grants";

const initial: MemberActionState = {};

type Mode = "role" | "password" | "remove" | "grants";

const hourMinute = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Abidjan" });

/** Où en est la personne aujourd'hui : l'heure de connexion seulement, jamais l'IP ni l'appareil. */
function PresenceLine({ presence }: { presence: PresenceEntry }) {
  const label =
    presence.status === "today"
      ? `Connecté·e aujourd’hui${presence.first_seen_today ? ` dès ${hourMinute.format(new Date(presence.first_seen_today))}` : ""}`
      : presence.status === "absent"
        ? `Pas connecté·e aujourd’hui${presence.last_seen_at ? ` · dernière fois ${formatSince(presence.last_seen_at)}` : ""}`
        : "Jamais connecté·e";
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
      <span className={cn("inline-flex items-center gap-1.5", presence.status === "today" ? "text-texte" : "text-texte-3")}>
        <span aria-hidden className={cn("size-2 rounded-full", presence.status === "today" ? "pastille-en-ligne bg-orange" : "border border-white/35")} />
        {label}
      </span>
      {presence.handled_today > 0 ? (
        <span className="text-texte-2">
          {presence.handled_today} commande{presence.handled_today > 1 ? "s" : ""} traitée{presence.handled_today > 1 ? "s" : ""} aujourd’hui
        </span>
      ) : null}
    </p>
  );
}

type MemberRowProps = {
  slug: string;
  member: Member;
  mfaEnabled: boolean;
  /** Qui regarde : le propriétaire peut tout ; un gérant qui a « Gérer les vendeurs » n'agit que sur les vendeurs. */
  viewer?: { isOwner: boolean; canManageSellers: boolean };
  presence?: PresenceEntry;
};

/** Une personne de l'équipe. Le propriétaire et soi-même n'ont pas d'actions : Django refuserait de toute façon. */
export function MemberRow({ slug, member, mfaEnabled, viewer = { isOwner: true, canManageSellers: true }, presence }: MemberRowProps) {
  const [state, formAction, pending] = useActionState(memberAction, initial);
  const [mode, setMode] = useState<Mode | null>(null);
  const [givesDiscounts, setGivesDiscounts] = useState(member.grants?.includes("discounts.give") ?? false);
  const editable = member.role !== "owner" && !member.is_you && (viewer.isOwner || (viewer.canManageSellers && member.role === "seller"));
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
          {presence ? <PresenceLine presence={presence} /> : null}
          {member.role === "manager" && member.grants && member.grants.length > 0 ? (
            <p className="mt-1 text-[12.5px] text-indigo-clair">
              Pouvoirs en plus :{" "}
              {member.grants
                .map((grant) =>
                  grant === "discounts.give" && member.discount_cap_percent
                    ? `offrir des réductions (jusqu’à ${member.discount_cap_percent} %)`
                    : (GRANT_TEXT[grant as keyof typeof GRANT_TEXT]?.label.toLowerCase() ?? grant),
                )
                .join(", ")}
            </p>
          ) : null}
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
            {viewer.isOwner ? (
              <button type="button" onClick={() => open("role")} aria-expanded={mode === "role"} className="rounded-full border border-trait px-3 py-1.5 text-[13px] text-texte-2 hover:bg-white/10 hover:text-texte">
                Changer le poste
              </button>
            ) : null}
            {viewer.isOwner && member.role === "manager" ? (
              <button type="button" onClick={() => open("grants")} aria-expanded={mode === "grants"} className="rounded-full border border-indigo-clair/40 px-3 py-1.5 text-[13px] text-indigo-clair hover:bg-white/10">
                Pouvoirs
              </button>
            ) : null}
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
          ) : panel === "grants" ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-[13px] font-semibold text-texte-2">Ce que {firstName} peut faire en plus</legend>
              <p className="mb-1.5 text-[12.5px] text-texte-3">
                Toujours réservés au propriétaire : l’objectif du mois, le plan, les clés API, nommer un fidèle et gérer un autre gérant.
              </p>
              {GRANTABLE.map((grant) => (
                <label
                  key={grant}
                  className="flex cursor-pointer items-start gap-2.5 rounded-[14px] border border-trait-doux bg-encre/40 px-3 py-2 has-checked:border-indigo-clair/50 has-checked:bg-white/10"
                >
                  <input
                    type="checkbox"
                    name="grants"
                    value={grant}
                    defaultChecked={member.grants?.includes(grant)}
                    onChange={grant === "discounts.give" ? (event) => setGivesDiscounts(event.target.checked) : undefined}
                    className="mt-1 accent-indigo"
                  />
                  <span>
                    <span className="text-[14px] font-semibold">{GRANT_TEXT[grant].label}</span>
                    <span className="block text-[12.5px] text-texte-3">{GRANT_TEXT[grant].help}</span>
                  </span>
                </label>
              ))}
              {/* Le plafond n'a de sens qu'avec le droit : Django l'exige alors, et l'efface sans lui. */}
              {givesDiscounts ? (
                <div className="ml-7 flex items-center gap-2.5 text-[13px]">
                  <label htmlFor={`plafond-${member.user_id}`} className="text-texte-2">
                    Plafond des remises
                  </label>
                  <input
                    id={`plafond-${member.user_id}`}
                    name="discount_cap_percent"
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={90}
                    defaultValue={member.discount_cap_percent ?? 10}
                    required
                    className="w-16 rounded-[10px] border border-white/15 bg-encre/45 px-2 py-1 text-center text-texte tabular-nums outline-none focus-visible:border-orange"
                  />
                  <span className="text-texte-3">%</span>
                </div>
              ) : null}
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
              what={
                panel === "role" ? `changer le poste de ${firstName}` : panel === "grants" ? `changer les pouvoirs de ${firstName}` : `refaire le mot de passe de ${firstName}`
              }
              error={state.reauthError}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" pending={pending} pendingLabel="Envoi…" className="px-5 py-2.5 text-sm">
              {panel === "role" ? "Changer le poste" : panel === "grants" ? "Enregistrer les pouvoirs" : panel === "password" ? "Créer le mot de passe" : `Retirer ${firstName}`}
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
