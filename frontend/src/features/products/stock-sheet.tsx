"use client";

import Link from "next/link";
import { type FormEvent, startTransition, useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber } from "@/lib/format";

import { adjustStock, moreMovements, type StockState } from "./product-actions";
import { Sheet } from "./sheet";
import type { StockMovement } from "./types";

const initial: StockState = {};

const REASONS = [
  { value: "received", label: "Réception", sign: "+" },
  { value: "returned", label: "Retour client", sign: "+" },
  { value: "damaged", label: "Casse ou perte", sign: "-" },
  { value: "correction", label: "Correction", sign: "±" },
] as const;

const SHORTCUTS = [1, 5, 10, -1, -5];

/** « Ajuster le stock » : le stock, un aperçu en direct, une raison obligatoire (jamais présélectionnée) et une note. */
export function StockAdjust({ slug, productId, productName, stock, label = "Ajuster le stock" }: { slug: string; productId: string; productName: string; stock: number; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-full border border-sable/25 bg-white/[0.04] px-5 py-2.5 text-sm font-bold hover:bg-white/10">
        {label}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Ajuster le stock">
        <AdjustForm slug={slug} productId={productId} productName={productName} stock={stock} onDone={() => setOpen(false)} />
      </Sheet>
    </>
  );
}

function AdjustForm({ slug, productId, productName, stock, onDone }: { slug: string; productId: string; productName: string; stock: number; onDone: () => void }) {
  const [state, formAction, pending] = useActionState(adjustStock, initial);
  const [mode, setMode] = useState<"add" | "count">("add");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (state.done) onDone();
  }, [state.done, onDone]);

  const typed = /^-?\d+$/.test(quantity.trim()) ? Number(quantity.trim()) : null;
  const result = typed === null ? null : mode === "count" ? typed : stock + typed;
  const below = result !== null && result < 0;
  const delta = result === null ? 0 : result - stock;
  const sign = REASONS.find((r) => r.value === reason)?.sign;
  // Une raison qui ne va pas avec le sens de la quantité reste désactivée, avec son explication.
  const allowed = (entry: (typeof REASONS)[number]) => mode === "count" ? entry.value === "correction" : typed === null || typed === 0 || entry.sign === "±" || (entry.sign === "+" ? typed > 0 : typed < 0);
  const ready = result !== null && !below && delta !== 0 && (mode === "count" || (reason !== "" && sign !== undefined));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  function step(by: number) {
    setQuantity(String((typed ?? 0) + by));
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="product" value={productId} />
      <input type="hidden" name="mode" value={mode} />
      <input type="hidden" name="reason" value={mode === "count" ? "correction" : reason} />
      <p className="text-sm text-texte-2">{productName}</p>
      <p className="text-[clamp(28px,8vw,40px)] leading-none font-medium tabular-nums">
        {formatNumber(stock)} <span className="text-base font-normal text-texte-2">en stock</span>
      </p>
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}

      <div role="tablist" aria-label="Façon d’ajuster" className="grid grid-cols-2 gap-1 rounded-[16px] border border-trait-doux bg-encre/50 p-1">
        {(["add", "count"] as const).map((entry) => (
          <button
            key={entry}
            type="button"
            role="tab"
            aria-selected={mode === entry}
            onClick={() => {
              setMode(entry);
              setQuantity("");
              setReason("");
            }}
            className="min-h-11 rounded-[12px] px-3 py-2 text-sm font-semibold text-texte-3 aria-selected:bg-white/12 aria-selected:text-texte"
          >
            {entry === "add" ? "Ajouter ou retirer" : "J’ai compté"}
          </button>
        ))}
      </div>

      {mode === "add" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-end gap-2">
            <StepButton label="Retirer un" onClick={() => step(-1)}>
              −
            </StepButton>
            <div className="min-w-0 flex-1">
              <Field id="quantite" name="quantity" label="Quantité à ajouter (ou à retirer, avec un −)" value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" error={state.fields?.quantity} className="text-center text-xl tabular-nums" />
            </div>
            <StepButton label="Ajouter un" onClick={() => step(1)}>
              +
            </StepButton>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {SHORTCUTS.map((value) => (
              <button key={value} type="button" onClick={() => step(value)} className="min-h-11 min-w-14 rounded-full border border-trait bg-encre/40 px-3.5 text-sm font-semibold tabular-nums hover:bg-white/10">
                {value > 0 ? `+${value}` : `−${Math.abs(value)}`}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <Field id="quantite" name="quantity" label="Quantité comptée" value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" error={state.fields?.quantity} className="text-xl tabular-nums" />
      )}

      {/* L'aperçu en direct annonce le résultat avant l'enregistrement. */}
      <p aria-live="polite" className={cn("text-lg tabular-nums", below ? "text-alerte" : delta < 0 ? "text-alerte" : "text-texte")}>
        {result === null ? "Indiquez une quantité." : below ? "Le stock ne peut pas descendre sous zéro" : `${formatNumber(stock)} → ${formatNumber(result)}`}
      </p>

      {mode === "add" ? (
        <fieldset className="flex flex-col gap-2" aria-describedby={state.fields?.reason ? "raison-erreur" : undefined}>
          <legend className="pb-1 text-[13px] font-semibold text-texte-2">Pourquoi ? (obligatoire)</legend>
          {REASONS.map((entry) => {
            const ok = allowed(entry);
            return (
              <label key={entry.value} className={cn("flex min-h-12 cursor-pointer items-center gap-3 rounded-[14px] border px-3.5 py-2.5", reason === entry.value ? "border-orange/60 bg-orange/10" : "border-trait-doux bg-encre/30", !ok && "cursor-not-allowed opacity-45")}>
                <input type="radio" name="reason_choice" value={entry.value} checked={reason === entry.value} disabled={!ok} onChange={() => setReason(entry.value)} className="size-4 accent-orange" />
                <span className="text-sm font-semibold">{entry.label}</span>
                <span className="ml-auto text-xs text-texte-3">{entry.sign === "+" ? "entrée" : entry.sign === "-" ? "sortie" : "entrée ou sortie"}</span>
              </label>
            );
          })}
          {state.fields?.reason ? (
            <p id="raison-erreur" role="alert" className="text-[13px] text-danger-clair">
              {state.fields.reason}
            </p>
          ) : null}
        </fieldset>
      ) : (
        <p className="text-[13px] text-texte-3">Le comptage est enregistré comme une correction.</p>
      )}

      <div className="flex flex-col gap-[7px]">
        <label htmlFor="note-stock" className="text-[13px] font-semibold text-texte-2">
          Une note (facultatif)
        </label>
        <input id="note-stock" name="note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} className="w-full rounded-champ border border-white/15 bg-encre/45 px-[15px] py-[13px] text-base outline-none focus-visible:border-orange" />
        <p className="text-xs text-texte-3 tabular-nums">{note.length} / 200</p>
        {state.fields?.note ? <p className="text-[13px] text-danger-clair">{state.fields.note}</p> : null}
      </div>

      <Button type="submit" pending={pending} pendingLabel="Enregistrement…" disabled={!ready} className="w-full">
        Enregistrer
      </Button>
    </form>
  );
}

