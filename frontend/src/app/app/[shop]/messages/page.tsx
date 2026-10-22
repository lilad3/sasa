import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { NoteActions } from "@/features/notes/note-extras";
import { NoteCard } from "@/features/notes/note-card";
import { getMyShops, getTeamNotes } from "@/lib/server/session";

export const metadata: Metadata = { title: "Messages" };

export default function MessagesPage({ params }: PageProps<"/app/[shop]/messages">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[420px] animate-pulse rounded-[24px]" />}>
      <MessagesFromRoute params={params} />
    </Suspense>
  );
}

/**
 * Les messages reçus par un vendeur. Le propriétaire et les gérants écrivent et suivent les lectures
 * depuis « Mon personnel » (ou « L'équipe ») : on les y envoie.
 */
async function MessagesFromRoute({ params }: Pick<PageProps<"/app/[shop]/messages">, "params">) {
  const { shop } = await params;
  const shops = await getMyShops();
  const membership = shops.ok ? shops.data.find((item) => item.slug === shop) : undefined;
  if (!membership) notFound();
  if (membership.role !== "seller") redirect(`/app/${shop}/personnel`);

  const notes = await getTeamNotes(shop);
  if (!notes.ok) {
    if (notes.problem.status === 404) notFound();
    throw new Error(notes.problem.detail);
  }

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">Les messages de l’équipe de {membership.name}</p>
          <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Messages</h1>
        </div>
      </header>

      <section aria-label="Messages" className="cascade col-span-full flex flex-col gap-2.5 md:gap-3 lg:col-span-7">
        {notes.data.length === 0 ? (
          <p className="vitre rounded-[24px] p-6 text-sm text-texte-3">Aucun message pour vous pour l’instant.</p>
        ) : (
          notes.data.map((note) => <NoteCard key={note.id} note={note} actions={<NoteActions note={note} slug={shop} canWithdraw={false} />} />)
        )}
      </section>
    </>
  );
}
