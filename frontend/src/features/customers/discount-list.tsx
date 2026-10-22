import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import type { Discount, DiscountStatus } from "@/lib/types";

import { RevokeDiscount } from "./discounts";

const STATUS: Record<DiscountStatus, { label: string; tone: string }> = {
  active: { label: "En cours", tone: "text-indigo-clair" },
  used: { label: "Utilisée", tone: "text-sable" },
  expired: { label: "Expirée", tone: "text-texte-3" },
  revoked: { label: "Annulée", tone: "text-danger-clair" },
};

const day = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", day: "numeric", month: "short", year: "numeric" });

/** « Ses réductions » sur la fiche client : en cours d'abord, puis utilisées, expirées et annulées. */
export function DiscountList({ slug, discounts }: { slug: string; discounts: Discount[] }) {
  return (
    <section aria-labelledby="titre-ses-reductions" className="vitre flex flex-col gap-2 rounded-[26px] px-[18px] pt-4 pb-3">
      <h2 id="titre-ses-reductions" className="text-sm text-texte-2">
        Ses réductions
      </h2>
      {discounts.length === 0 ? (
        <p className="py-2 text-sm text-texte-3">Aucune réduction offerte pour l’instant.</p>
      ) : (
        <ul className="flex flex-col">
          {discounts.map((discount) => (
            <li key={discount.id} className={cn("flex flex-col gap-1 border-b border-trait-doux py-2.5 last:border-0", discount.status !== "active" && "opacity-75")}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <span className="flex items-baseline gap-2.5">
                  <span className="font-mono text-[14px] tracking-[0.08em]">{discount.code}</span>
                  <span className="text-[14px] font-semibold">{discount.label}</span>
                </span>
                <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", STATUS[discount.status].tone)}>
                  <span aria-hidden className="h-3.5 w-1 rounded-sm bg-current" />
                  {STATUS[discount.status].label}
                </span>
              </div>
              <p className="text-[12.5px] text-texte-3">
                Jusqu’au {day.format(new Date(`${discount.ends_on}T12:00:00Z`))} · utilisée {discount.uses} fois sur {discount.max_uses} · offerte{" "}
                {discount.created_by.is_you ? "par vous" : `par ${discount.created_by.name}`}, le {formatDateTime(discount.created_at)}
              </p>
              {discount.can_revoke ? (
                <div className="-ml-3">
                  <RevokeDiscount slug={slug} id={discount.id} code={discount.code} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
