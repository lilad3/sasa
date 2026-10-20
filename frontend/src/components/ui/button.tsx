import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type Variant = "nuit" | "ghost";

const VARIANTS: Record<Variant, string> = {
  // Verre cannelé sombre traversé d'une lueur indigo (classe définie dans globals.css).
  nuit: "bouton-nuit",
  ghost: "border border-sable/25 bg-white/[0.04] text-texte hover:bg-white/10",
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Pendant un envoi : le bouton est désactivé, garde sa largeur et affiche une roue. */
  pending?: boolean;
  pendingLabel?: string;
};

export function Button({ variant = "nuit", pending = false, pendingLabel, className, children, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2.5 rounded-full px-6 py-3 text-[15px] font-bold whitespace-nowrap transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-60",
        VARIANTS[variant],
        className,
      )}
    >
      {pending ? (
        <>
          <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          {pendingLabel ?? children}
        </>
      ) : (
        children
      )}
    </button>
  );
}
