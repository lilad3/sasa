"use client";

import { useActionState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { FormAlert } from "@/features/auth/form-alert";

import { type CustomerExportState, exportCustomers } from "./actions";

const initial: CustomerExportState = {};

const SEGMENTS = [
  { value: "all", label: "Tous les clients" },
  { value: "loyal", label: "Les fidèles" },
  { value: "new", label: "Les nouveaux (30 jours)" },
  { value: "win_back", label: "À relancer" },
  { value: "at_risk", label: "À risque" },
] as const;

/**
 * Export CSV des clients pour Excel (docs/chantier-p5.md §4.1). Les téléphones sortent en clair :
 * Django demande de confirmer son identité et note l'export dans le journal de sécurité.
 */
export function CustomerExportPanel({ slug, mfaEnabled, segment }: { slug: string; mfaEnabled: boolean; segment: string }) {
  const [state, formAction, pending] = useActionState(exportCustomers, initial);

  useEffect(() => {
    if (!state.csv || !state.filename) return;
    // Le BOM dit à Excel que le fichier est en UTF-8 (les accents restent justes) ; la lecture du texte l'a retiré.
    const url = URL.createObjectURL(new Blob(["\ufeff", state.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = state.filename;
    link.click();
    URL.revokeObjectURL(url);
  }, [state]);

  return (
    <details className="group relative" open={state.reauth || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-white/15 bg-encre/45 px-4 py-2.5 text-sm font-semibold text-texte-2 hover:text-texte group-open:text-texte [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
        </svg>
        Exporter
      </summary>
      <form
        action={formAction}
        noValidate
        className="absolute top-[calc(100%+8px)] right-0 z-20 flex w-[min(420px,calc(100vw-24px))] flex-col gap-4 rounded-[20px] border border-trait bg-nuit-2/95 p-[18px] shadow-[0_18px_40px_rgb(0_0_0/0.5)] backdrop-blur-xl"
      >
        <p className="text-sm">
          <span className="font-semibold">Exporter les clients</span>
          <span className="text-texte-3"> · fichier CSV pour Excel</span>
        </p>
        <input type="hidden" name="slug" value={slug} />
        {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
        {state.csv && !pending ? <FormAlert tone="success">Export prêt : le téléchargement a commencé. Il est noté dans le journal de sécurité.</FormAlert> : null}
        <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-texte-2">
          Quels clients
          <select
            name="segment"
            defaultValue={SEGMENTS.some((s) => s.value === segment) ? segment : "all"}
            className="rounded-champ border border-white/15 bg-encre/45 px-3 py-2.5 text-sm text-texte [color-scheme:dark]"
          >
            {SEGMENTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-texte-3">Le fichier contient les noms et les numéros complets : gardez-le pour la boutique, ne le partagez pas.</p>
        {state.reauth ? <ReauthFields mfaEnabled={mfaEnabled} what="exporter les clients" error={state.reauthError} /> : null}
        <Button type="submit" pending={pending} pendingLabel="Préparation…" className="self-start px-5 py-2.5 text-sm">
          {state.reauth ? "Confirmer et télécharger" : "Télécharger le CSV"}
        </Button>
      </form>
    </details>
  );
}
