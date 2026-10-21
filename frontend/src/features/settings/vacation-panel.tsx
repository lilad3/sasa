"use client";

import { type FormEvent, startTransition, useActionState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/features/auth/form-alert";
import { formatDay } from "@/lib/format";
import type { ShopSettings } from "@/lib/types";

import { saveVacation, type VacationState } from "./actions";

const initial: VacationState = {};

/**
 * Le mode congé : la vitrine reste en ligne avec un mot pour les clients, mais Django refuse les commandes.
 * `tomorrow` vient du serveur (heure d'Abidjan) : le navigateur et le serveur affichent la même date minimale.
 */
export function VacationPanel({ settings, tomorrow }: { settings: ShopSettings; tomorrow: string }) {
  const [state, formAction, pending] = useActionState(saveVacation, initial);
  const { vacation } = settings;
  const fields = state.fields ?? {};

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <section aria-labelledby="titre-conge" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-4">
      <div className="flex items-center justify-between gap-2">
        <h2 id="titre-conge" className="text-sm text-texte-2">
          Mode congé
        </h2>
        <span
          className={
            vacation.on_vacation
              ? "rounded-full bg-ocre px-2.5 py-1 text-[12px] font-bold text-encre"
              : "rounded-full border border-vert/40 px-2.5 py-1 text-[12px] font-semibold text-texte"
          }
        >
          {vacation.on_vacation ? "En congé" : "Ouverte"}
        </span>
      </div>
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      {state.done && !pending ? <FormAlert tone="success">{state.done}</FormAlert> : null}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={settings.slug} />
        <input type="hidden" name="intent" value={vacation.on_vacation ? "stop" : "start"} />
        {vacation.on_vacation ? (
          <>
            <div className="carte rounded-[18px] p-4 text-sm">
              <p className="text-texte-2">Les clients voient en haut de la vitrine :</p>
              <p className="mt-2 text-texte">« {vacation.message || "La boutique est en congé."} »</p>
              <p className="mt-2 text-[13px] text-texte-3">
                {vacation.until ? `Réouverture automatique le ${formatDay(vacation.until)}.` : "Pas de date de retour : rouvrez à la main."}
              </p>
            </div>
            <Button type="submit" pending={pending} pendingLabel="Réouverture…" className="self-start">
              Rouvrir la boutique
            </Button>
          </>
        ) : (
          <>
            <p className="text-[13.5px] text-texte-2">
              Un voyage, un inventaire, un deuil : la vitrine reste visible, mais personne ne peut commander. Les commandes déjà passées restent à traiter.
            </p>
            {vacation.active && vacation.until ? (
              <p className="text-[13px] text-texte-3">Votre dernier congé s’est terminé le {formatDay(vacation.until)} : la vitrine a rouvert toute seule.</p>
            ) : null}
            <div className="flex flex-col gap-[7px]">
              <label htmlFor="message-conge" className="text-[13px] font-semibold text-texte-2">
                Le mot pour les clients
              </label>
              <textarea
                id="message-conge"
                name="vacation_message"
                rows={3}
                maxLength={280}
                defaultValue={vacation.message}
                placeholder="Nous sommes à Man pour la récolte du café. Retour le 3 novembre !"
                aria-invalid={fields.vacation_message ? true : undefined}
                aria-describedby={fields.vacation_message ? "message-conge-erreur" : undefined}
                className="w-full resize-y rounded-champ border border-white/15 bg-encre/45 px-[15px] py-3 text-[15px] leading-relaxed text-texte outline-none placeholder:text-texte-3 focus-visible:border-orange focus-visible:shadow-[0_0_0_3px_rgb(255_122_31/0.28)]"
              />
              {fields.vacation_message ? (
                <p id="message-conge-erreur" className="text-[13px] text-danger-clair">
                  {fields.vacation_message}
                </p>
              ) : null}
            </div>
            <Field
              id="retour-conge"
              name="vacation_until"
              type="date"
              label="Date de retour (facultatif)"
              min={tomorrow}
              hint="Ce jour-là, la vitrine rouvre toute seule."
              error={fields.vacation_until}
              className="[color-scheme:dark]"
            />
            <Button type="submit" pending={pending} pendingLabel="Fermeture…" className="self-start">
              Mettre la boutique en congé
            </Button>
          </>
        )}
      </form>
    </section>
  );
}
