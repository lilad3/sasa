import Link from "next/link";

import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { Paginated, SecurityEvent } from "@/lib/types";

const SEVERITY: Record<SecurityEvent["severity"], { bar: string; label?: string }> = {
  info: { bar: "bg-white/25" },
  warning: { bar: "bg-ocre", label: "À surveiller" },
  critical: { bar: "bg-danger", label: "Critique" },
};

/** Les événements de sécurité du compte (90 jours). Le journal est en ajout seul : personne ne peut le retoucher. */
export function SecurityJournal({ events, slug }: { events: Paginated<SecurityEvent>; slug: string }) {
  const { results, page, pages } = events;
  const href = (target: number) => `/app/${slug}/securite${target > 1 ? `?journal=${target}` : ""}#journal`;

  return (
    <section id="journal" aria-labelledby="titre-journal" className="vitre col-span-full flex scroll-mt-4 flex-col gap-3 rounded-[24px] px-[18px] pt-4 pb-3">
      <div>
        <h2 id="titre-journal" className="text-sm text-texte-2">
          Journal de sécurité
        </h2>
        <p className="mt-1 max-w-[70ch] text-[13px] text-texte-3">
          Connexions, mots de passe, double authentification : tout ce qui touche à votre compte depuis 90 jours. Ce journal ne peut être ni modifié ni effacé, même
          par l’équipe Akwaba.
        </p>
      </div>
      {results.length === 0 ? (
        <p className="rounded-[16px] border border-dashed border-trait p-4 text-sm text-texte-3">Aucun événement sur les 90 derniers jours.</p>
      ) : (
        <ol className="flex flex-col">
          {results.map((event) => {
            const severity = SEVERITY[event.severity] ?? SEVERITY.info;
            return (
              <li key={event.id} className="grid grid-cols-[4px_1fr] gap-x-3.5 border-b border-trait-doux py-3 last:border-0 md:grid-cols-[4px_1fr_auto]">
                <span aria-hidden className={cn("row-span-2 rounded-full md:row-span-1", severity.bar)} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-x-2.5 text-sm font-semibold">
                    {event.label}
                    {severity.label ? <span className={cn("text-xs", event.severity === "critical" ? "text-danger-clair" : "text-ocre")}>{severity.label}</span> : null}
                  </p>
                  <p className="mt-0.5 truncate text-[13px] text-texte-3">
                    {event.device_label || "Appareil inconnu"} · <span className="font-mono">{event.ip || "IP inconnue"}</span>
                  </p>
                </div>
                <time dateTime={event.created_at} className="col-start-2 mt-1 text-[13px] text-texte-3 md:col-start-3 md:mt-0">
                  {formatDateTime(event.created_at)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
      {pages > 1 ? (
        <nav aria-label="Pages du journal" className="flex items-center justify-between gap-3 border-t border-trait-doux pt-3 text-sm">
          {page > 1 ? (
            <Link href={href(page - 1)} className="rounded-full bg-white/[0.06] px-4 py-2 hover:bg-white/12">
              Plus récents
            </Link>
          ) : (
            <span />
          )}
          <span className="text-texte-3">
            {page} / {pages}
          </span>
          {page < pages ? (
            <Link href={href(page + 1)} className="rounded-full bg-white/[0.06] px-4 py-2 hover:bg-white/12">
              Plus anciens
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}
