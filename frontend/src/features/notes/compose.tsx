"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { ROLE_LABEL } from "@/lib/format";
import type { Member, NoteAudience } from "@/lib/types";

import { type ComposeState, sendNote } from "./actions";

const AUDIENCES: { value: NoteAudience; label: string }[] = [
  { value: "all", label: "Toute l’équipe" },
  { value: "managers", label: "Les gérants" },
  { value: "sellers", label: "Les vendeurs" },
  { value: "member", label: "Une personne" },
];

const initial: ComposeState = {};

/** Écrire une consigne : le texte, à qui, et si elle est urgente. */
export function ComposeNote({ slug, members }: { slug: string; members: Member[] }) {
  const [state, formAction, pending] = useActionState(sendNote, initial);
  const [audience, setAudience] = useState<NoteAudience>("all");
  const others = members.filter((member) => !member.is_you);

  return (
    <section aria-labelledby="titre-ecrire" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-4">
      <h2 id="titre-ecrire" className="text-sm text-texte-2">
        Écrire à l’équipe
      </h2>
      {state.done && !pending ? <FormAlert tone="success">Message épinglé. Chacun le verra en haut de ses pages jusqu’à « C’est noté ».</FormAlert> : null}
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}

      {/* Après l'envoi, React vide le formulaire : on revient aussi à « Toute l'équipe ». */}
      <form action={formAction} onReset={() => setAudience("all")} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={slug} />
        <div className="flex flex-col gap-[7px]">
          <label htmlFor="message" className="text-[13px] font-semibold text-texte-2">
            Votre message
          </label>
          <textarea
            id="message"
            name="body"
            rows={5}
            maxLength={1000}
            required
            aria-invalid={state.fields?.body ? true : undefined}
            aria-describedby={state.fields?.body ? "message-erreur" : undefined}
            placeholder="Pas de livraison à Yopougon jeudi : appelez les clients pour proposer vendredi."
            className={cn(
              "w-full resize-y rounded-champ border border-white/15 bg-encre/45 px-[15px] py-3 text-[15px] leading-relaxed text-texte outline-none placeholder:text-texte-3 focus-visible:border-orange focus-visible:shadow-[0_0_0_3px_rgb(255_122_31/0.28)]",
              state.fields?.body && "border-danger",
            )}
          />
          {state.fields?.body ? (
            <p id="message-erreur" className="text-[13px] text-danger-clair">
              {state.fields.body}
            </p>
          ) : null}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-[13px] font-semibold text-texte-2">Pour qui</legend>
          <div className="grid grid-cols-2 gap-1.5">
            {AUDIENCES.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-center gap-2 rounded-[12px] border border-trait-doux bg-encre/40 px-3 py-2 text-[13.5px] has-checked:border-sable/45 has-checked:bg-white/10"
              >
                <input
                  type="radio"
                  name="audience"
                  value={option.value}
                  defaultChecked={option.value === "all"}
                  onChange={() => setAudience(option.value)}
                  className="accent-orange"
                />
                {option.label}
              </label>
            ))}
          </div>
          {audience === "member" ? (
            <div className="flex flex-col gap-[7px] pt-1">
              <label htmlFor="destinataire" className="sr-only">
                La personne
              </label>
              <select
                id="destinataire"
                name="recipient"
                defaultValue=""
                aria-invalid={state.fields?.recipient ? true : undefined}
                className="rounded-champ border border-white/15 bg-nuit-2 px-3.5 py-2.5 text-[14.5px] text-texte"
              >
                <option value="" disabled>
                  Choisir une personne
                </option>
                {others.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.name} · {ROLE_LABEL[member.role].toLowerCase()}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {state.fields?.recipient ? <p className="text-[13px] text-danger-clair">{state.fields.recipient}</p> : null}
        </fieldset>

        <label className="flex items-start gap-2.5 text-[14px]">
          <input type="checkbox" name="urgent" className="mt-1 size-4 accent-ocre" />
          <span>
            <span className="font-semibold">Urgent</span>
            <span className="block text-[12.5px] text-texte-3">Passe avant les autres messages, avec la lueur ocre.</span>
          </span>
        </label>

        <Button type="submit" pending={pending} pendingLabel="Envoi…" className="self-start">
          Épingler pour l’équipe
        </Button>
      </form>
    </section>
  );
}
