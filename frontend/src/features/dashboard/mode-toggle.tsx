"use client";

import { type ReactNode, useSyncExternalStore } from "react";

import { cn } from "@/lib/cn";

type Mode = "clair" | "sombre";

/** Le même nom que dans le script de app/layout.tsx, qui pose l'apparence avant le premier affichage. */
const COOKIE = "akwaba_mode";

// L'apparence vit sur <html data-mode> : tous les boutons de la page la suivent, même ceux d'un autre bloc.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode"] });
  return () => observer.disconnect();
}

function readMode(): Mode {
  return document.documentElement.dataset.mode === "clair" ? "clair" : "sombre";
}

function applyMode(mode: Mode) {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = `${COOKIE}=${mode}; path=/; max-age=31536000; samesite=lax${secure}`;
  const swap = () => {
    document.documentElement.dataset.mode = mode;
  };
  // Un fondu enchaîné entre les deux apparences quand le navigateur sait le faire, sinon un changement net.
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!reduced && typeof document.startViewTransition === "function") document.startViewTransition(swap);
  else swap();
}

const OPTIONS: { mode: Mode; label: string; icon: ReactNode }[] = [
  {
    mode: "clair",
    label: "Clair",
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
      </>
    ),
  },
  { mode: "sombre", label: "Sombre", icon: <path d="M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z" /> },
];

/**
 * Bouton Clair / Sombre de l'espace marchand. Le choix est gardé un an sur cet appareil (cookie).
 * `compact` masque les mots sous l'ordinateur : dans la barre du téléphone, seules les icônes restent.
 */
export function ModeToggle({ className, compact = false }: { className?: string; compact?: boolean }) {
  // Côté serveur, l'apparence n'est pas connue : aucun bouton n'est enfoncé jusqu'à l'hydratation.
  const mode = useSyncExternalStore(subscribe, readMode, () => null);
  return (
    <div role="group" aria-label="Apparence" className={cn("flex shrink-0 gap-1 rounded-full border border-trait bg-(--surface) p-1", className)}>
      {OPTIONS.map((option) => (
        <button
          key={option.mode}
          type="button"
          aria-pressed={mode === option.mode}
          onClick={() => applyMode(option.mode)}
          className="flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-texte-2 transition-colors hover:text-texte aria-pressed:bg-texte aria-pressed:text-(--fond)"
        >
          <svg viewBox="0 0 24 24" className="size-[15px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            {option.icon}
          </svg>
          <span className={cn(compact && "sr-only lg:not-sr-only")}>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
