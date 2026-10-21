import Link from "next/link";
import { notFound } from "next/navigation";

import { Logo } from "@/components/ui/logo";
import { logout } from "@/features/auth/actions";
import { ROLE_LABEL } from "@/lib/format";
import { getMe, getMyShops, getUnreadTeamNotes } from "@/lib/server/session";

import { NavLinks } from "./nav-links";

/**
 * Barre latérale de l'espace marchand. Vérifie aussi l'appartenance : une boutique dont on n'est pas
 * membre donne 404, comme côté API (on n'apprend pas qu'elle existe).
 */
export async function Sidebar({ slug }: { slug: string }) {
  const [shops, me, unread] = await Promise.all([getMyShops(), getMe(), getUnreadTeamNotes(slug)]);
  if (!shops.ok || !me.ok) throw new Error("Impossible de charger votre compte.");
  const current = shops.data.find((shop) => shop.slug === slug);
  if (!current) notFound();

  return (
    <aside
      aria-label="Espace marchand"
      // Compacte (la hauteur de son contenu) et collée : elle reste à portée pendant qu'on fait défiler la page.
      className="vitre sticky top-3 z-10 col-span-4 flex items-center gap-2.5 overflow-x-auto rounded-[20px] p-2 md:top-[18px] md:col-span-8 lg:top-5 lg:col-span-2 lg:max-h-[calc(100dvh-2.5rem)] lg:flex-col lg:items-stretch lg:gap-3.5 lg:self-start lg:overflow-x-hidden lg:overflow-y-auto lg:rounded-[24px] lg:px-2.5 lg:py-3.5"
    >
      <Link href={`/app/${slug}`} className="shrink-0 px-1.5 lg:px-2 lg:pt-1.5">
        <Logo />
      </Link>

      {shops.data.length > 1 ? (
        <nav aria-label="Vos boutiques" className="hidden flex-col gap-1 lg:flex">
          <span className="px-2.5 text-xs text-texte-3">Vos boutiques</span>
          {shops.data.map((shop) => (
            <Link
              key={shop.slug}
              href={`/app/${shop.slug}`}
              aria-current={shop.slug === slug ? "page" : undefined}
              className="truncate rounded-xl px-2.5 py-2 text-[13px] text-texte-2 hover:bg-white/5 aria-[current=page]:bg-white/10 aria-[current=page]:text-texte"
            >
              {shop.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <NavLinks slug={slug} permissions={current.permissions} unreadNotes={unread.ok ? unread.data.length : 0} />

      <div className="ml-auto flex shrink-0 items-center gap-2 lg:mt-auto lg:ml-0 lg:flex-col lg:items-stretch">
        <div className="hidden rounded-2xl border border-trait bg-encre/50 px-3 py-2.5 lg:block">
          <p className="truncate text-[13px] font-semibold">
            {me.data.first_name} {me.data.last_name}
          </p>
          <p className="text-xs text-texte-3">
            {ROLE_LABEL[current.role]} · {current.name}
          </p>
          {me.data.mfa_enabled ? null : (
            <Link href={`/app/${slug}/securite`} className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-ocre hover:underline">
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

export function SidebarSkeleton() {
  return <div aria-hidden className="vitre col-span-4 h-[52px] rounded-[20px] md:col-span-8 lg:col-span-2 lg:h-[420px] lg:self-start lg:rounded-[24px]" />;
}
