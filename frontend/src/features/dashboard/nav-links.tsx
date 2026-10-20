"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavLinksProps = { slug: string; canSeeRevenue: boolean };

const ICONS = {
  overview: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  orders: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6",
};

/** Liens de navigation : la rubrique courante est mise en avant (seule partie interactive de la barre). */
export function NavLinks({ slug, canSeeRevenue }: NavLinksProps) {
  const pathname = usePathname();
  const links = [
    // Le vendeur n'a pas accès au chiffre d'affaires : sa page d'accueil est la liste des commandes.
    ...(canSeeRevenue ? [{ href: `/app/${slug}`, label: "Vue d'ensemble", icon: ICONS.overview }] : []),
    { href: `/app/${slug}/commandes`, label: "Commandes", icon: ICONS.orders },
  ];

  return (
    <nav aria-label="Rubriques" className="flex shrink-0 gap-0.5 lg:flex-col">
      {links.map((link) => {
        const active = pathname === link.href;
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
          </Link>
        );
      })}
    </nav>
  );
}
