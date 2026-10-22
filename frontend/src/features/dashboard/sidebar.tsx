import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Logo } from "@/components/ui/logo";
import { logout } from "@/features/auth/actions";
import { compactFcfa, ROLE_LABEL } from "@/lib/format";
import { getDashboard, getMe, getMyShops, getOrderCounts, getUnreadTeamNotes } from "@/lib/server/session";
import type { Plan } from "@/lib/types";

import { ProductSwatch } from "./bestsellers";
import { NavLinks } from "./nav-links";

// Ce que le plan supérieur apporte, en une ligne : le propriétaire voit ce qu'il gagnerait.
const UPSELL: Partial<Record<Plan, { to: string; gain: string }>> = {
  free: { to: "Pro", gain: "500 produits, équipe de 5, import et clés API" },
  pro: { to: "Business", gain: "Équipe de 20 et produits illimités" },
};

/** Les 4 meilleures ventes sur 30 jours, sous les rubriques. Le même résumé que la vue d'ensemble : un seul appel. */
async function SidebarBestSellers({ slug }: { slug: string }) {
  const summary = await getDashboard(slug, "30d");
  if (!summary.ok || summary.data.top_products.length === 0) return null;
  return (
    <section aria-labelledby="titre-meilleures" className="hidden flex-col gap-1 border-t border-trait-doux pt-3.5 lg:flex">
      <div className="flex items-baseline justify-between px-2 pb-1.5">
        <h2 id="titre-meilleures" className="text-[13px] text-texte-3">
          Meilleures ventes
        </h2>
        <span className="text-xs text-texte-3">30 j</span>
      </div>
      <ol className="flex flex-col gap-0.5">
        {summary.data.top_products.slice(0, 4).map((product, index) => {
          const [value, unit] = compactFcfa(product.revenue);
          return (
            // Les suivantes s'effacent un peu : l'œil va d'abord à la première.
            <li key={product.id} className="flex items-center gap-3 rounded-xl px-2 py-1.5" style={{ opacity: 1 - index * 0.14 }}>
              <ProductSwatch name={product.name} imageUrl={product.image_url} className="size-9 shrink-0 rounded-full" />
              <span className="min-w-0">
                <span className="block truncate text-[13.5px] font-semibold">{product.name}</span>
                <span className="text-xs text-texte-3 tabular-nums">
                  {value}
                  {unit}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

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
      className="vitre sticky top-3 z-10 col-span-4 flex items-center gap-2.5 overflow-x-auto rounded-[20px] p-2 md:top-[18px] md:col-span-8 lg:top-5 lg:col-span-2 lg:max-h-[calc(100dvh-2.5rem)] lg:flex-col lg:items-stretch lg:gap-4 lg:self-start lg:overflow-x-hidden lg:overflow-y-auto lg:rounded-[26px] lg:px-3 lg:py-4"
    >
      <Link href={`/app/${slug}`} className="shrink-0 px-1.5 lg:px-2 lg:pt-1">
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

      <NavLinks slug={slug} role={current.role} permissions={current.permissions} unreadNotes={unread.ok ? unread.data.length : 0} toProcess={toProcess} />

      {can("dashboard.view") ? (
        <Suspense fallback={null}>
          <SidebarBestSellers slug={slug} />
        </Suspense>
      ) : null}

      <div className="ml-auto flex shrink-0 items-center gap-2 lg:mt-auto lg:ml-0 lg:flex-col lg:items-stretch">
        {upsell ? (
          <Link
            href={`/app/${slug}/parametres`}
            className="group hidden items-start gap-3 rounded-[18px] border border-trait bg-encre/50 px-3 py-3 transition-colors hover:border-orange-clair/50 lg:flex"
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
  return <div aria-hidden className="vitre col-span-4 h-[52px] rounded-[20px] md:col-span-8 lg:col-span-2 lg:h-[520px] lg:self-start lg:rounded-[26px]" />;
}
