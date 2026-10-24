"use client";

import { type ChangeEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import type { ShopZone } from "@/lib/types";

export type ZoneDraft = { fee: string; delay: string; active: boolean };

const BOX =
  "w-full rounded-champ border border-white/15 bg-encre/45 px-3 py-2 text-base text-texte tabular-nums outline-none transition-[border-color,box-shadow] focus-visible:border-orange focus-visible:shadow-[0_0_0_3px_rgb(255_122_31/0.28)] aria-invalid:border-danger";

type RowProps = {
  zone: ShopZone;
  draft: ZoneDraft;
  onDraft: (patch: Partial<ZoneDraft>) => void;
  /** Le nom affiché : la commune, ou la ville quand la zone n'a pas de commune. */
  name: string;
  feeError?: string;
  delayError?: string;
  busy: boolean;
  onMove: (direction: -1 | 1) => void;
  canUp: boolean;
  canDown: boolean;
  onDelete: () => void;
  limits: { fee_max: number; delay_min: number; delay_max: number };
};

/** Une zone : frais, délai, interrupteur « Active », ordre, suppression en deux temps (seulement si elle n'a jamais servi). */
export function ZoneRow({ zone, draft, onDraft, name, feeError, delayError, busy, onMove, canUp, canDown, onDelete, limits }: RowProps) {
  const [confirming, setConfirming] = useState(false);
  const id = `zone-${zone.id.replace(/[^a-z0-9]/gi, "-")}`;
  const digits = (key: "fee" | "delay") => (event: ChangeEvent<HTMLInputElement>) => onDraft({ [key]: event.target.value });

  return (
    <li className={cn("flex flex-col gap-3 border-b border-trait-doux py-3.5 last:border-0", !draft.active && "text-texte-3")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[15px] font-semibold">
          {name}
          {!draft.active ? <span className="ml-2 rounded-full border border-sable/30 px-2 py-0.5 text-[11.5px] font-semibold text-texte-3">Inactive</span> : null}
        </p>
        <Switch
          checked={draft.active}
          onChange={(event) => onDraft({ active: event.target.checked })}
          label={`Active`}
          aria-label={`Active : ${name}`}
          className="text-[13.5px]"
        />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-[420px]">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-frais`} className="text-[12.5px] font-semibold text-texte-2">
            Frais (F)<span className="sr-only"> : {name}</span>
          </label>
          <input
            id={`${id}-frais`}
            className={BOX}
            inputMode="numeric"
            autoComplete="off"
            maxLength={7}
            value={draft.fee}
            onChange={digits("fee")}
            aria-invalid={feeError ? true : undefined}
            aria-describedby={feeError ? `${id}-frais-erreur` : `${id}-frais-aide`}
          />
          {feeError ? (
            <p id={`${id}-frais-erreur`} className="text-[12.5px] text-danger-clair">
              {feeError}
            </p>
          ) : (
            <p id={`${id}-frais-aide`} className="text-[12px] text-texte-3">
              0 à {formatFcfa(limits.fee_max)}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-delai`} className="text-[12.5px] font-semibold text-texte-2">
            Délai (h)<span className="sr-only"> : {name}</span>
          </label>
          <input
            id={`${id}-delai`}
            className={BOX}
            inputMode="numeric"
            autoComplete="off"
            maxLength={3}
            value={draft.delay}
            onChange={digits("delay")}
            aria-invalid={delayError ? true : undefined}
            aria-describedby={delayError ? `${id}-delai-erreur` : `${id}-delai-aide`}
          />
          {delayError ? (
            <p id={`${id}-delai-erreur`} className="text-[12.5px] text-danger-clair">
              {delayError}
            </p>
          ) : (
            <p id={`${id}-delai-aide`} className="text-[12px] text-texte-3">
              {limits.delay_min} à {limits.delay_max} h
            </p>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="ghost" disabled={!canUp || busy} onClick={() => onMove(-1)} aria-label={`Monter ${name}`} className="px-3.5 py-1.5 text-[13px]">
          Monter
        </Button>
        <Button type="button" variant="ghost" disabled={!canDown || busy} onClick={() => onMove(1)} aria-label={`Descendre ${name}`} className="px-3.5 py-1.5 text-[13px]">
          Descendre
        </Button>
        {zone.used ? (
          <span className="text-[12.5px] text-texte-3">A déjà servi : désactivez-la plutôt</span>
        ) : confirming ? (
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-texte">Supprimer {name} ?</span>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setConfirming(false);
                onDelete();
              }}
              className="border-danger/50 px-3.5 py-1.5 text-[13px] text-danger-clair"
            >
              Oui, supprimer
            </Button>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} className="px-3.5 py-1.5 text-[13px]">
              Annuler
            </Button>
          </span>
        ) : (
          <Button type="button" variant="ghost" disabled={busy} onClick={() => setConfirming(true)} aria-label={`Supprimer ${name}`} className="px-3.5 py-1.5 text-[13px]">
            Supprimer
          </Button>
        )}
      </div>
    </li>
  );
}
