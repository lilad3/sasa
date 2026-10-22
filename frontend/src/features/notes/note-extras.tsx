import { SubmitButton } from "@/components/ui/submit-button";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { TeamNote } from "@/lib/types";

import { acknowledgeNote, withdrawNote } from "./actions";

/** « C'est noté » pour le destinataire ; « Retirer » pour l'auteur ou le propriétaire. */
export function NoteActions({ note, slug, canWithdraw }: { note: TeamNote; slug: string; canWithdraw: boolean }) {
  return (
    <>
      {note.for_you && !note.read_at && !note.withdrawn ? (
        <form action={acknowledgeNote}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="note" value={note.id} />
          <SubmitButton pendingLabel="Enregistrement…" className="px-5 py-2.5 text-sm">
            C’est noté
          </SubmitButton>
        </form>
      ) : null}
      {note.for_you && note.read_at ? <span className="text-xs text-texte-3">Lu {formatDateTime(note.read_at)}</span> : null}
      {canWithdraw && !note.withdrawn ? (
        <form action={withdrawNote}>
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="note" value={note.id} />
          <button type="submit" className="rounded-full px-3 py-2 text-[13px] text-texte-3 hover:text-danger-clair">
            Retirer
          </button>
        </form>
      ) : null}
    </>
  );
}

/** Qui a lu, et quand : ceux qui n'ont pas encore lu passent en dernier. */
export function Receipts({ receipts }: { receipts: NonNullable<TeamNote["receipts"]> }) {
  const read = receipts.filter((receipt) => receipt.read_at).length;
  return (
    <div className="flex flex-col gap-2 border-t border-trait-doux pt-3">
      <p className="text-xs text-texte-3">
        Vu par {read} sur {receipts.length}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {receipts.map((receipt) => (
          <li
            key={receipt.name}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]",
              receipt.read_at ? "border-indigo-clair/40 text-texte" : "border-trait text-texte-3",
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", receipt.read_at ? "bg-indigo-clair" : "bg-white/25")} />
            {receipt.name}
            <span className="text-texte-3">{receipt.read_at ? formatDateTime(receipt.read_at) : "pas encore vu"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
