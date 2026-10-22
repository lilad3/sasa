"use client";

import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";

export type MonthTab = { id: string; label: string; hint: string; content: ReactNode };

/**
 * Onglets sous le grand panneau. Le contenu vient du serveur, déjà calculé ; ici, on ne fait que
 * choisir l'onglet affiché. Le trait orange glisse d'un onglet à l'autre, le contenu arrive en fondu.
 * Flèches gauche et droite pour changer d'onglet au clavier (motif « tabs » de l'ARIA).
 */
export function MonthTabs({ tabs }: { tabs: MonthTab[] }) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const place = () => {
      const button = list.querySelectorAll<HTMLElement>('[role="tab"]')[active];
      if (button) setBar({ left: button.offsetLeft, width: button.offsetWidth });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active]);

  function onKeyDown(event: KeyboardEvent) {
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (active + moves[event.key] + tabs.length) % tabs.length;
    setActive(next);
    listRef.current?.querySelectorAll<HTMLElement>('[role="tab"]')[next]?.focus();
  }

  return (
    <div className="flex flex-col gap-3">
      <div ref={listRef} role="tablist" aria-label="Détail du mois" onKeyDown={onKeyDown} className="relative grid grid-cols-2 border-b border-trait md:grid-cols-4">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            id={`onglet-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={index === active}
            aria-controls={`panneau-${tab.id}`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setActive(index)}
            className="group flex flex-col items-start gap-0.5 px-1 pt-1 pb-3 text-left md:px-1.5"
          >
            <span className={cn("text-[15px] font-semibold transition-colors", index === active ? "text-texte" : "text-texte-2 group-hover:text-texte")}>{tab.label}</span>
            <span className="text-[12.5px] text-texte-3">{tab.hint}</span>
          </button>
        ))}
        <span
          aria-hidden
          className="absolute -bottom-px h-[2px] rounded-full bg-orange shadow-[0_0_12px_rgb(255_122_31/0.8)] transition-[left,width] duration-500 ease-[cubic-bezier(0.3,0.7,0.2,1)]"
          style={{ left: bar.left, width: bar.width }}
        />
      </div>
      {tabs.map((tab, index) => (
        <div key={tab.id} id={`panneau-${tab.id}`} role="tabpanel" aria-labelledby={`onglet-${tab.id}`} hidden={index !== active} className="fondu-panneau">
          {tab.content}
        </div>
      ))}
    </div>
  );
}
