"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { Switch } from "@/components/ui/switch";
import { FormAlert } from "@/features/auth/form-alert";
import { formatDateTime, formatPhone } from "@/lib/format";
import { payoutVoice } from "@/lib/voice";
import type { PaymentSetting, PaymentSettings } from "@/lib/types";

import { cancelPendingNumber, type CancelState, type PaymentsState, savePayments } from "./payments-actions";

const initial: PaymentsState = {};
const initialCancel: CancelState = {};

/** « +2250707123456 » → « 07 07 12 34 56 » : le préfixe +225 est fixe à gauche du champ. */
function localNumber(number: string) {
  const digits = number.replace(/^\+225/, "");
  return digits.replace(/(\d{2})(?=\d)/g, "$1 ");
}

/** Les chiffres seuls, sans l'indicatif : « 07 07 12 34 56 » et « +225 0707123456 » se comparent égaux. */
function digitsOf(value: string) {
  const digits = value.replace(/\D/g, "");
  return digits.startsWith("00225") ? digits.slice(5) : digits.length > 10 && digits.startsWith("225") ? digits.slice(3) : digits;
}

type Draft = { enabled: boolean; number: string; name: string };

function draftsOf(settings: PaymentSettings): Record<string, Draft> {
  return Object.fromEntries(settings.methods.map((method) => [method.method, { enabled: method.enabled, number: localNumber(method.payout_number), name: method.payout_name }]));
}

/**
 * Les moyens de paiement de la boutique, en un seul formulaire (un PUT complet). Le serveur juge tout ; ce formulaire
 * prévient seulement : le bloc de confirmation apparaît dès qu'un numéro ou un nom change, et le dernier moyen actif ne
 * se désactive pas.
 */
