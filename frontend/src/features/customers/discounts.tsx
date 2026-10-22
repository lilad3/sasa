"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { formatFcfa } from "@/lib/format";
import type { CreatedDiscount, DiscountKind } from "@/lib/types";
import { voice } from "@/lib/voice";

import { giveDiscount, type GiveDiscountState, revokeDiscount } from "./actions";

const initial: GiveDiscountState = {};

const longDay = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", day: "numeric", month: "long" });

/** Dans 30 jours, au format des champs date (l'heure d'Abidjan est l'heure UTC). */
function inDays(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Le message prêt à envoyer, en écriture neutre : on ne devine jamais le genre d'après le prénom. */
export function discountMessage(created: CreatedDiscount, shopName: string, shopUrl: string) {
  const first = created.customer.name.split(" ")[0];
  const offer = created.kind === "percent" ? `${created.value} % de réduction` : `${formatFcfa(created.value)} de réduction`;
  const until = longDay.format(new Date(`${created.ends_on}T12:00:00Z`));
  const times = created.max_uses > 1 ? ` (valable ${created.max_uses} fois)` : "";
  return (
    `Bonjour${first ? ` ${first}` : ""}, ${shopName} vous offre ${offer} avec le code ${created.code}, jusqu’au ${until}${times}. ` +
    `Il marche avec ce numéro. Commandez ici : ${shopUrl}?via=whatsapp`
  );
}

type GiveDiscountProps = {
  slug: string;
  customerId: string;
  customerName: string;
  shopName: string;
  shopUrl: string;
  /** Plafond d'un gérant (en %). null pour le propriétaire : toutes les valeurs permises. */
  cap: number | null;
  mfaEnabled: boolean;
  /** Dans une carte de fidèle : le formulaire s'ouvre dans la carte, pas en surimpression. */
  compact?: boolean;
};

/**
 * « Offrir une réduction », puis « Envoyer sur WhatsApp ». Le serveur décide de tout (droit, plafond, valeurs) :
 * le formulaire ne fait que proposer ce qui passera. Envoi par onSubmit : les champs restent après une erreur.
 */
export function GiveDiscount({ slug, customerId, customerName, shopName, shopUrl, cap, mfaEnabled, compact = false }: GiveDiscountProps) {
  const [state, formAction, pending] = useActionState(giveDiscount, initial);
  const [kind, setKind] = useState<DiscountKind>("percent");
  const [copied, setCopied] = useState(false);
  const manager = cap !== null;
  const fields = state.fields ?? {};
  const created = state.created;
  const id = `reduction-${customerId}`;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setCopied(false);
    startTransition(() => formAction(data));
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <details className={cn("group", compact ? "w-full" : "relative")} open={state.error || state.fields || state.reauth || created ? true : undefined}>
      <summary
        className={cn(
          "flex cursor-pointer list-none items-center gap-2 rounded-full font-semibold [&::-webkit-details-marker]:hidden",
          compact ? "text-[13px] text-indigo-clair hover:underline" : "bouton-contour px-5 py-3 text-sm",
        )}
      >
        <svg viewBox="0 0 24 24" className="size-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M4 12.5V5.5A1.5 1.5 0 0 1 5.5 4h7l7.5 7.5-8.5 8.5L4 12.5zM8.5 8.5h.01M10 15l5-5" />
        </svg>
        Offrir une réduction
      </summary>
      <div
        className={cn(
          "flex flex-col gap-3.5",
          compact
            ? "mt-3 border-t border-trait-doux pt-3"
            : "absolute top-[calc(100%+8px)] right-0 z-20 w-[min(400px,calc(100vw-24px))] rounded-[20px] border border-trait bg-nuit-2/95 p-[18px] shadow-[0_18px_40px_rgb(0_0_0/0.5)] backdrop-blur-xl",
        )}
      >
        {created ? (
          <div role="status" className="flex flex-col gap-2.5 rounded-[16px] border border-indigo-clair/35 bg-indigo/15 p-3.5">
            <p className="text-[13px] text-texte-2">
              Code créé pour {customerName} · {created.label}
            </p>
            <p className="font-mono text-[22px] tracking-[0.12em] text-texte select-all">{created.code}</p>
            <div className="flex flex-wrap gap-2">
              <a
                href={`https://wa.me/${created.customer.phone.replace(/\D/g, "")}?text=${encodeURIComponent(discountMessage(created, shopName, shopUrl))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bouton-clair rounded-full px-4 py-2 text-sm font-bold"
              >
                Envoyer sur WhatsApp
              </a>
              <button type="button" onClick={() => copy(discountMessage(created, shopName, shopUrl))} className="bouton-contour rounded-full px-4 py-2 text-sm font-semibold">
                {copied ? "Message copié" : "Copier le message"}
              </button>
            </div>
          </div>
        ) : null}

        <form onSubmit={submit} noValidate className="flex flex-col gap-3.5">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="customer" value={customerId} />
          {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}

          {manager ? (
            <>
              <input type="hidden" name="kind" value="percent" />
              <p className="text-[13px] text-texte-3">{voice("manager", shopName).discountCap(cap)}</p>
            </>
          ) : (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1.5 text-[13px] font-semibold text-texte-2">Type de remise</legend>
              <div className="flex gap-1 rounded-[14px] border border-trait-doux bg-encre/50 p-1">
                {(["percent", "amount"] as const).map((value) => (
                  <label
                    key={value}
                    className="flex flex-1 cursor-pointer items-center justify-center rounded-[10px] px-3 py-1.5 text-[13px] font-semibold text-texte-3 has-checked:bg-white/12 has-checked:text-texte has-focus-visible:ring-2 has-focus-visible:ring-orange-clair"
                  >
                    <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} className="sr-only" />
                    {value === "percent" ? "En %" : "En francs"}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field
              id={`${id}-valeur`}
              name="value"
              type="number"
              inputMode="numeric"
              label={kind === "percent" || manager ? "Remise (%)" : "Remise (F)"}
              min={kind === "percent" || manager ? 1 : 100}
              max={kind === "percent" || manager ? (cap ?? 90) : 1_000_000}
              defaultValue={kind === "percent" || manager ? Math.min(10, cap ?? 10) : 1000}
              key={kind}
              required
              error={fields.value}
            />
            <Field id={`${id}-fois`} name="max_uses" type="number" inputMode="numeric" label="Utilisations" min={1} max={10} defaultValue={1} required error={fields.max_uses} />
          </div>
          <Field
            id={`${id}-fin`}
            name="ends_on"
            type="date"
            label="Valable jusqu’au"
            min={inDays(0)}
            max={inDays(365)}
            defaultValue={inDays(30)}
            required
            error={fields.ends_on}
            className="[color-scheme:dark]"
          />
          <p className="text-[12.5px] text-texte-3">Le code ne marchera qu’avec le numéro de {customerName}.</p>
          {state.reauth ? <ReauthFields mfaEnabled={mfaEnabled} what="offrir une réduction" error={state.reauthError} /> : null}
          <Button type="submit" pending={pending} pendingLabel="Création…" className="self-start px-5 py-2.5 text-sm">
            {state.reauth ? "Confirmer et créer le code" : created ? "Créer un autre code" : "Créer le code"}
          </Button>
        </form>
      </div>
    </details>
  );
}

/** Annuler en deux temps : l'annulation est définitive. */
export function RevokeDiscount({ slug, id, code }: { slug: string; id: string; code: string }) {
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button type="button" onClick={() => setConfirming(true)} className="rounded-full px-3 py-1.5 text-[13px] text-texte-3 hover:text-danger-clair">
        Annuler
      </button>
    );
  }
  return (
    <form action={revokeDiscount} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="discount" value={id} />
      <span className="text-[13px] text-texte-2">Le code {code} ne marchera plus.</span>
      <button type="submit" className="rounded-full border border-danger/50 px-3 py-1.5 text-[13px] font-semibold text-danger-clair hover:bg-danger/10">
        Annuler le code
      </button>
      <button type="button" onClick={() => setConfirming(false)} className="rounded-full px-3 py-1.5 text-[13px] text-texte-3 hover:text-texte">
        Garder
      </button>
    </form>
  );
}
