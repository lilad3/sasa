"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

type NavLinksProps = { slug: string; permissions: string[]; unreadNotes: number };

// Icônes dessinées pour Akwaba : une case par rubrique, sans engrenage ni cloche.
const ICONS = {
  overview: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  products: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  notes: "M9 3.5h6M10 3.5v5L7 11.5h10L14 8.5v-5M12 11.5V20",
  settings: "M4 7h9M17 7h3M15 5v4M4 17h3M11 17h9M9 15v4",
  security: "M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5M5.5 10.5h13v10h-13zM12 14.5v2.5",
};

/**
 * Liens de navigation selon les droits du rôle : la rubrique courante est mise en avant,
 * et une braise orange glisse d'une rubrique à l'autre.
 */
export function NavLinks({ slug, permissions, unreadNotes }: NavLinksProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const emberRef = useRef<HTMLSpanElement>(null);
  const emberAt = useRef<{ x: number; y: number } | null>(null);

  // La braise se place devant l'icône du lien actif. En changeant de rubrique, elle glisse en s'étirant
  // dans le sens du trajet, comme une goutte de lumière. Sans animation si l'utilisateur l'a demandé.
  useEffect(() => {
    const nav = navRef.current;
    const ember = emberRef.current;
    if (!nav || !ember) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const place = (animate: boolean) => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) {
        ember.style.opacity = "0";
        emberAt.current = null;
        return;
      }
      const to = { x: active.offsetLeft + 3, y: active.offsetTop + active.offsetHeight / 2 - 2.5 };
      const from = emberAt.current;
      ember.style.transform = `translate(${to.x}px, ${to.y}px)`;
      ember.style.opacity = "1";
      emberAt.current = to;
      if (!animate || reduced || !from || (from.x === to.x && from.y === to.y)) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const stretch = 1 + Math.min(Math.hypot(dx, dy) / 30, 2.5);
      const [sx, sy] = Math.abs(dy) >= Math.abs(dx) ? [1, stretch] : [stretch, 1];
      ember.animate(
        [
          { transform: `translate(${from.x}px, ${from.y}px)` },
          { transform: `translate(${(from.x + to.x) / 2}px, ${(from.y + to.y) / 2}px) scale(${sx}, ${sy})` },
          { transform: `translate(${to.x}px, ${to.y}px)` },
        ],
        { duration: 520, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
      );
    };

    place(true);
    // La barre passe de ligne (mobile) à colonne (ordinateur) : on replace la braise sans la faire glisser.
    const observer = new ResizeObserver(() => place(false));
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname]);

  const can = (permission: string) => permissions.includes(permission);
  const links = [
    // Le vendeur n'a pas accès au chiffre d'affaires : sa page d'accueil est la liste des commandes.
    ...(can("dashboard.view") ? [{ href: `/app/${slug}`, label: "Vue d'ensemble", icon: ICONS.overview, exact: true }] : []),
    { href: `/app/${slug}/commandes`, label: "Commandes", icon: ICONS.orders },
    ...(can("products.view") ? [{ href: `/app/${slug}/produits`, label: "Produits", icon: ICONS.products }] : []),
    ...(can("team.view") ? [{ href: `/app/${slug}/messages`, label: "Le mot du patron", icon: ICONS.notes, badge: unreadNotes }] : []),
    ...(can("shop.manage") ? [{ href: `/app/${slug}/parametres`, label: "Paramètres", icon: ICONS.settings }] : []),
    { href: `/app/${slug}/securite`, label: "Sécurité", icon: ICONS.security },
  ];

  return (
    <nav ref={navRef} aria-label="Rubriques" className="relative flex shrink-0 gap-0.5 lg:flex-col">
      <span
        ref={emberRef}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 size-[5px] rounded-full bg-orange opacity-0 shadow-[0_0_10px_2px_rgb(255_122_31/0.75)] transition-opacity duration-300"
      />
      {links.map((link) => {
        // La fiche d'une commande garde « Commandes » allumé.
        const active = "exact" in link ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
        const badge = "badge" in link ? link.badge : 0;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className="group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm whitespace-nowrap text-texte-2 hover:bg-white/5 hover:text-texte aria-[current=page]:bg-white/10 aria-[current=page]:text-texte"
          >
            <svg viewBox="0 0 24 24" className="size-[17px] shrink-0 opacity-85 group-aria-[current=page]:text-orange-clair group-aria-[current=page]:opacity-100" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={link.icon} />
            </svg>
            {link.label}
            {badge ? (
              <span className="ml-auto rounded-full bg-ocre px-1.5 text-[11px] leading-[18px] font-bold text-encre tabular-nums">
                {badge}
                <span className="sr-only"> non lu{badge > 1 ? "s" : ""}</span>
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
