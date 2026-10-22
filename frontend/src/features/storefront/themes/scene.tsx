"use client";

import { type HTMLAttributes, type ReactNode, useEffect, useRef } from "react";

import { cn } from "@/lib/cn";

type SceneProps = HTMLAttributes<HTMLElement> & { as?: "div" | "section" | "ul" | "li" | "article" | "header"; children: ReactNode };

/**
 * Une partie de la vitrine dont les entrées (.th-reveal) attendent d'arriver à l'écran.
 * L'attribut data-vu est posé directement sur l'élément : pas d'état React, pas de rendu en plus.
 */
export function Scene({ as = "div", className, children, ...rest }: SceneProps) {
  const ref = useRef<HTMLDivElement>(null);
  // Une seule balise pour TypeScript : la balise réelle reste celle demandée (section, li…).
  const Tag = as as "div";
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (!("IntersectionObserver" in window)) {
      node.setAttribute("data-vu", "");
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          node.setAttribute("data-vu", "");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <Tag ref={ref} className={cn("th-scene", className)} {...rest}>
      {children}
    </Tag>
  );
}
