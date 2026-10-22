"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/cn";
import type { Role } from "@/lib/types";

type NavLinksProps = {
  slug: string;
  role: Role;
  permissions: string[];
  unreadNotes: number;
  /** Commandes qui attendent une action (en attente, confirmées, expédiées) : la pastille de « Commandes ». */
  toProcess: number;
};

// Icônes dessinées pour Akwaba : une case par rubrique, sans engrenage ni cloche.
const ICONS = {
  overview: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
  customers: "M9 11.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM3.5 20c.4-3 2.7-5 5.5-5s5.1 2 5.5 5M15.5 5a3.3 3.3 0 0 1 0 6.3M17 15.3c2 .6 3.3 2.3 3.5 4.7",
  staff: "M4 6.5h16V19H4zM9.5 6.5V4h5v2.5M9 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.3 16.5c.5-1.3 1.5-2 2.7-2s2.2.7 2.7 2M14.5 11h3M14.5 14h3",
  notes: "M9 3.5h6M10 3.5v5L7 11.5h10L14 8.5v-5M12 11.5V20",
  products: "M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8",
  import: "M12 4v10M8 10.5l4 4 4-4M5 19h14",
  settings: "M4 7h9M17 7h3M15 5v4M4 17h3M11 17h9M9 15v4",
  storefront: "M4 9.5 5.5 4h13L20 9.5M4 9.5c0 1.4 1.1 2.5 2.7 2.5s2.6-1.1 2.6-2.5c0 1.4 1.1 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1 2.5 2.6 2.5S20 10.9 20 9.5M5.5 12v8h13v-8M10 20v-4.5h4V20",
  security: "M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5M5.5 10.5h13v10h-13zM12 14.5v2.5",
};

type Item = { href: string; label: string; icon: string; exact?: boolean; badge?: number; tone?: "ocre" | "orange" };
type Group = "ventes" | "boutique";

/**
 * Rubriques selon les droits effectifs (rôle et droits accordés), réparties en deux groupes :
 * « Ventes » (le quotidien) et « Boutique » (le catalogue et les réglages). La rubrique courante
 * est mise en avant, et une braise orange glisse d'une rubrique à l'autre.
 */
export function NavLinks({ slug, role, permissions, unreadNotes, toProcess }: NavLinksProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const emberRef = useRef<HTMLSpanElement>(null);
  const emberAt = useRef<{ x: number; y: number } | null>(null);
  const can = (permission: string) => permissions.includes(permission);
  const base = `/app/${slug}`;

  // Le groupe affiché suit la page : on ouvre « Boutique » sur le catalogue et les réglages.
  const inShop = /\/(produits|ma-boutique|parametres)(\/|$)/.test(pathname);
  const [group, setGroup] = useState<Group>(inShop ? "boutique" : "ventes");
  useEffect(() => {
    // La page a changé (lien, retour arrière) : le groupe suit, sans attendre un clic.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronisation avec l'adresse
    setGroup(inShop ? "boutique" : "ventes");
  }, [inShop]);

  const team: Item =
    role === "seller"
      ? { href: `${base}/messages`, label: "Messages", icon: ICONS.notes, badge: unreadNotes, tone: "ocre" }
      : { href: `${base}/personnel`, label: role === "owner" ? "Mon personnel" : "L’équipe", icon: ICONS.staff, badge: unreadNotes, tone: "ocre" };

  const groups: Record<Group, Item[]> = {
    ventes: [
      // Le vendeur n'a pas accès au chiffre d'affaires : sa page d'accueil est la liste des commandes.
      ...(can("dashboard.view") ? [{ href: base, label: "Vue d'ensemble", icon: ICONS.overview, exact: true }] : []),
      { href: `${base}/commandes`, label: "Commandes", icon: ICONS.orders, badge: toProcess, tone: "orange" as const },
      ...(can("customers.view") ? [{ href: `${base}/clients`, label: "Clients", icon: ICONS.customers }] : []),
      ...(can("team.view") ? [team] : []),
    ],
    boutique: [
      ...(can("products.view") ? [{ href: `${base}/produits`, label: "Produits", icon: ICONS.products }] : []),
      ...(can("products.write") ? [{ href: `${base}/produits/import`, label: "Import", icon: ICONS.import, exact: true }] : []),
      ...(can("storefront.edit") ? [{ href: `${base}/ma-boutique`, label: "Ma boutique", icon: ICONS.storefront }] : []),
      ...(can("shop.manage")
        ? [{ href: `${base}/parametres`, label: "Paramètres", icon: ICONS.settings }]
        : can("storefront.edit")
          ? [{ href: `${base}/parametres`, label: "La vitrine", icon: ICONS.settings }]
          : []),
    ],
  };
  const links = [...groups[group], { href: `${base}/securite`, label: "Sécurité", icon: ICONS.security }];

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
  }, [pathname, group]);

  return (
    <div className="flex shrink-0 items-center gap-2 lg:flex-col lg:items-stretch lg:gap-3">
      {groups.boutique.length > 0 ? (
        <div role="group" aria-label="Rubriques affichées" className="relative hidden grid-cols-2 rounded-[16px] border border-trait-doux bg-encre/50 p-1 lg:grid">
          <span
            aria-hidden
            className="absolute inset-y-1 left-1 w-[calc(50%-4px)] rounded-[12px] bg-white/12 transition-transform duration-300 ease-[cubic-bezier(0.3,0.7,0.2,1)]"
            style={{ transform: group === "boutique" ? "translateX(100%)" : undefined }}
          />
          {(["ventes", "boutique"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={group === value}
              onClick={() => setGroup(value)}
              className="relative rounded-[12px] py-2 text-[14px] font-semibold text-texte-3 transition-colors aria-pressed:text-texte"
            >
              {value === "ventes" ? "Ventes" : "Boutique"}
            </button>
          ))}
        </div>
      ) : null}

      <nav ref={navRef} aria-label="Rubriques" className="relative flex shrink-0 gap-0.5 lg:flex-col">
        <span
          ref={emberRef}
          aria-hidden
          className="pointer-events-none absolute top-0 left-0 size-[5px] rounded-full bg-orange opacity-0 shadow-[0_0_10px_2px_rgb(255_122_31/0.75)] transition-opacity duration-300"
        />
        {/* Sur téléphone, les deux groupes défilent dans la même barre : le sélecteur n'y sert pas. */}
        {[...links, ...groups[group === "ventes" ? "boutique" : "ventes"].map((link) => ({ ...link, mobileOnly: true }))].map((link) => {
          // La fiche d'une commande garde « Commandes » allumé.
          const active = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
          const mobileOnly = "mobileOnly" in link;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm whitespace-nowrap text-texte-2 transition-colors hover:bg-white/5 hover:text-texte aria-[current=page]:bg-white/10 aria-[current=page]:text-texte lg:py-2.5 lg:text-[15px]",
                mobileOnly && "lg:hidden",
              )}
            >
              <svg viewBox="0 0 24 24" className="size-[17px] shrink-0 opacity-85 group-aria-[current=page]:text-orange-clair group-aria-[current=page]:opacity-100" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={link.icon} />
              </svg>
              {link.label}
              {link.badge ? (
                <span
                  className={cn(
                    "ml-auto rounded-full px-1.5 text-[11px] leading-[18px] font-bold tabular-nums",
                    link.tone === "orange" ? "bg-orange/20 text-orange-clair" : "bg-ocre text-encre",
                  )}
                >
                  {link.badge}
                  <span className="sr-only">{link.tone === "orange" ? " à traiter" : ` non lu${link.badge > 1 ? "s" : ""}`}</span>
                </span>
              ) : null}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