function StepButton({ children, label, onClick }: { children: string; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} className="grid size-12 shrink-0 place-items-center rounded-full border border-trait bg-encre/40 text-2xl font-bold hover:bg-white/10">
      {children}
    </button>
  );
}

/* ---------- Historique ---------- */

const day = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", day: "numeric", month: "short" });

/** Les mouvements du stock, du plus récent au plus ancien : une liste lisible, un trait indigo pour une entrée, ocre pour une sortie. */
export function StockHistory({ slug, productId, first, next }: { slug: string; productId: string; first: StockMovement[]; next: string | null }) {
  // Les pages plus anciennes déjà chargées s'ajoutent aux 50 derniers, que la page rafraîchit après un ajustement.
  const [older, setOlder] = useState<{ items: StockMovement[]; cursor: string | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const known = new Set(first.map((movement) => movement.id));
  const items = [...first, ...(older?.items.filter((movement) => !known.has(movement.id)) ?? [])];
  const cursor = older ? older.cursor : next;

  async function more() {
    if (!cursor) return;
    setLoading(true);
    const page = await moreMovements(slug, productId, cursor);
    setLoading(false);
    if (!page) return;
    setOlder({ items: [...(older?.items ?? []), ...page.results], cursor: page.next_before });
  }

  if (items.length === 0) {
    return <p className="text-sm text-texte-3">Pas encore de mouvement. Le suivi commence à votre première modification de stock.</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2.5">
        {items.map((movement) => {
          const entry = movement.delta > 0;
          const who = movement.actor ? (movement.actor.is_you ? "par vous" : `par ${movement.actor.name}`) : movement.reason === "sold" ? "par la vitrine" : "";
          return (
            <li key={movement.id} className={cn("flex flex-col gap-0.5 border-l-[3px] pl-3", entry ? "border-indigo" : "border-ocre")}>
              <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                <span className="font-semibold tabular-nums" aria-hidden>
                  {entry ? "+" : "−"}
                  {formatNumber(Math.abs(movement.delta))}
                </span>
                <span className="sr-only">{entry ? "plus" : "moins"} {Math.abs(movement.delta)},</span>
                <span>{movement.label}</span>
                <span className="text-texte-3">· {formatNumber(movement.stock_after)} en stock</span>
              </p>
              <p className="text-xs text-texte-3">
                <time dateTime={movement.created_at} title={formatDateTime(movement.created_at)}>
                  {day.format(new Date(movement.created_at))}
                </time>
                {who ? ` · ${who}` : null}
                {movement.order ? (
                  <>
                    {" · "}
                    <Link href={`/app/${slug}/commandes/${movement.order.id}`} className="underline decoration-texte-3/50 underline-offset-2 hover:text-texte">
                      Commande {movement.order.reference}
                    </Link>
                  </>
                ) : null}
              </p>
              {movement.note ? <p className="text-xs text-texte-2">{movement.note}</p> : null}
            </li>
          );
        })}
      </ol>
      {cursor ? (
        <button type="button" onClick={more} disabled={loading} className="self-start rounded-full border border-trait px-4 py-2 text-sm font-semibold hover:bg-white/10 disabled:opacity-60">
          {loading ? "Chargement…" : "Voir plus"}
        </button>
      ) : null}
    </div>
  );
}
