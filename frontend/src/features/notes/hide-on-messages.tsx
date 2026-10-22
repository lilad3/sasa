"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Sur les pages qui listent déjà les messages (Messages, Mon personnel), le bandeau ferait doublon : on le cache. */
export function HideOnMessages({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return /\/(messages|personnel)$/.test(pathname) ? null : children;
}
