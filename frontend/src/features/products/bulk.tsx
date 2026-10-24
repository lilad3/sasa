"use client";

import { type FormEvent, startTransition, useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";

import { type BulkState, bulkUpdate } from "./bulk-actions";
import { Sheet } from "./sheet";

export const MAX_SELECTED = 100;
const initial: BulkState = {};

/** Ce qu'on retient d'un produit coché : de quoi écrire la confirmation, sans le re-demander au serveur. */
export type Picked = Record<string, { name: string; price: number }>;

type Kind = "price" | "stock" | "status" | "tag_add" | "tag_remove";

const CHOICES: { kind: Kind; label: string }[] = [
  { kind: "price", label: "Modifier les prix" },
  { kind: "stock", label: "Modifier le stock" },
  { kind: "status", label: "Changer le statut" },
  { kind: "tag_add", label: "Ajouter une étiquette" },
  { kind: "tag_remove", label: "Retirer une étiquette" },
];

const REASONS = [
  { value: "received", label: "Réception", sign: "+" },
  { value: "returned", label: "Retour", sign: "+" },
  { value: "damaged", label: "Casse", sign: "-" },
  { value: "correction", label: "Correction", sign: "±" },
] as const;

/** Le bandeau fixé en bas de l'écran, à portée du pouce : le décompte, puis « Choisir une action ». */
export function BulkBar({ count, onChoose, onAll, onCancel, allCount }: { count: number; onChoose: () => void; onAll: () => void; onCancel: () => void; allCount: number }) {
  return (
    <div
      role="region"
      aria-label="Sélection de produits"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-30 border-t border-trait bg-nuit-2/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-2">
        <p className="text-sm tabular-nums">
          <span className="font-semibold">{count === 0 ? "Rien de sélectionné" : `${count} sélectionné${count > 1 ? "s" : ""}`}</span>
          {count >= MAX_SELECTED ? <span className="text-texte-3"> · 100 sur 100 : 100 produits au plus à la fois</span> : null}
        </p>
        <button type="button" onClick={onAll} className="min-h-11 rounded-full px-3 text-sm text-texte-2 hover:text-texte">
          Tout sélectionner ({allCount})
        </button>
        <button type="button" onClick={onCancel} className="min-h-11 rounded-full px-3 text-sm text-texte-2 hover:text-texte">
          Annuler
        </button>
        <Button type="button" onClick={onChoose} disabled={count === 0} className="ml-auto min-h-12 px-6">
          Choisir une action
        </Button>
      </div>
    </div>
  );
}

/** La feuille d'actions : cinq choix en grosses lignes, le mini-formulaire du choix, puis une confirmation avant l'envoi. */
export function BulkSheet({
  open, onClose, slug, picked, mfaEnabled, suggestions, onDone,
}: { open: boolean; onClose: () => void; slug: string; picked: Picked; mfaEnabled: boolean; suggestions: string[]; onDone: (count: number) => void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Modifier en masse">
      <BulkForm slug={slug} picked={picked} mfaEnabled={mfaEnabled} suggestions={suggestions} onDone={onDone} />
    </Sheet>
  );
}

function BulkForm({ slug, picked, mfaEnabled, suggestions, onDone }: { slug: string; picked: Picked; mfaEnabled: boolean; suggestions: string[]; onDone: (count: number) => void }) {
  const [state, formAction, pending] = useActionState(bulkUpdate, initial);
  const [kind, setKind] = useState<Kind | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [mode, setMode] = useState("percent");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState("draft");
  const [label, setLabel] = useState("");
  const ids = Object.keys(picked);
  const names = ids.map((id) => picked[id].name);

  useEffect(() => {
    if (state.done !== undefined) onDone(state.done);
  }, [state.done, onDone]);

  const first = picked[ids[0]];
  const typed = /^-?\d+$/.test(value.replace(/\s/g, "")) ? Number(value.replace(/\s/g, "")) : null;
  const nextPrice = first && typed !== null && kind === "price" ? (mode === "set" ? typed : Math.max(5, Math.round((first.price * (100 + typed)) / 100 / 5) * 5)) : null;

  function valid() {
    if (kind === "price") return typed !== null && (mode === "set" ? typed >= 1 : typed !== 0 && typed >= -90 && typed <= 100);
    if (kind === "stock") return typed !== null && (mode === "set" ? typed >= 0 && reason === "correction" : typed !== 0 && reason !== "");
    if (kind === "tag_add" || kind === "tag_remove") return label.trim().length > 0;
    return kind === "status";
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirming) {
      if (valid()) setConfirming(true);
      return;
    }
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  const failed = state.failed ?? [];
  const reauthNeeded = state.reauth === true;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="type" value={kind ?? ""} />
      {ids.map((id) => (
        <input key={id} type="hidden" name="ids" value={id} />
      ))}
      {kind === "price" || kind === "stock" ? <input type="hidden" name="mode" value={mode} /> : null}
      {kind === "price" || kind === "stock" ? <input type="hidden" name="value" value={value} /> : null}
      {kind === "stock" ? <input type="hidden" name="reason" value={reason} /> : null}
      {kind === "status" ? <input type="hidden" name="status" value={status} /> : null}
      {kind === "tag_add" || kind === "tag_remove" ? <input type="hidden" name="label" value={label} /> : null}

      {state.error && failed.length === 0 ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      {failed.length > 0 ? (
        <div role="alert" className="flex flex-col gap-2 rounded-[16px] border border-ocre/35 bg-ocre/10 p-3.5 text-sm">
          <p className="font-semibold">Rien n’a été modifié.</p>
          <ul className="flex flex-col gap-1">
            {failed.map((entry) => (
              <li key={entry.product_id}>
                <span className="font-semibold">{picked[entry.product_id]?.name ?? entry.sku}</span> : {entry.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {kind === null ? (
        <ul className="flex flex-col gap-2">
          {CHOICES.map((choice) => (
            <li key={choice.kind}>
              <button type="button" onClick={() => setKind(choice.kind)} className="flex min-h-14 w-full items-center justify-between rounded-[16px] border border-trait bg-encre/40 px-4 text-left text-base font-semibold hover:bg-white/10">
                {choice.label}
                <span aria-hidden className="text-texte-3">
                  ›
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : confirming ? (
        <div className="flex flex-col gap-3">
          <p className="text-lg font-medium">
            Modifier {ids.length} produit{ids.length > 1 ? "s" : ""} ?
          </p>
          <p className="text-sm text-texte-2">
            {names.slice(0, 3).join(", ")}
            {ids.length > 3 ? ` et ${ids.length - 3} autre${ids.length - 3 > 1 ? "s" : ""}` : ""}
          </p>
          <p className="text-sm text-texte-3">Tout est modifié ou rien ne l’est.</p>
          {kind === "status" && status === "archived" ? <p className="text-sm text-texte-2">Les commandes passées sont conservées.</p> : null}
          {reauthNeeded ? <ReauthFields mfaEnabled={mfaEnabled} what="baisser ces prix" error={state.reauthError} /> : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" pending={pending} pendingLabel="Modification…" className="min-h-12 px-7">
              Modifier {ids.length} produit{ids.length > 1 ? "s" : ""}
            </Button>
            <button type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-full px-4 text-sm text-texte-2 hover:text-texte">
              Retour
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <button type="button" onClick={() => setKind(null)} className="self-start text-sm text-texte-2 hover:text-texte">
            ← Autre action
          </button>
          {kind === "price" ? (
            <>
              <Choice name="mode_choice" value={mode} onChange={setMode} options={[["percent", "En pourcentage"], ["set", "En valeur"]]} legend="Comment ?" />
              <Field id="valeur" label={mode === "percent" ? "Pourcentage (−90 à +100)" : "Nouveau prix commun (F CFA)"} value={value} onChange={(event) => setValue(event.target.value)} inputMode="numeric" hint={mode === "percent" ? "Un nombre négatif baisse les prix. Arrondi à 5 F près." : undefined} />
              {nextPrice !== null && first ? (
                <p aria-live="polite" className="text-sm tabular-nums">
                  {first.name} : {formatFcfa(first.price)} → <span className={cn("font-semibold", nextPrice < first.price && "text-alerte")}>{formatFcfa(nextPrice)}</span>
                </p>
              ) : null}
            </>
          ) : null}
          {kind === "stock" ? (
            <>
              <Choice name="mode_choice" value={mode} onChange={(next) => { setMode(next); setReason(next === "set" ? "correction" : ""); }} options={[["add", "Ajouter ou retirer"], ["set", "Fixer à"]]} legend="Comment ?" />
              <Field id="quantite-masse" label={mode === "add" ? "Quantité (négative pour retirer)" : "Nouveau stock"} value={value} onChange={(event) => setValue(event.target.value)} inputMode="numeric" />
              <fieldset className="flex flex-col gap-2">
                <legend className="pb-1 text-[13px] font-semibold text-texte-2">Pourquoi ? (obligatoire)</legend>
                <div className="grid grid-cols-2 gap-2">
                  {REASONS.map((entry) => {
                    const ok = mode === "set" ? entry.value === "correction" : typed === null || typed === 0 || entry.sign === "±" || (entry.sign === "+" ? typed > 0 : typed < 0);
                    return (
                      <label key={entry.value} className={cn("flex min-h-12 cursor-pointer items-center gap-2 rounded-[14px] border px-3 py-2 text-sm font-semibold", reason === entry.value ? "border-orange/60 bg-orange/10" : "border-trait-doux bg-encre/30", !ok && "cursor-not-allowed opacity-45")}>
                        <input type="radio" name="reason_choice" value={entry.value} checked={reason === entry.value} disabled={!ok} onChange={() => setReason(entry.value)} className="size-4 accent-orange" />
                        {entry.label}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </>
          ) : null}
          {kind === "status" ? (
            <Choice name="statut_choice" value={status} onChange={setStatus} legend="Nouveau statut" options={[["draft", "Brouillon"], ["active", "Actif"], ["archived", "Archivé"]]} />
          ) : null}
          {kind === "tag_add" || kind === "tag_remove" ? (
            <>
              <Field id="etiquette-masse" label="Étiquette" value={label} onChange={(event) => setLabel(event.target.value)} maxLength={30} list="etiquettes-masse" />
              <datalist id="etiquettes-masse">
                {suggestions.map((entry) => (
                  <option key={entry} value={entry} />
                ))}
              </datalist>
            </>
          ) : null}
          <Button type="submit" disabled={!valid()} className="min-h-12">
            Continuer
          </Button>
        </div>
      )}
    </form>
  );
}

function Choice({ name, value, onChange, options, legend }: { name: string; value: string; onChange: (next: string) => void; options: [string, string][]; legend: string }) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 text-[13px] font-semibold text-texte-2">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map(([optionValue, text]) => (
          <label key={optionValue} className={cn("flex min-h-12 cursor-pointer items-center gap-2 rounded-[14px] border px-3 py-2 text-sm font-semibold", value === optionValue ? "border-orange/60 bg-orange/10" : "border-trait-doux bg-encre/30")}>
            <input type="radio" name={name} value={optionValue} checked={value === optionValue} onChange={() => onChange(optionValue)} className="size-4 accent-orange" />
            {text}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
