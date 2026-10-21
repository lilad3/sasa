"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";
import type { OrderStatus } from "@/lib/types";

import { changeOrderStatus, type OrderActionState } from "./actions";

// Le même circuit que le serveur (ORDER_TRANSITIONS) : on ne propose que ce que Django acceptera.
const NEXT_STEP: Partial<Record<OrderStatus, { status: OrderStatus; label: string; hint: string }>> = {
  pending: {
    status: "confirmed",
    label: "Confirmer la commande",
    hint: "Appelez le client pour vérifier l’adresse et l’heure de passage, puis confirmez.",
  },
  confirmed: { status: "shipped", label: "Marquer comme expédiée", hint: "Le colis est parti avec le livreur." },
  shipped: { status: "delivered", label: "Marquer comme livrée", hint: "Le client a reçu son colis." },
};
const CANCELLABLE = new Set<OrderStatus>(["pending", "confirmed"]);

const initial: OrderActionState = {};

export function StatusActions({ slug, orderId, status }: { slug: string; orderId: string; status: OrderStatus }) {
  const [state, formAction, pending] = useActionState(changeOrderStatus, initial);
  const [askingCancel, setAskingCancel] = useState(false);
  const next = NEXT_STEP[status];
  const canCancel = CANCELLABLE.has(status);
  const confirmingCancel = askingCancel && canCancel;

  return (
    <div className="flex flex-col gap-3">
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      {state.done && !pending ? <FormAlert tone="success">{state.done}</FormAlert> : null}

      {next || canCancel ? (
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="order" value={orderId} />

          {next && !confirmingCancel ? (
            <>
              <p className="text-sm text-texte-2">{next.hint}</p>
              <Button type="submit" name="status" value={next.status} pending={pending} pendingLabel="Enregistrement…" className="w-full">
                {next.label}
              </Button>
            </>
          ) : null}

          {confirmingCancel ? (
            <div role="group" aria-labelledby="annulation-question" className="flex flex-col gap-3 rounded-[16px] border border-danger/35 bg-danger/10 p-3.5">
              <p id="annulation-question" className="text-sm">
                Annuler cette commande ? Elle sortira du chiffre d’affaires et ne pourra plus être reprise.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  type="submit"
                  name="status"
                  value="cancelled"
                  variant="ghost"
                  pending={pending}
                  pendingLabel="Annulation…"
                  className="border-danger/50 px-5 py-2.5 text-sm text-danger-clair hover:bg-danger/15"
                >
                  Oui, annuler
                </Button>
                <button type="button" onClick={() => setAskingCancel(false)} className="rounded-full px-4 py-2.5 text-sm text-texte-2 hover:text-texte">
                  Garder la commande
                </button>
              </div>
            </div>
          ) : canCancel ? (
            <button
              type="button"
              onClick={() => setAskingCancel(true)}
              className="self-start text-sm text-texte-3 underline decoration-texte-3/40 underline-offset-[3px] hover:text-danger-clair hover:decoration-danger-clair"
            >
              Annuler la commande
            </button>
          ) : null}
        </form>
      ) : (
        <p className="text-sm text-texte-3">
          {status === "delivered" ? "Cette commande est livrée : son statut ne change plus." : "Cette commande est annulée : son statut ne change plus."}
        </p>
      )}
    </div>
  );
}
