"use client";

import Link from "next/link";
import { type CSSProperties, useId, useState } from "react";

import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";

type Plan = {
  id: "free" | "pro" | "business";
  name: string;
  price: number;
  upTo: number | null; // commandes par mois incluses ; null = sans limite
  features: string[];
  tone: string;
};

// Mêmes plans que le backend (shops.models.Plan). Les montants sont des exemples tant que le paiement n'existe pas.
const PLANS: Plan[] = [
  {
    id: "free",
    name: "Gratuit",
    price: 0,
    upTo: 100,
    features: ["25 produits", "1 personne pour gérer la boutique", "Le dashboard des ventes au quotidien"],
    tone: "bg-[#237264] text-creme",
  },
  {
    id: "pro",
    name: "Pro",
    price: 9900,
    upTo: 2000,
    features: ["500 produits", "Jusqu’à 5 personnes, avec des rôles", "Import depuis Excel et clés API", "Votre couleur et votre couverture"],
    tone: "bg-encre text-creme",
  },
  {
    id: "business",
    name: "Business",
    price: 29900,
    upTo: null,
    features: ["Produits et commandes sans limite", "Jusqu’à 20 personnes", "Accompagnement au démarrage"],
    tone: "bg-indigo text-creme",
  },
];

function planFor(orders: number) {
  return PLANS.find((plan) => plan.upTo === null || orders <= plan.upTo) ?? PLANS[PLANS.length - 1];
}

/** Le visiteur indique son volume de commandes : le plan qui lui convient se met en avant. */
export function PricingSimulator() {
  const [orders, setOrders] = useState(250);
  const inputId = useId();
  const recommended = planFor(orders);

  return (
    <div className="flex flex-col gap-4">
      <div className="verre-clair flex flex-col gap-4 rounded-[24px] p-5 md:flex-row md:items-center md:gap-8 md:p-6">
        <label htmlFor={inputId} className="text-lg font-medium md:max-w-[24ch]">
          Combien de commandes recevez-vous par mois ?
        </label>
        <input
          id={inputId}
          type="range"
          min={0}
          max={3000}
          step={10}
          value={orders}
          onChange={(event) => setOrders(Number(event.target.value))}
          className="curseur flex-1"
          style={{ "--rempli": `${(orders / 3000) * 100}%` } as CSSProperties}
          aria-describedby={`${inputId}-valeur`}
        />
        <output id={`${inputId}-valeur`} htmlFor={inputId} className="chiffres min-w-[7ch] text-[34px]">
          {formatNumber(orders)}
          <small className="ml-1.5 text-sm font-normal text-encre-doux">commandes</small>
        </output>
      </div>

      <ul className="grid gap-3 md:grid-cols-3">
        {PLANS.map((plan) => {
          const active = plan.id === recommended.id;
          return (
            <li
              key={plan.id}
              aria-current={active ? "true" : undefined}
              className={cn(
                "verre-clair flex flex-col gap-4 rounded-[24px] p-6",
                active && "[--verre-bord:var(--color-encre)] [--verre-ombre:0_18px_40px_rgb(23_17_10/0.16)]",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn("rounded-full px-3 py-1 text-sm font-bold", plan.tone)}>{plan.name}</span>
                {active ? <span className="text-xs font-semibold text-encre-doux">Recommandé pour vous</span> : null}
              </div>
              <p className="flex items-baseline gap-1.5">
                <span className="chiffres text-[42px]">{formatNumber(plan.price)}</span>
                <span className="text-encre-doux">F / mois</span>
              </p>
              <p className="text-sm text-encre-doux">
                {plan.upTo === null ? "Au-delà de 2 000 commandes par mois" : `Jusqu’à ${formatNumber(plan.upTo)} commandes par mois`}
              </p>
              <ul className="flex flex-col gap-2 text-[15px]">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5">
                    <span aria-hidden className="mt-[9px] size-1.5 shrink-0 rounded-full bg-encre" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Link
                href="/inscription"
                className={cn(
                  "mt-auto rounded-full px-5 py-3 text-center font-semibold",
                  active ? "bouton-nuit" : "bouton-verre",
                )}
              >
                {plan.price === 0 ? "Commencer gratuitement" : `Choisir ${plan.name}`}
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-encre">Montants en F CFA, sans engagement. Toutes les boutiques commencent sur le plan Gratuit.</p>
    </div>
  );
}
