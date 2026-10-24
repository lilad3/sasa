import Link from "next/link";

import { cn } from "@/lib/cn";
import { payoutVoice } from "@/lib/voice";
import type { DeliverySettings, PaymentSettings } from "@/lib/types";

/**
 * Deux lignes d'entrée sous l'onglet « Boutique » : Paiements et Livraison. Le résumé vient du serveur, tel quel.
 * Quand il manque quelque chose, la ligne passe sur fond ocre (texte encre) ET le dit en toutes lettres.
 */
export function SetupLinks({ slug, payments, delivery }: { slug: string; payments: PaymentSettings | null; delivery: DeliverySettings | null }) {
  const noDelivery = delivery !== null && delivery.zones.every((zone) => !zone.is_active) && !delivery.pickup.enabled;
  const rows = [
    {
      id: "paiements",
      title: "Paiements",
      summary: payments?.summary ?? "À ouvrir",
      alert: payments && payments.missing_numbers > 0 ? payoutVoice.payoutsMissing : payments && payments.pending_count > 0 ? "Un nouveau numéro attend ses 24 h" : null,
    },
    {
      id: "livraison",
      title: "Livraison",
      summary: delivery?.summary ?? "À ouvrir",
      alert: noDelivery ? payoutVoice.deliveryNone : null,
    },
  ];

  return (
    <nav aria-label="Paiements et livraison" className="col-span-full">
      <ul className="flex flex-col gap-2">
        {rows.map((row) => (
          <li key={row.id}>
            <Link
              href={`/app/${slug}/parametres/${row.id}`}
              className={cn(
                "flex items-center justify-between gap-4 rounded-[18px] border px-4 py-3.5 transition-colors",
                row.alert ? "border-ocre bg-ocre text-encre hover:bg-ocre/90" : "vitre border-trait hover:bg-white/[0.07]",
              )}
            >
              <span className="flex min-w-0 flex-col">
                <span className="flex flex-wrap items-baseline gap-x-4 gap-y-0.5">
                  <span className="text-[15px] font-semibold">{row.title}</span>
                  <span className={cn("text-[14px]", row.alert ? "text-encre" : "text-texte-2")}>{row.summary}</span>
                </span>
                {row.alert ? <span className="text-[13px] font-semibold">{row.alert}</span> : null}
              </span>
              <span aria-hidden className="shrink-0 text-lg">
                ›
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
