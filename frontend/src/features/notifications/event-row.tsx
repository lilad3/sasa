"use client";

import { useActionState, useId } from "react";

import { cn } from "@/lib/cn";
import { formatWait } from "@/lib/messages";
import type { NotificationEvent } from "@/lib/types";

import { saveEvent, type SwitchState } from "./actions";
import type { EventText } from "./text";

const initial: SwitchState = {};

/**
 * Une ligne : un interrupteur qui enregistre tout de suite. C'est un bouton de formulaire (`role="switch"`) :
 * sans JavaScript, il enregistre quand même.
 */
export function EventRow({ slug, event, text }: { slug: string; event: NotificationEvent; text: EventText }) {
  const [state, formAction, pending] = useActionState(saveEvent, initial);
  const id = useId();
  const next = !event.enabled;

  return (
    <li className="flex flex-col gap-1.5 py-4 first:pt-1 last:pb-1">
      <form action={formAction} className="flex items-start justify-between gap-4">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="event" value={event.id} />
        <input type="hidden" name="enabled" value={next ? "1" : "0"} />
        <div className="min-w-0">
          <p id={`${id}-label`} className="text-[15px] font-semibold">
            {text.label}
          </p>
          <p className="mt-0.5 text-[13.5px] text-texte-2">{text.what}</p>
          <p className="mt-0.5 text-[13px] text-texte-3">
            {text.content}
            {event.id === "daily_summary" ? (event.includes_revenue ? " Avec le chiffre d’affaires." : " Sans le chiffre d’affaires.") : null}
          </p>
          <p className="mt-1.5 text-[12.5px]">
            {event.custom ? (
              <span className="rounded-full border border-indigo-clair/40 bg-indigo/15 px-2 py-0.5 font-semibold text-indigo-clair">Choix personnel</span>
            ) : (
              <span className="text-texte-3">Réglage d’origine de votre rôle</span>
            )}
          </p>
        </div>
        <button
          type="submit"
          role="switch"
          aria-checked={event.enabled}
          aria-labelledby={`${id}-label`}
          disabled={pending}
          className="group flex size-11 shrink-0 items-center justify-center rounded-full outline-offset-2 focus-visible:outline-2 focus-visible:outline-indigo-clair disabled:opacity-60"
        >
          <span
            aria-hidden
            className={cn(
              "relative block h-[26px] w-[46px] rounded-full border transition-colors motion-reduce:transition-none",
              event.enabled ? "border-indigo-clair/60 bg-indigo" : "border-sable/25 bg-sable/15",
            )}
          >
            <span
              className={cn(
                "absolute top-[2px] left-[2px] block size-5 rounded-full bg-creme shadow transition-transform motion-reduce:transition-none",
                event.enabled ? "translate-x-5" : "translate-x-0",
              )}
            />
          </span>
          <span className="sr-only">{event.enabled ? "Activé" : "Désactivé"}</span>
        </button>
      </form>
      <p aria-live="polite" className="min-h-[1.25rem] text-[12.5px]">
        {state.error ? (
          <span className="text-danger-clair">
            {state.error.message}
            {state.error.retryAfter ? ` Réessayez dans ${formatWait(state.error.retryAfter)}.` : ""}
          </span>
        ) : state.done ? (
          <span className="text-indigo-clair">Enregistré</span>
        ) : null}
      </p>
    </li>
  );
}
