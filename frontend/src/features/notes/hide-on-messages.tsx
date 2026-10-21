"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Sur la page du mot du patron, le bandeau ferait doublon avec la liste : on le cache. */
export function HideOnMessages({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return pathname.endsWith("/messages") ? null : children;
}
