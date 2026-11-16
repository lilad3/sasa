"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import type { Role } from "@/lib/types";

type NavLinksProps = {
  slug: string;
  role: Role;
  permissions: string[];
  unreadNotes: number;
  /** Commandes qui attendent une action (en attente, confirmées, expédiées) : le chiffre de « Commandes ». */
  toProcess: number;
};

// Icônes dessinées pour Akwaba (maquette validée le 16/11/2026) : un trait fin, sans engrenage ni cloche.
const ICONS = {
  home: "M4 11.5 12 5l8 6.5M6.5 10v8.5h11V10M10.5 18.5v-4h3v4",
  orders: "M7 4h10v16l-2.5-1.5L12 20l-2.5-1.5L7 20zM9.5 9h5M9.5 12.5h5",
  products: "M4 12.5V5h7.5l8 8-7 7zM8.3 7.9a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6z",
  customers: "M9 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM3.8 19c.8-3 2.8-4.5 5.2-4.5s4.4 1.5 5.2 4.5M15.5 6.4a3 3 0 0 1 0 5.2M17.5 14.9c1.3.6 2.2 1.9 2.7 4.1",
  staff: "M4 6.5h16V19H4zM9.5 6.5V4h5v2.5M9 13a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6.3 16.5c.5-1.3 1.5-2 2.7-2s2.2.7 2.7 2M14.5 11h3M14.5 14h3",
  notes: "M9 3.5h6M10 3.5v5L7 11.5h10L14 8.5v-5M12 11.5V20",
  storefront: "M4.5 9.5 6 5h12l1.5 4.5M4.5 9.5c0 1.4 1.1 2.3 2.5 2.3s2.5-.9 2.5-2.3c0 1.4 1.1 2.3 2.5 2.3s2.5-.9 2.5-2.3c0 1.4 1.1 2.3 2.5 2.3s2.5-.9 2.5-2.3M6 12v7h12v-7",
  agent: "M12 4.5l1.6 4.4 4.4 1.6-4.4 1.6L12 16.5l-1.6-4.4L6 10.5l4.4-1.6zM18 16v3M16.5 17.5h3",
  settings: "M4 7h10M18 7h2M4 12h3M11 12h9M4 17h12M16 5a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM9 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM18 15a2 2 0 1 0 0 4 2 2 0 0 0 0-4z",
  security: "M7.5 10.5V8a4.5 4.5 0 0 1 9 0v2.5M5.5 10.5h13v10h-13zM12 14.5v2.5",
};

type Item = { href: string; label: string; icon: string; exact?: boolean; count?: number; unread?: number };

/**
 * Le menu de l'espace marchand, en une seule liste comme sur Shopify : le quotidien en haut,
 * les réglages en bas. Seules les rubriques permises par le rôle apparaissent. Un point orange
 * marque la rubrique ouverte et glisse d'une rubrique à l'autre.
 */
