"use client";

import { useState } from "react";

import { formatFcfa } from "@/lib/format";
import type { Fulfillment, PaymentInstructions as Instructions } from "@/lib/types";

type Props = {
  /** Écrit par le serveur : null pour le paiement à la livraison. */
  instructions: Instructions | null;
  total: number;
  fulfillment: Fulfillment;
  /** Le paiement à la livraison ne dit rien d'autre que « vous paierez à la livraison ». */
  cash: boolean;
};

/**
 * Ce qu'il reste à payer. Le texte vient du serveur et s'affiche tel quel (jamais recomposé ici) : le serveur lit le
 * numéro de la boutique au moment de l'affichage, le front ne le garde nulle part. Servi à la confirmation et au suivi.
 */
export function PaymentInstructions({ instructions, total, fulfillment, cash }: Props) {
  const [copied, setCopied] = useState("");

  if (cash || instructions === null) {
    return (
      <p className="rounded-[18px] bg-[rgb(255_244_232/0.45)] p-4 text-[15px]">
        Vous paierez <span className="font-semibold">{formatFcfa(total)}</span> {fulfillment === "pickup" ? "au retrait" : "à la livraison"}.
      </p>
    );
  }

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(`${label} copié`);
    } catch {
      setCopied(`Copie impossible : recopiez le ${label.toLowerCase()} à la main.`);
    }
  }

  return (
    <section aria-labelledby="reste-a-payer" className="flex flex-col gap-3 rounded-[18px] bg-[rgb(255_244_232/0.45)] p-4">
      <h3 id="reste-a-payer" className="large text-xl font-bold">
        Il reste à payer {formatFcfa(instructions.amount)}
      </h3>
      <p className="text-[15px]">{instructions.text}</p>
      {instructions.number ? (
        <>
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-encre-doux">Numéro {instructions.label}</dt>
              <dd className="font-mono text-xl font-bold tracking-wide">{instructions.number_display}</dd>
              {instructions.holder ? <dd className="text-xs text-encre-doux">Au nom de {instructions.holder}</dd> : null}
            </div>
            <div>
              <dt className="text-xs text-encre-doux">Référence à indiquer</dt>
              <dd className="font-mono text-xl font-bold tracking-wide">{instructions.reference}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => copy("Numéro", instructions.number ?? "")} className="bouton-verre rounded-full px-4 py-2 text-sm font-semibold">
              Copier le numéro
            </button>
            <button type="button" onClick={() => copy("Référence", instructions.reference)} className="bouton-verre rounded-full px-4 py-2 text-sm font-semibold">
              Copier la référence
            </button>
          </div>
          <p aria-live="polite" className="min-h-[1.25rem] text-[13px] text-encre-doux">
            {copied}
          </p>
          <p className="text-xs text-encre-doux">Avant de payer, vérifiez que le nom affiché chez votre opérateur est bien celui-ci.</p>
        </>
      ) : null}
    </section>
  );
}
