"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { cn } from "@/lib/cn";
import { formatSince } from "@/lib/format";

// Les chiffres se rafraîchissent seuls tant que la page est affichée : une commande passée en vitrine
// apparaît sans que le marchand ait à recharger.
const AUTO_REFRESH_MS = 60_000;

/** « Mise à jour il y a 2 min » : le texte avance avec le temps, et la page se rafraîchit toute seule. */
export function LiveStamp({ generatedAt }: { generatedAt: string }) {
  const router = useRouter();
  // Point de départ commun au serveur et au navigateur (l'heure du calcul) : sinon le texte rendu
  // côté serveur et le premier rendu du navigateur différeraient, et React le signalerait.
  const [now, setNow] = useState(() => Date.parse(generatedAt));

  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    const tick = window.setInterval(() => setNow(Date.now()), 15_000);
    const refresh = window.setInterval(() => {
      if (!document.hidden) router.refresh();
    }, AUTO_REFRESH_MS);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(tick);
      window.clearInterval(refresh);
    };
  }, [router]);

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-white/12 bg-encre/40 px-3 py-1.5 text-[12.5px] text-texte-2">
      <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 7.5V12l3 2" />
      </svg>
      {/* La clé relance le fondu à chaque mise à jour : on voit que les chiffres viennent d'arriver. */}
      <span key={generatedAt} className="fondu-texte">
        Mise à jour {formatSince(generatedAt, now)}
      </span>
    </span>
  );
}

/** Bouton rond « actualiser » : la flèche tourne pendant le rafraîchissement. */
export function RefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      onClick={() => startTransition(() => router.refresh())}
      aria-label="Actualiser les chiffres"
      aria-busy={pending}
      className="bouton-rond grid size-11 place-items-center rounded-full"
    >
      <svg viewBox="0 0 24 24" className={cn("size-[18px]", pending && "animate-spin")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M19 12a7 7 0 1 1-2.05-4.95" />
        <path d="M19 4.5V8h-3.5" />
      </svg>
    </button>
  );
}