export function PaymentsForm({ slug, settings, mfaEnabled }: { slug: string; settings: PaymentSettings; mfaEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(savePayments, initial);
  const serverKey = JSON.stringify(settings.methods);
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => draftsOf(settings));
  // Après un enregistrement, le serveur renvoie ses valeurs : la saisie repart d'elles, sans démonter le formulaire (le message d'état reste).
  const [seen, setSeen] = useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDrafts(draftsOf(settings));
  }
  const fields = state.fields ?? {};

  const changed = settings.methods.filter(
    (method) => method.kind === "mobile_money" && (digitsOf(drafts[method.method].number) !== digitsOf(method.payout_number) || drafts[method.method].name.trim() !== method.payout_name),
  );
  const replacing = changed.some((method) => digitsOf(drafts[method.method].number) !== digitsOf(method.payout_number) && method.payout_number !== "");
  const activeCount = Object.values(drafts).filter((draft) => draft.enabled).length;

  function update(method: string, patch: Partial<Draft>) {
    setDrafts((current) => ({ ...current, [method]: { ...current[method], ...patch } }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  const showReauth = changed.length > 0 || state.reauth;

  return (
    <section aria-labelledby="titre-paiements" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-8">
      <h2 id="titre-paiements" className="sr-only">
        Moyens de paiement
      </h2>
      {state.error && !state.reauth ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}

      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <input type="hidden" name="slug" value={slug} />
        <ul className="flex flex-col">
          {settings.methods.map((method) => (
            <MethodRow
              key={method.method}
              slug={slug}
              method={method}
              draft={drafts[method.method]}
              onChange={(patch) => update(method.method, patch)}
              lastActive={drafts[method.method].enabled && activeCount === 1}
              numberError={fields[`${method.method}.number`]}
              nameError={fields[`${method.method}.name`]}
            />
          ))}
        </ul>

        {showReauth ? (
          <div className="flex flex-col gap-3">
            {state.reauth && state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
            <div className="flex flex-col gap-1.5 text-[13.5px] text-texte-2">
              <p>{payoutVoice.payoutChangeWarning}</p>
              {replacing ? <p className="font-semibold text-texte">{payoutVoice.payoutReplaceWarning}</p> : null}
            </div>
            <ReauthFields mfaEnabled={mfaEnabled} what="changer un numéro de réception" error={state.reauthError} />
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" pending={pending} pendingLabel="Enregistrement…">
            {changed.length > 0 ? "Confirmer et enregistrer les paiements" : "Enregistrer les paiements"}
          </Button>
          {/* Ligne de statut, annoncée aux lecteurs d'écran : ni notification verte, ni fenêtre. */}
          <p role="status" className="text-[13.5px] text-texte-2">
            {state.done && !pending ? state.done : ""}
          </p>
        </div>
      </form>
    </section>
  );
}

function MethodRow({
  slug,
  method,
  draft,
  onChange,
  lastActive,
  numberError,
  nameError,
}: {
  slug: string;
  method: PaymentSetting;
  draft: Draft;
  onChange: (patch: Partial<Draft>) => void;
  lastActive: boolean;
  numberError?: string;
  nameError?: string;
}) {
  const id = `m-${method.method}`;
  const mobile = method.kind === "mobile_money";
  return (
    <li className="flex flex-col gap-3 border-b border-trait-doux py-4 first:pt-0 last:border-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <Switch
            name={`${method.method}_enabled`}
            checked={draft.enabled}
            locked={lastActive}
            onChange={(event) => onChange({ enabled: event.target.checked })}
            label={method.label}
            aria-describedby={lastActive ? `${id}-dernier` : undefined}
          />
          {lastActive ? (
            <span id={`${id}-dernier`} className="pl-[54px] text-[12.5px] text-ocre">
              {payoutVoice.keepOnePayment}
            </span>
          ) : null}
        </div>
        {!mobile ? <span className="text-[13px] text-texte-3">Le client paie à la réception.</span> : null}
        {mobile && !draft.enabled ? <span className="text-[13px] text-texte-3">Pas proposé aux clients</span> : null}
      </div>

      {mobile ? (
        // Masqué quand le moyen est éteint, mais gardé dans le formulaire : sinon l'envoi viderait le numéro enregistré.
        <div hidden={!draft.enabled} className="flex flex-col gap-3 pl-0 sm:pl-[54px]">
          {method.pending ? <PendingNote slug={slug} method={method} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              id={`${id}-numero`}
              name={`${method.method}_number`}
              label="Numéro qui reçoit les paiements"
              type="tel"
              inputMode="tel"
              autoComplete="off"
              value={draft.number}
              maxLength={24}
              placeholder="07 07 12 34 56"
              onChange={(event) => onChange({ number: event.target.value })}
              hint="Le numéro Wave ou Mobile Money de votre commerce"
              error={numberError}
              leading="+225"
              className="font-mono"
            />
            <Field
              id={`${id}-nom`}
              name={`${method.method}_name`}
              label="Nom affiché au client"
              autoComplete="off"
              value={draft.name}
              maxLength={40}
              placeholder="Aya Boutique"
              onChange={(event) => onChange({ name: event.target.value })}
              hint="Le client le compare avec le nom qui s’affiche chez son opérateur avant de payer. Exemple : Aya Boutique"
              error={nameError}
            />
          </div>
          {draft.enabled && !method.payout_number && !method.pending ? (
            <p className="rounded-[14px] border border-ocre/40 bg-ocre px-3.5 py-2 text-[13px] font-semibold text-encre">{payoutVoice.missingNumberHint}</p>
          ) : null}
          {method.example ? (
            <p className="text-[13px] text-texte-2">
              <span className="block text-[12px] font-semibold text-texte-3">Ce que verra votre client</span>
              {method.example}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

/** Le nouveau numéro attend 24 h : le propriétaire voit quand il servira, et peut annuler d'un clic. */
function PendingNote({ slug, method }: { slug: string; method: PaymentSetting }) {
  const [state, action, pending] = useActionState(cancelPendingNumber, initialCancel);
  const waiting = method.pending;
  if (!waiting) return null;

  function cancel() {
    const data = new FormData();
    data.set("slug", slug);
    data.set("method", method.method);
    startTransition(() => action(data));
  }
  return (
    <div className="flex flex-col gap-2 rounded-[14px] border border-ocre/40 bg-ocre/10 px-3.5 py-3">
      <p className="text-[13.5px]">
        <span className="font-semibold">Changement en attente.</span> Le nouveau numéro <span className="font-mono">{formatPhone(waiting.payout_number)}</span> ({waiting.payout_name}) servira à partir du{" "}
        {formatDateTime(waiting.activates_at)}. D’ici là, vos clients voient {method.payout_number ? "l’ancien numéro" : "que la boutique les contactera"}.
      </p>
      {state.error ? <p className="text-[13px] text-danger-clair">{state.error.message}</p> : null}
      {/* Pas de <form> ici : on est déjà dans celui des paiements. Le bouton envoie sa propre commande. */}
      <Button type="button" variant="ghost" pending={pending} pendingLabel="Annulation…" onClick={cancel} className="self-start px-4 py-2 text-[13.5px]">
        Annuler le changement
      </Button>
      <p role="status" className="sr-only">
        {state.done ?? ""}
      </p>
    </div>
  );
}
