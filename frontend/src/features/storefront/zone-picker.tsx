"use client";

import { type KeyboardEvent, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import type { DeliveryZone } from "@/lib/types";

/** « Port-Bouët » se trouve en tapant « port bouet » : sans accents, sans tirets, sans majuscules. */
function normalize(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[-'’]/g, " ").toLowerCase().trim();
}

type ZonePickerProps = {
  id: string;
  zones: DeliveryZone[];
  value: string;
  onChange: (zoneId: string) => void;
  className: string;
  invalid?: boolean;
  describedBy?: string;
};

/**
 * Choix de la commune livrée, à la place du <select> natif (sa liste, dessinée par le système,
 * sortait grise et carrée sur la vitrine orange). Motif « combobox » de l'ARIA : on tape pour filtrer,
 * flèches haut et bas pour parcourir, Entrée pour choisir, Échap pour fermer. Les frais s'affichent à côté.
 */
export function ZonePicker({ id, zones, value, onChange, className, invalid, describedBy }: ZonePickerProps) {
  const listId = useId();
  const selected = zones.find((zone) => zone.id === value) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const list = useRef<HTMLUListElement>(null);

  const shown = useMemo(() => {
    const wanted = normalize(query ?? "");
    return wanted ? zones.filter((zone) => normalize(zone.label).includes(wanted)) : zones;
  }, [query, zones]);

  function show(index: number) {
    setOpen(true);
    setActive(index);
    // L'option active reste visible quand on parcourt une longue liste au clavier.
    requestAnimationFrame(() => list.current?.children[index]?.scrollIntoView({ block: "nearest" }));
  }

  function choose(zone: DeliveryZone) {
    onChange(zone.id);
    setQuery(null);
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      show(open ? Math.min(active + 1, shown.length - 1) : Math.max(0, shown.findIndex((zone) => zone.id === value)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      show(Math.max(active - 1, 0));
    } else if (event.key === "Enter" && open) {
      // Entrée choisit la commune au lieu d'envoyer la commande.
      event.preventDefault();
      if (shown[active]) choose(shown[active]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
      setQuery(null);
    }
  }

  const activeId = open && shown[active] ? `${listId}-${active}` : undefined;

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        placeholder="Tapez votre commune, ou choisissez"
        value={query ?? selected?.label ?? ""}
        onChange={(event) => {
          setQuery(event.target.value);
          show(0);
        }}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        // Sortie du champ sans choix : on revient à la commune déjà choisie.
        onBlur={() => {
          setOpen(false);
          setQuery(null);
        }}
        onKeyDown={onKeyDown}
        className={cn(className, "pr-28")}
      />
      <span aria-hidden className="pointer-events-none absolute top-1/2 right-4 flex -translate-y-1/2 items-center gap-2 text-[13px] text-encre-doux">
        {selected && query === null ? formatFcfa(selected.fee) : null}
        <svg viewBox="0 0 24 24" className={cn("size-4 transition-transform", open && "rotate-180")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
      {open ? (
        <ul
          ref={list}
          id={listId}
          role="listbox"
          aria-label="Communes et villes livrées"
          className="absolute inset-x-0 top-[calc(100%+6px)] z-20 max-h-[264px] overflow-y-auto rounded-[18px] border border-encre/20 bg-[rgb(246_211_177/0.98)] p-1.5 shadow-[0_18px_40px_rgb(60_30_10/0.28)]"
        >
          {shown.length === 0 ? (
            <li className="px-3 py-2.5 text-[13.5px] text-encre-doux">Nous ne livrons pas encore cette zone. Essayez la commune ou la ville la plus proche.</li>
          ) : (
            shown.map((zone, index) => (
              <li
                key={zone.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={zone.id === value}
                // mousedown plutôt que click : le champ garde le focus, la liste ne se ferme pas avant le choix.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(zone);
                }}
                onMouseMove={() => setActive(index)}
                className={cn(
                  "flex cursor-pointer items-center justify-between gap-3 rounded-[12px] px-3 py-2.5 text-[14.5px] text-encre",
                  index === active && "bg-encre/10",
                  zone.id === value && "font-semibold",
                )}
              >
                <span className="flex items-center gap-2">
                  <span aria-hidden className={cn("size-1.5 rounded-full", zone.id === value ? "bg-indigo" : "bg-transparent")} />
                  {zone.label}
                </span>
                <span className="text-[13px] whitespace-nowrap text-encre-doux">livraison {formatFcfa(zone.fee)} · sous {zone.delay_hours} h</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
