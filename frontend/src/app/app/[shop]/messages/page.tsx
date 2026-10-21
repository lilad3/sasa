import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/ui/submit-button";
import { acknowledgeNote, withdrawNote } from "@/features/notes/actions";
import { ComposeNote } from "@/features/notes/compose";
import { NoteCard } from "@/features/notes/note-card";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { getMembers, getMyShops, getTeamNotes } from "@/lib/server/session";
import type { TeamNote } from "@/lib/types";

export const metadata: Metadata = { title: "Le mot du patron" };

export default function MessagesPage({ params }: PageProps<"/app/[shop]/messages">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[420px] animate-pulse rounded-[24px]" />}>
      <MessagesFromRoute params={params} />
    </Suspense>
  );
}

async function MessagesFromRoute({ params }: Pick<PageProps<"/app/[shop]/messages">, "params">) {
  const { shop } = await params;
  const [notes, shops] = await Promise.all([getTeamNotes(shop), getMyShops()]);
  if (!notes.ok) {
    if (notes.problem.status === 404) notFound();
    throw new Error(notes.problem.detail);
  }
  const membership = shops.ok ? shops.data.find((item) => item.slug === shop) : undefined;
  const canSend = membership?.permissions.includes("notes.send") ?? false;
  const isOwner = membership?.role === "owner";
  const members = canSend ? await getMembers(shop) : null;

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">{canSend ? "Vos consignes, et qui les a lues" : "Les consignes de la boutique"}</p>
          <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Le mot du patron</h1>
        </div>
      </header>

      {canSend && members?.ok ? <ComposeNote slug={shop} members={members.data} /> : null}

      <section aria-label="Messages" className={cn("col-span-full flex flex-col gap-2.5 md:gap-3", canSend && "lg:col-span-6")}>
        {notes.data.length === 0 ? (
          <p className="vitre rounded-[24px] p-6 text-sm text-texte-3">
            {canSend ? "Aucun message pour l’instant. Votre premier message s’affichera en haut des pages de l’équipe." : "Aucun message pour vous pour l’instant."}
          </p>
        ) : (
          notes.data.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              actions={<NoteActions note={note} slug={shop} canWithdraw={canSend && (note.author.is_you || isOwner)} />}
              footer={note.receipts ? <Receipts receipts={note.receipts} /> : null}
            />
          ))
        )}
      </section>
    </>
  );
}

function NoteActions({ note, slug, canWithdraw }: { note: TeamNote; slug: string; canWithdraw: boolean }) {
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
function Receipts({ receipts }: { receipts: NonNullable<TeamNote["receipts"]> }) {
  const read = receipts.filter((receipt) => receipt.read_at).length;
  return (
    <div className="flex flex-col gap-2 border-t border-trait-doux pt-3">
      <p className="text-xs text-texte-3">
        Lu par {read} sur {receipts.length}
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {receipts.map((receipt) => (
          <li
            key={receipt.name}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px]",
              receipt.read_at ? "border-vert/35 text-texte" : "border-trait text-texte-3",
            )}
          >
            <span aria-hidden className={cn("size-1.5 rounded-full", receipt.read_at ? "bg-vert" : "bg-white/25")} />
            {receipt.name}
            <span className="text-texte-3">{receipt.read_at ? formatDateTime(receipt.read_at) : "pas encore lu"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
