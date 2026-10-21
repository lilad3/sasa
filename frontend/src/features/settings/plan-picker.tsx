"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { ReauthFields } from "@/components/ui/reauth-fields";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import type { PlansOverview, PlanSpec } from "@/lib/types";

import { changePlan, type PlanState } from "./actions";

const initial: PlanState = {};

function features(plan: PlanSpec) {
  return [
    plan.products === null ? "Produits sans limite" : `${formatNumber(plan.products)} produits`,
    plan.members === null ? "Équipe sans limite" : plan.members === 1 ? "Vous seul" : `${formatNumber(plan.members)} personnes dans l’équipe`,
    plan.monthly_orders === null ? "Commandes sans plafond" : `Jusqu’à ${formatNumber(plan.monthly_orders)} commandes par mois`,
    plan.csv_import ? "Import de produits par fichier CSV" : null,
    plan.custom_accent ? "Couleur de la vitrine au choix" : null,
    plan.api_keys ? "Clés API pour vos logiciels" : null,
  ].filter((item): item is string => item !== null);
}

/**
 * Les trois plans, avec celui de la boutique mis en avant. Pas encore de paiement : le changement est simulé,
 * mais les limites sont appliquées pour de vrai par Django (produits, équipe, clés API, couleur).
 */
export function PlanPicker({ slug, overview, mfaEnabled }: { slug: string; overview: PlansOverview; mfaEnabled: boolean }) {
  const [state, formAction, pending] = useActionState(changePlan, initial);
  const rank = (id: string) => overview.plans.findIndex((plan) => plan.id === id);
  const currentRank = rank(overview.current);

  return (
    <div className="col-span-full grid gap-2.5 md:grid-cols-3 md:gap-3 lg:gap-3.5">
      {state.done && !pending ? (
        <div className="md:col-span-3">
          <FormAlert tone="success">{state.done}</FormAlert>
        </div>
      ) : null}
      {overview.plans.map((plan) => {
        const current = plan.id === overview.current;
        const target = state.target === plan.id;
        const upgrade = rank(plan.id) > currentRank;
        return (
          <section
            key={plan.id}
            aria-labelledby={`plan-${plan.id}`}
            className={cn("vitre flex flex-col gap-4 rounded-[24px] p-[18px]", current && "border-orange/50")}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 id={`plan-${plan.id}`} className="text-lg font-semibold">
                  {plan.name}
                </h2>
                <p className="mt-1">
                  <span className="chiffres text-[34px]">{plan.price === 0 ? "0" : formatNumber(plan.price)}</span>
                  <span className="text-sm text-texte-3"> F / mois</span>
                </p>
              </div>
              {current ? <span className="rounded-full bg-orange px-2.5 py-1 text-[12px] font-bold text-encre">Votre plan</span> : null}
            </div>
            <ul className="flex flex-1 flex-col gap-1.5 text-[13.5px] text-texte-2">
              {features(plan).map((feature) => (
                <li key={feature} className="flex gap-2">
                  <span aria-hidden className="text-orange-clair">
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>
            {current ? null : (
              <form action={formAction} noValidate className="flex flex-col gap-3">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="plan" value={plan.id} />
                {target && state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
                {target && state.reauth ? <ReauthFields mfaEnabled={mfaEnabled} what={`passer au plan ${plan.name}`} error={state.reauthError} /> : null}
                <Button type="submit" variant={upgrade ? "nuit" : "ghost"} pending={pending && target} disabled={pending} pendingLabel="Changement…" className="self-start px-5 py-2.5 text-sm">
                  {target && state.reauth ? "Confirmer le changement" : upgrade ? `Passer au plan ${plan.name}` : `Revenir au plan ${plan.name}`}
                </Button>
              </form>
            )}
          </section>
        );
      })}
    </div>
  );
}
