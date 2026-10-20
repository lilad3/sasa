import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type FormAlertProps = { tone: "info" | "danger" | "success"; children: ReactNode };

const TONES = {
  info: "border-pistache/25 bg-pistache/10 text-texte",
  danger: "border-danger/40 bg-danger/12 text-danger-clair",
  success: "border-lime/40 bg-lime/12 text-texte",
};

/** Message global d'un formulaire, annoncé aux lecteurs d'écran. */
export function FormAlert({ tone, children }: FormAlertProps) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("rounded-champ border px-4 py-3 text-sm", TONES[tone])}>
      {children}
    </div>
  );
}
