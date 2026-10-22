"use client";

import { type FormEvent, startTransition, useActionState, useId } from "react";

import { cn } from "@/lib/cn";
import { formatDateTime, formatFcfa, PAYMENT_LABEL } from "@/lib/format";
import type { OrderStatus, TrackedOrder } from "@/lib/types";

import { trackOrder, type TrackState } from "./actions";

const initial: TrackState = {};

const INPUT =
  "w-full rounded-[14px] border border-encre/20 bg-[rgb(255_246_236/0.62)] px-4 py-3 text-base text-encre outline-none transition-[border-color,box-shadow] placeholder:text-[#6b5440] focus-visible:border-encre focus-visible:shadow-[0_0_0_3px_rgb(74_87_214/0.35)] aria-invalid:border-[#8a2412]";

const STEPS: { status: Exclude<OrderStatus, "cancelled">; label: string; detail: string }[] = [
  { status: "pending", label: "Reçue", detail: "La boutique va vous appeler pour confirmer." },
  { status: "confirmed", label: "Confirmée", detail: "Votre colis est en préparation." },
  { status: "shipped", label: "En route", detail: "Le livreur est en chemin." },
  { status: "delivered", label: "Livrée", detail: "Bonne dégustation, ou bonne utilisation !" },
];

/** Formulaire de suivi et état de la commande. La référence peut arriver pré-remplie depuis la confirmation. */
export function TrackOrder({ slug, reference }: { slug: string; reference: string }) {
  const [state, formAction, pending] = useActionState(trackOrder, initial);
  const id = useId();

  // onSubmit plutôt que `action` : React viderait sinon les champs après une erreur.
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} noValidate className="verre-clair flex flex-col gap-4 rounded-[24px] p-5 md:p-6">
        <input type="hidden" name="slug" value={slug} />
        <div className="grid gap-4 sm:grid-cols-[1fr_180px]">
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-ref`} className="text-[13px] font-semibold">
              Référence de la commande
            </label>
            <input
              id={`${id}-ref`}
              name="reference"
              defaultValue={reference}
              placeholder="K7F-92Q"
              maxLength={12}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={state.fields?.reference ? true : undefined}
              aria-describedby={state.fields?.reference ? `${id}-ref-erreur` : undefined}
              className={cn(INPUT, "font-mono tracking-wider uppercase")}
            />
            {state.fields?.reference ? (
              <p id={`${id}-ref-erreur`} className="text-[13px] text-[#8a2412]">
                {state.fields.reference}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-tel`} className="text-[13px] font-semibold">
              4 derniers chiffres du téléphone
            </label>
            <input
              id={`${id}-tel`}
              name="phone_last4"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              placeholder="3456"
              aria-invalid={state.fields?.phone_last4 ? true : undefined}
              aria-describedby={state.fields?.phone_last4 ? `${id}-tel-erreur` : undefined}
              className={cn(INPUT, "font-mono tracking-[0.3em]")}
            />
            {state.fields?.phone_last4 ? (
              <p id={`${id}-tel-erreur`} className="text-[13px] text-[#8a2412]">
                {state.fields.phone_last4}
              </p>
            ) : null}
          </div>
        </div>
        {state.error ? (
          <p role="alert" className="rounded-2xl border border-corail/40 bg-corail/10 px-4 py-3 text-sm text-[#8f2a1a]">
            {state.error}
          </p>
        ) : null}
        <button type="submit" disabled={pending} aria-busy={pending || undefined} className="bouton-nuit inline-flex items-center justify-center gap-2 self-start rounded-full px-5 py-3 font-bold disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : null}
          {pending ? "Recherche…" : "Voir où en est ma commande"}
        </button>
        <p className="text-xs text-encre-doux">Le numéro reste entre vous et la boutique : cette page n’affiche ni votre adresse ni votre téléphone.</p>
      </form>

      <div aria-live="polite">{state.order && !pending ? <OrderStatusCard order={state.order} /> : null}</div>
    </div>
  );
}

function OrderStatusCard({ order }: { order: TrackedOrder }) {
  const cancelled = order.status === "cancelled";
  const reached = STEPS.findIndex((step) => step.status === order.status);
  const place = [order.delivery.commune, order.delivery.city].filter(Boolean).join(", ");

  return (
    <section aria-label={`Commande ${order.reference}`} className="verre-clair flex flex-col gap-5 rounded-[24px] p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="large font-mono text-2xl font-bold tracking-wide">{order.reference}</h2>
        <p className="text-[13px] text-encre-doux">Passée le {formatDateTime(order.created_at)}</p>
      </div>

      {cancelled ? (
        <p className="rounded-2xl border border-corail/40 bg-corail/10 px-4 py-3 text-sm text-[#8f2a1a]">
          Cette commande a été annulée le {formatDateTime(order.updated_at)}. Contactez la boutique si vous ne vous y attendiez pas.
        </p>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-4">
          {STEPS.map((step, index) => {
            const done = index <= reached;
            const current = index === reached;
            return (
              <li key={step.status} aria-current={current ? "step" : undefined} className="flex gap-3 sm:flex-col sm:gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "grid size-8 shrink-0 place-items-center rounded-full border-2 text-sm font-bold",
                    done ? "border-encre bg-encre text-creme" : "border-encre/25 text-encre/45",
                    current && "ring-4 ring-indigo/35",
                  )}
                >
                  {done ? "✓" : index + 1}
                </span>
                <span>
                  <span className={cn("block text-[15px] font-semibold", !done && "text-encre-doux")}>
                    {step.label}
                    <span className="sr-only">{done ? " : étape atteinte" : " : pas encore"}</span>
                  </span>
                  {current ? <span className="block text-[13px] text-encre-doux">{step.detail}</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <dl className="grid gap-3 rounded-[18px] bg-[rgb(255_244_232/0.45)] p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-encre-doux">Articles</dt>
          {order.items.map((item) => (
            <dd key={item.name} className="text-[14px]">
              {item.quantity} × {item.name}
            </dd>
          ))}
        </div>
        <div>
          <dt className="text-xs text-encre-doux">Total</dt>
          <dd className="large text-2xl font-bold">{formatFcfa(order.total)}</dd>
          <dd className="text-xs text-encre-doux">
            {formatFcfa(order.subtotal)} d’articles
            {order.discount_amount > 0 ? <>, −{formatFcfa(order.discount_amount)} de remise</> : null}, {order.delivery_fee ? `${formatFcfa(order.delivery_fee)} de livraison` : "livraison offerte"}
          </dd>
          <dd className="text-xs text-encre-doux">{PAYMENT_LABEL[order.payment_method]}</dd>
        </div>
        <div>
          <dt className="text-xs text-encre-doux">Livraison</dt>
          <dd className="text-[14px] font-semibold">{place || "—"}</dd>
          <dd className="text-xs text-encre-doux">Mise à jour le {formatDateTime(order.updated_at)}</dd>
        </div>
      </dl>
    </section>
  );
}
