"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { OrderNote } from "@/lib/types";

import { addOrderNote, type OrderNoteState } from "./actions";

const initial: OrderNoteState = {};

/** Le fil de l'équipe sur une commande : qui a fait quoi, pour que le suivant reprenne sans rappeler le client. */
export function OrderNotes({ slug, orderId, notes, canWrite }: { slug: string; orderId: string; notes: OrderNote[]; canWrite: boolean }) {
  const [state, formAction, pending] = useActionState(addOrderNote, initial);

  return (
    <section aria-labelledby="titre-notes" className="vitre flex flex-col gap-3 rounded-[24px] p-[18px]">
      <div>
        <h2 id="titre-notes" className="text-sm text-texte-2">
          Notes de l’équipe
        </h2>
        <p className="mt-0.5 text-xs text-texte-3">Visibles seulement par l’équipe, jamais par le client.</p>
      </div>
      {notes.length === 0 ? (
        <p className="text-sm text-texte-3">Aucune note pour l’instant.</p>
      ) : (
        <ol className="flex flex-col gap-2.5">
          {notes.map((note) => (
            <li key={note.id} className="border-l-2 border-sable/30 pl-3">
              <p className="text-[14px] whitespace-pre-line">{note.body}</p>
              <p className="mt-0.5 text-xs text-texte-3">
                {note.author_name} · {formatDateTime(note.created_at)}
              </p>
            </li>
          ))}
        </ol>
      )}
      {canWrite ? (
        <form action={formAction} noValidate className="flex flex-col gap-2 border-t border-trait-doux pt-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="order" value={orderId} />
          {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
          <label htmlFor="note-commande" className="sr-only">
            Nouvelle note
          </label>
          <textarea
            id="note-commande"
            name="body"
            rows={2}
            maxLength={500}
            placeholder="Client injoignable, rappeler à 18 h…"
            aria-invalid={state.field ? true : undefined}
            className={cn(
              "w-full resize-y rounded-champ border border-white/15 bg-encre/45 px-3.5 py-2.5 text-[14px] text-texte outline-none placeholder:text-texte-3 focus-visible:border-orange",
              state.field && "border-danger",
            )}
          />
          {state.field ? <p className="text-[13px] text-danger-clair">{state.field}</p> : null}
          <Button type="submit" variant="ghost" pending={pending} pendingLabel="Ajout…" className="self-start px-4 py-2 text-sm">
            Ajouter la note
          </Button>
        </form>
      ) : null}
    </section>
  );
}
