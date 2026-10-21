import { SubmitButton } from "@/components/ui/submit-button";
import { formatDateTime, formatSince } from "@/lib/format";
import type { Session } from "@/lib/types";

import { revokeOtherSessions, revokeSession } from "./actions";

const MOBILE = /android|iphone|ipad|ios|mobile/i;

function DeviceIcon({ label }: { label: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-texte-2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {MOBILE.test(label) ? (
        <path d="M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3zM11 18h2" />
      ) : (
        <path d="M4.5 5.5h15v10h-15zM2.5 18.5h19M10 15.5l-.5 3M14 15.5l.5 3" />
      )}
    </svg>
  );
}

/** Les appareils où le compte est ouvert. Fermer une session déconnecte l'appareil tout de suite (côté Django). */
export function SessionList({ sessions }: { sessions: Session[] }) {
  const others = sessions.filter((session) => !session.current).length;

  return (
    <section aria-labelledby="titre-sessions" className="vitre col-span-full flex flex-col gap-3 rounded-[24px] px-[18px] pt-4 pb-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="titre-sessions" className="text-sm text-texte-2">
            Appareils connectés
          </h2>
          <p className="mt-1 max-w-[60ch] text-[13px] text-texte-3">Un appareil que vous ne reconnaissez pas ? Fermez sa session : il est déconnecté sur-le-champ.</p>
        </div>
        {others > 0 ? (
          <form action={revokeOtherSessions}>
            <SubmitButton variant="ghost" pendingLabel="Déconnexion…" className="px-4 py-2 text-sm">
              Déconnecter les {others > 1 ? `${others} autres appareils` : "autre appareil"}
            </SubmitButton>
          </form>
        ) : null}
      </div>
      <ul className="flex flex-col">
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-trait-doux py-3 last:border-0">
            <DeviceIcon label={session.device_label} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm font-semibold">
                {session.device_label || "Appareil inconnu"}
                {session.current ? <span className="text-xs font-semibold text-orange-clair">Cet appareil</span> : null}
                {session.shared_device ? <span className="text-xs font-semibold text-ocre">Appareil partagé</span> : null}
              </p>
              <p className="mt-0.5 text-[13px] text-texte-3">
                <span className="font-mono">{session.ip || "IP inconnue"}</span> · ouverte le {formatDateTime(session.created_at)} · active{" "}
                {formatSince(session.last_seen_at)}
              </p>
            </div>
            {session.current ? null : (
              <form action={revokeSession}>
                <input type="hidden" name="session" value={session.id} />
                <SubmitButton variant="ghost" pendingLabel="Fermeture…" className="px-4 py-2 text-sm">
                  Fermer<span className="sr-only"> la session {session.device_label}</span>
                </SubmitButton>
              </form>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
