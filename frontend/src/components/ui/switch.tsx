import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "children"> & {
  /** Le texte de l'étiquette, cliquable. */
  label: string;
  /** Interrupteur bloqué mais gardé dans le formulaire (un `disabled` natif sortirait de l'envoi). */
  locked?: boolean;
};

/** Un interrupteur : une vraie case à cocher (`role="switch"`), étiquette cliquable, lisible sans la couleur grâce au texte. */
export function Switch({ label, locked, className, onChange, ...input }: SwitchProps) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold", locked && "cursor-not-allowed opacity-70", className)}>
      <input
        {...input}
        type="checkbox"
        role="switch"
        aria-disabled={locked || undefined}
        onChange={locked ? undefined : onChange}
        // Verrouillé : le clic ne bascule pas, mais l'état reste dans l'envoi.
        onClick={locked ? (event) => event.preventDefault() : input.onClick}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative h-6 w-11 shrink-0 rounded-full border border-sable/35 bg-encre/50 transition-colors after:absolute after:top-[2px] after:left-[2px] after:size-[18px] after:rounded-full after:bg-sable after:transition-transform peer-checked:border-orange peer-checked:bg-orange peer-checked:after:translate-x-5 peer-checked:after:bg-encre peer-focus-visible:ring-2 peer-focus-visible:ring-orange-clair peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-nuit motion-reduce:transition-none motion-reduce:after:transition-none"
      />
      {label}
    </label>
  );
}