export function NavLinks({ slug, role, permissions, unreadNotes, toProcess }: NavLinksProps) {
  const pathname = usePathname();
  const navRef = useRef<HTMLElement>(null);
  const dotRef = useRef<HTMLSpanElement>(null);
  const dotAt = useRef<{ x: number; y: number } | null>(null);
  const can = (permission: string) => permissions.includes(permission);
  const base = `/app/${slug}`;

  const team: Item =
    role === "seller"
      ? { href: `${base}/messages`, label: "Messages", icon: ICONS.notes, unread: unreadNotes }
      : { href: `${base}/personnel`, label: role === "owner" ? "Mon personnel" : "L’équipe", icon: ICONS.staff, unread: unreadNotes };

  const daily: Item[] = [
    // Le vendeur n'a pas accès au chiffre d'affaires : sa page d'accueil est la liste des commandes.
    ...(can("dashboard.view") ? [{ href: base, label: "Accueil", icon: ICONS.home, exact: true }] : []),
    { href: `${base}/commandes`, label: "Commandes", icon: ICONS.orders, count: toProcess },
    ...(can("products.view") ? [{ href: `${base}/produits`, label: "Produits", icon: ICONS.products }] : []),
    ...(can("customers.view") ? [{ href: `${base}/clients`, label: "Clients", icon: ICONS.customers }] : []),
    ...(can("team.view") ? [team] : []),
    ...(can("storefront.edit") ? [{ href: `${base}/ma-boutique`, label: "Boutique en ligne", icon: ICONS.storefront }] : []),
  ];
  const setup: Item[] = [
    ...(can("shop.manage")
      ? [{ href: `${base}/parametres`, label: "Paramètres", icon: ICONS.settings }]
      : can("storefront.edit")
        ? [{ href: `${base}/parametres`, label: "La vitrine", icon: ICONS.settings }]
        : []),
    { href: `${base}/securite`, label: "Sécurité", icon: ICONS.security },
  ];

  // Le point se pose au bout de la rubrique ouverte (sous l'icône quand la barre est en ligne, sur téléphone).
  // En changeant de rubrique, il glisse en s'étirant dans le sens du trajet. Sans animation si on l'a demandé.
  useEffect(() => {
    const nav = navRef.current;
    const dot = dotRef.current;
    if (!nav || !dot) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const place = (animate: boolean) => {
      const active = nav.querySelector<HTMLElement>('[aria-current="page"]');
      if (!active) {
        dot.style.opacity = "0";
        dotAt.current = null;
        return;
      }
      const column = getComputedStyle(nav).flexDirection === "column";
      const to = column
        ? { x: active.offsetLeft + active.offsetWidth - 19, y: active.offsetTop + active.offsetHeight / 2 - 3.5 }
        : { x: active.offsetLeft + active.offsetWidth / 2 - 3.5, y: active.offsetTop + active.offsetHeight - 6 };
      const from = dotAt.current;
      dot.style.transform = `translate(${to.x}px, ${to.y}px)`;
      dot.style.opacity = "1";
      dotAt.current = to;
      if (!animate || reduced || !from || (from.x === to.x && from.y === to.y)) return;
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const stretch = 1 + Math.min(Math.hypot(dx, dy) / 30, 2.5);
      const [sx, sy] = Math.abs(dy) >= Math.abs(dx) ? [1, stretch] : [stretch, 1];
      dot.animate(
        [
          { transform: `translate(${from.x}px, ${from.y}px)` },
          { transform: `translate(${(from.x + to.x) / 2}px, ${(from.y + to.y) / 2}px) scale(${sx}, ${sy})` },
          { transform: `translate(${to.x}px, ${to.y}px)` },
        ],
        { duration: 520, easing: "cubic-bezier(0.3, 0.7, 0.2, 1)" },
      );
    };

    place(true);
    // La barre passe de ligne (téléphone) à colonne (ordinateur) : on replace le point sans le faire glisser.
    const observer = new ResizeObserver(() => place(false));
    observer.observe(nav);
    return () => observer.disconnect();
  }, [pathname]);

  const renderLink = (link: Item) => {
    // La fiche d'une commande garde « Commandes » allumé.
    const active = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
    return (
      <Link
        key={link.href}
        href={link.href}
        aria-current={active ? "page" : undefined}
        className="group flex items-center gap-3 rounded-[14px] px-3 py-2 text-sm whitespace-nowrap text-texte-2 transition-colors hover:bg-white/5 hover:text-texte aria-[current=page]:bg-(--surface-2) aria-[current=page]:font-semibold aria-[current=page]:text-texte lg:py-[11px] lg:pr-8"
      >
        <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={link.icon} />
        </svg>
        <span className="grow">{link.label}</span>
        {link.count ? (
          <span className="font-mono text-[12px] font-normal text-orange-clair tabular-nums">
            {link.count}
            <span className="sr-only"> à traiter</span>
          </span>
        ) : null}
        {link.unread ? (
          <span className="rounded-full bg-ocre px-1.5 text-[11px] leading-[18px] font-bold text-sur-orange tabular-nums">
            {link.unread}
            <span className="sr-only"> non lu{link.unread > 1 ? "s" : ""}</span>
          </span>
        ) : null}
      </Link>
    );
  };

  return (
    <nav ref={navRef} aria-label="Rubriques" className="relative flex shrink-0 gap-0.5 lg:flex-col">
      <span
        ref={dotRef}
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 size-[7px] rounded-full bg-orange opacity-0 shadow-[0_0_10px_rgb(255_122_31/0.8)] transition-opacity duration-300"
      />
      {daily.map(renderLink)}
      {/* Les réglages, sous un filet : on y va moins souvent. */}
      <span aria-hidden className="mx-1 w-px shrink-0 self-stretch bg-trait-doux lg:mx-0 lg:my-3 lg:h-px lg:w-auto" />
      {/* Bientôt : l'assistant qui agit pour le marchand. Annoncé, pas encore cliquable. */}
      <span className="hidden items-center gap-3 px-3 py-[11px] text-sm text-texte-3 lg:flex">
        <svg viewBox="0 0 24 24" className="size-[18px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={ICONS.agent} />
        </svg>
        <span className="grow">Agentique</span>
        <span className="rounded-full border border-trait px-2 py-0.5 text-[11px]">Bientôt</span>
      </span>
      {setup.map(renderLink)}
    </nav>
  );
}
