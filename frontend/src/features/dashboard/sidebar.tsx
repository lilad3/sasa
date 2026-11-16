import Link from "next/link";
import { notFound } from "next/navigation";

import { Logo } from "@/components/ui/logo";
import { logout } from "@/features/auth/actions";
import { ROLE_LABEL } from "@/lib/format";
import { getMe, getMyShops, getOrderCounts, getUnreadTeamNotes } from "@/lib/server/session";
import type { Plan, ShopMembership } from "@/lib/types";

import { ModeToggle } from "./mode-toggle";
import { NavLinks } from "./nav-links";

// Ce que le plan supérieur apporte, en une ligne : le propriétaire voit ce qu'il gagnerait.
const UPSELL: Partial<Record<Plan, { to: string; gain: string }>> = {
  free: { to: "Pro", gain: "500 produits, équipe de 5, import et clés API" },
  pro: { to: "Business", gain: "Équipe de 20 et produits illimités" },
};

/**
 * Barre latérale de l'espace marchand. Vérifie aussi l'appartenance : une boutique dont on n'est pas
 * membre donne 404, comme côté API (on n'apprend pas qu'elle existe).
 */
export async function Sidebar({ slug }: { slug: string }) {
  const [shops, me, unread] = await Promise.all([getMyShops(), getMe(), getUnreadTeamNotes(slug)]);
  if (!shops.ok || !me.ok) throw new Error("Impossible de charger votre compte.");
  const current = shops.data.find((shop) => shop.slug === slug);
  if (!current) notFound();
  const can = (permission: string) => current.permissions.includes(permission);
  const counts = can("orders.view") ? await getOrderCounts(slug) : null;
  const toProcess = counts?.ok ? counts.data.pending + counts.data.confirmed + counts.data.shipped : 0;
  const upsell = current.role === "owner" ? UPSELL[current.plan] : undefined;

  return (
    <aside
      aria-label="Espace marchand"
      // Compacte (la hauteur de son contenu) et collée : elle reste à portée pendant qu'on fait défiler la page.
      className="vitre sans-barre sticky top-3 z-10 col-span-4 flex items-center gap-2.5 overflow-x-auto rounded-[20px] p-2 md:top-[18px] md:col-span-8 lg:top-5 lg:col-span-2 lg:max-h-[calc(100dvh-2.5rem)] lg:flex-col lg:items-stretch lg:gap-5 lg:self-start lg:overflow-x-hidden lg:overflow-y-auto lg:rounded-[26px] lg:px-3.5 lg:py-5"
    >
      <Link href={`/app/${slug}`} className="shrink-0 px-1.5 lg:px-2.5">
        <Logo />
      </Link>

      <ShopSwitcher current={current} shops={shops.data} />

      <NavLinks slug={slug} role={current.role} permissions={current.permissions} unreadNotes={unread.ok ? unread.data.length : 0} toProcess={toProcess} />

      <div className="ml-auto flex shrink-0 items-center gap-2 lg:mt-auto lg:ml-0 lg:flex-col lg:items-stretch">
        <ModeToggle compact />
        {upsell ? (
          <Link
            href={`/app/${slug}/parametres`}
            className="group hidden items-start gap-3 rounded-[18px] border border-trait bg-(--surface-2) px-3 py-3 transition-colors hover:border-orange-clair/50 lg:flex"
          >
            <svg viewBox="0 0 24 24" className="mt-0.5 size-[18px] shrink-0 text-orange-clair transition-transform group-hover:-translate-y-0.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M13 3L5 13.5h6L10 21l8-10.5h-6z" />
            </svg>
            <span>
              <span className="block text-[13.5px] font-bold">Passer à {upsell.to}</span>
              <span className="block text-xs leading-snug text-texte-3">{upsell.gain}</span>
            </span>
          </Link>
        ) : null}
        <div className="hidden rounded-2xl border border-trait bg-(--surface-2) px-3 py-2.5 lg:block">
          <p className="truncate text-[13px] font-semibold">
            {me.data.first_name} {me.data.last_name}
          </p>
          <p className="text-xs text-texte-3">
            {ROLE_LABEL[current.role]} · {current.name}
          </p>
          {me.data.mfa_enabled ? null : (
            <Link href={`/app/${slug}/securite`} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-alerte hover:underline">
              <span aria-hidden className="size-1.5 rounded-full bg-ocre" />
              Activer la double authentification
            </Link>
          )}
        </div>
        <form action={logout}>
          <button
            type="submit"
            className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm whitespace-nowrap text-texte-3 hover:bg-white/5 hover:text-texte"
          >
            <svg viewBox="0 0 24 24" className="size-[17px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" />
              <path d="M15 8l4 4-4 4M19 12H9" />
            </svg>
            Déconnexion
          </button>
        </form>
      </div>
    </aside>
  );
}

/**
 * La boutique ouverte, en tête du menu. Avec plusieurs boutiques, la carte s'ouvre (sans JavaScript,
 * <details>) sur la liste des autres.
 */
function ShopSwitcher({ current, shops }: { current: ShopMembership; shops: ShopMembership[] }) {
  const card = (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="truncate text-sm font-semibold">{current.name}</span>
      <span className="text-xs text-texte-3">{ROLE_LABEL[current.role]}</span>
    </span>
  );
  const box = "flex w-full items-center justify-between gap-2.5 rounded-[16px] border border-trait-doux bg-(--surface-2) px-3.5 py-3";
  if (shops.length < 2) return <div className={`${box} hidden lg:flex`}>{card}</div>;
  return (
    <details className="group relative hidden lg:block">
      <summary className={`${box} cursor-pointer list-none hover:border-trait [&::-webkit-details-marker]:hidden`}>
        {card}
        <svg viewBox="0 0 24 24" className="size-4 shrink-0 text-texte-3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M8 10l4-4 4 4M8 14l4 4 4-4" />
        </svg>
        <span className="sr-only">Changer de boutique</span>
      </summary>
      <nav aria-label="Vos boutiques" className="mt-1.5 flex flex-col gap-0.5 rounded-[16px] border border-trait bg-(--surface) p-1.5">
        {shops.map((shop) => (
          <Link
            key={shop.slug}
            href={`/app/${shop.slug}`}
            aria-current={shop.slug === current.slug ? "page" : undefined}
            className="truncate rounded-xl px-2.5 py-2 text-[13px] text-texte-2 hover:bg-white/5 aria-[current=page]:bg-(--surface-2) aria-[current=page]:text-texte"
          >
            {shop.name}
          </Link>
        ))}
      </nav>
    </details>
  );
}

export function SidebarSkeleton() {
  return <div aria-hidden className="vitre col-span-4 h-[52px] rounded-[20px] md:col-span-8 lg:col-span-2 lg:h-[520px] lg:self-start lg:rounded-[26px]" />;
}
