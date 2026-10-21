import Link from "next/link";

import { SubmitButton } from "@/components/ui/submit-button";
import { getUnreadTeamNotes } from "@/lib/server/session";

import { acknowledgeNote } from "./actions";
import { HideOnMessages } from "./hide-on-messages";
import { NoteCard } from "./note-card";

/**
 * En haut de chaque page de l'espace marchand : la consigne non lue la plus importante,
 * jusqu'à ce que la personne clique « C'est noté ». Rien quand tout est lu.
 */
export async function NotesBanner({ slug }: { slug: string }) {
  const unread = await getUnreadTeamNotes(slug);
  if (!unread.ok || unread.data.length === 0) return null;
  const [note, ...others] = unread.data;

  return (
    <HideOnMessages>
      <section aria-label="Message de la boutique à lire" className="col-span-full flex flex-col gap-2">
        <NoteCard
          note={note}
          actions={
            <form action={acknowledgeNote}>
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="note" value={note.id} />
              <SubmitButton pendingLabel="Enregistrement…" className="px-5 py-2.5 text-sm">
                C’est noté
              </SubmitButton>
            </form>
          }
        />
        {others.length > 0 ? (
          <Link
            href={`/app/${slug}/messages`}
            className="self-start px-2 text-[13px] font-semibold text-sable underline decoration-sable/40 underline-offset-[3px] hover:decoration-sable"
          >
            {others.length === 1 ? "Un autre message à lire" : `${others.length} autres messages à lire`}
          </Link>
        ) : null}
      </section>
    </HideOnMessages>
  );
}

export async function NotesBannerFromRoute({ params }: { params: Promise<{ shop: string }> }) {
  const { shop } = await params;
  return <NotesBanner slug={shop} />;
}
