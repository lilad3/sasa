import { cn } from "@/lib/cn";
import type { Fulfillment, PickupPlace } from "@/lib/types";

const LABEL: Record<Fulfillment, string> = { delivery: "Livraison", pickup: "Retrait sur place" };

/**
 * « Comment voulez-vous recevoir votre commande ? » Deux boutons radio quand la boutique propose les deux ;
 * s'il n'y en a qu'un, le choix disparaît et une phrase le dit.
 */
export function FulfillmentChoice({
  id,
  value,
  onChange,
  canDeliver,
  canPickup,
}: {
  id: string;
  value: Fulfillment;
  onChange: (value: Fulfillment) => void;
  canDeliver: boolean;
  canPickup: boolean;
}) {
  if (canDeliver && canPickup) {
    return (
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-encre-doux">Comment voulez-vous recevoir votre commande ?</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["delivery", "pickup"] as const).map((mode) => (
            <label
              key={mode}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2.5 text-[13.5px] font-semibold transition-colors has-focus-visible:ring-2 has-focus-visible:ring-encre",
                value === mode ? "border-encre bg-[rgb(255_244_232/0.55)]" : "border-encre/20 hover:bg-[rgb(255_244_232/0.35)]",
              )}
            >
              <input type="radio" name={`${id}-mode`} value={mode} checked={value === mode} onChange={() => onChange(mode)} className="radio-verre" />
              {LABEL[mode]}
            </label>
          ))}
        </div>
      </fieldset>
    );
  }
  return (
    <p className="text-sm text-encre-doux">
      {canPickup ? "Cette boutique ne propose que le retrait sur place." : "Cette boutique livre à domicile."}
    </p>
  );
}

/** Le lieu de retrait, en texte (pas une carte) : adresse, horaires s'il y en a, délai de préparation. */
export function PickupNote({ pickup }: { pickup: PickupPlace }) {
  return (
    <div className="flex flex-col gap-1 border-l-2 border-encre/40 pl-3.5 text-[14px]">
      <p className="font-semibold">Retrait à {pickup.address}</p>
      {pickup.hours ? <p className="text-encre-doux">Horaires : {pickup.hours}</p> : null}
      <p className="text-encre-doux">Prête sous {pickup.prep_hours} h</p>
    </div>
  );
}
