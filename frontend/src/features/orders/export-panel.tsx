"use client";

import { useActionState, useEffect } from "react";

import { Button } from "@/components/ui/button";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { FormAlert } from "@/features/auth/form-alert";

import { type ExportState, exportOrders } from "./actions";

const initial: ExportState = {};

function isoDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Export CSV des ventes, pour Excel. Django demande de confirmer son identité avant de tout laisser sortir. */
/** `defaultOpen` : on arrive du bouton « Exporter » de la vue d'ensemble, le formulaire est déjà ouvert. */
export function ExportPanel({ slug, mfaEnabled, defaultOpen = false }: { slug: string; mfaEnabled: boolean; defaultOpen?: boolean }) {
  const [state, formAction, pending] = useActionState(exportOrders, initial);
  const today = new Date();
  const monthAgo = new Date(today.getTime() - 29 * 86_400_000);

  useEffect(() => {
    if (!state.csv || !state.filename) return;
    // Le BOM dit à Excel que le fichier est en UTF-8 (les accents restent justes).
    const url = URL.createObjectURL(new Blob(["﻿", state.csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = state.filename;
    link.click();
    URL.revokeObjectURL(url);
  }, [state]);

  return (
    // Un bouton dans l'en-tête de la liste ; le formulaire s'ouvre dessous, par-dessus la page.
    <details className="group relative" open={state.reauth || defaultOpen || undefined}>
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-white/15 bg-encre/45 px-4 py-2.5 text-sm font-semibold text-texte-2 hover:text-texte group-open:text-texte [&::-webkit-details-marker]:hidden">
        <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14" />
        </svg>
        Exporter
        <svg viewBox="0 0 24 24" className="size-3.5 text-texte-3 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </summary>
      <form
        action={formAction}
        noValidate
        className="absolute top-[calc(100%+8px)] left-0 z-20 flex w-[min(460px,calc(100vw-24px))] flex-col gap-4 rounded-[20px] border border-trait bg-nuit-2/95 p-[18px] shadow-[0_18px_40px_rgb(0_0_0/0.5)] backdrop-blur-xl sm:right-0 sm:left-auto"
      >
        <p className="text-sm">
          <span className="font-semibold">Exporter les ventes</span>
          <span className="text-texte-3"> · fichier CSV pour Excel</span>
        </p>
        <input type="hidden" name="slug" value={slug} />
        {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
        {state.csv && !pending ? <FormAlert tone="success">Export prêt : le téléchargement a commencé. Il est noté dans le journal de sécurité.</FormAlert> : null}
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-texte-2">
            Du
            <input type="date" name="from" defaultValue={isoDay(monthAgo)} max={isoDay(today)} className="rounded-champ border border-white/15 bg-encre/45 px-3 py-2.5 text-sm text-texte [color-scheme:dark]" />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-texte-2">
            Au
            <input type="date" name="to" defaultValue={isoDay(today)} max={isoDay(today)} className="rounded-champ border border-white/15 bg-encre/45 px-3 py-2.5 text-sm text-texte [color-scheme:dark]" />
          </label>
          <p className="max-w-[44ch] text-xs text-texte-3">Un an au maximum. Le fichier contient les noms et téléphones des clients : gardez-le pour vous.</p>
        </div>
        {state.reauth ? <ReauthFields mfaEnabled={mfaEnabled} what="exporter les ventes" error={state.reauthError} /> : null}
        <Button type="submit" pending={pending} pendingLabel="Préparation…" className="self-start px-5 py-2.5 text-sm">
          {state.reauth ? "Confirmer et télécharger" : "Télécharger le CSV"}
        </Button>
      </form>
    </details>
  );
}
