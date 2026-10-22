import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { formatDateTime, formatSince, ROLE_LABEL } from "@/lib/format";
import type { TeamNote } from "@/lib/types";

/** L'épingle du mot du patron, dessinée pour Akwaba. */
export function PinIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M9 3.5h6M10 3.5v5L7 11.5h10L14 8.5v-5M12 11.5V20" />
    </svg>
  );
}

/**
 * Une note épinglée : la consigne en grand, signée, avec la cible et l'heure.
 * Urgente, elle prend la lueur ocre (l'alerte de la palette) ; sinon, le sable discret.
 */
export function NoteCard({ note, actions, footer, className }: { note: TeamNote; actions?: ReactNode; footer?: ReactNode; className?: string }) {
  return (
    <article
      className={cn(
        "relative flex flex-col gap-3.5 overflow-hidden rounded-[22px] border p-[18px] md:p-5",
        note.urgent
          ? "border-ocre/45 bg-[radial-gradient(80%_120%_at_0%_0%,rgb(242_179_61/0.2),transparent_60%),linear-gradient(170deg,rgb(40_31_22/0.94),rgb(20_16_12/0.95))]"
          : "border-sable/20 bg-[radial-gradient(80%_120%_at_0%_0%,rgb(240_221_186/0.1),transparent_60%),linear-gradient(170deg,rgb(34_28_23/0.92),rgb(18_15_12/0.94))]",
        note.withdrawn && "opacity-55",
        className,
      )}
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className={cn("grid size-8 place-items-center rounded-full border", note.urgent ? "border-ocre/50 text-ocre" : "border-sable/30 text-sable")}>
          <PinIcon className="size-4" />
        </span>
        {/* Le message automatique de l'objectif du mois se distingue des messages écrits. */}
        <span className="large text-[12px] font-bold tracking-[0.08em] uppercase">{note.kind === "goal" ? "Objectif du mois" : "Message"}</span>
        {note.urgent ? <span className="rounded-full bg-ocre px-2.5 py-0.5 text-[11.5px] font-bold text-encre">Urgent</span> : null}
        {note.withdrawn ? <span className="text-xs text-texte-3">Retiré</span> : null}
        <span className="ml-auto text-xs text-texte-3">Pour {note.audience.type === "member" ? note.audience.label : note.audience.label.toLowerCase()}</span>
      </header>

      <p className="max-w-[70ch] text-[clamp(16px,1.5vw,18.5px)] leading-relaxed font-medium whitespace-pre-line">« {note.body} »</p>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-[13px] text-texte-2">
          — {note.author.is_you ? "Vous" : note.author.name}, {ROLE_LABEL[note.author.role].toLowerCase()} ·{" "}
          <time dateTime={note.created_at} title={formatDateTime(note.created_at)}>
            {formatSince(note.created_at)}
          </time>
        </p>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {footer}
    </article>
  );
}
