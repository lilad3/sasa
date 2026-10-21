import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { FondOrange } from "@/components/ui/fond-orange";
import { Logo } from "@/components/ui/logo";
import { TrackOrder } from "@/features/storefront/track";
import { StorefrontUnavailable } from "@/features/storefront/unavailable";
import { getStorefront } from "@/lib/server/storefront";

export const metadata: Metadata = { title: "Suivre une commande", robots: { index: false } };

/** Suivi public d'une commande : la référence et les 4 derniers chiffres du téléphone, sans compte. */
export default function TrackPage({ params, searchParams }: PageProps<"/boutique/[slug]/suivi">) {
  return (
    <Suspense fallback={<TrackSkeleton />}>
      <TrackFromRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function TrackFromRoute({ params, searchParams }: Pick<PageProps<"/boutique/[slug]/suivi">, "params" | "searchParams">) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const shop = await getStorefront(slug);
  if (!shop.ok) {
    if (shop.problem.code === "network_error") return <StorefrontUnavailable slug={slug} />;
    if (shop.problem.status === 404) notFound();
    throw new Error(shop.problem.detail);
  }
  // Pré-rempli depuis la confirmation de commande. Seuls lettres, chiffres et tiret passent.
  const reference = typeof query.ref === "string" ? query.ref.replace(/[^A-Za-z0-9-]/g, "").slice(0, 12) : "";

  return (
    <main className="surface-orange relative isolate min-h-dvh px-3 pt-3 pb-16 scheme-light md:px-5">
      <FondOrange />
      <div className="mx-auto flex max-w-[760px] flex-col gap-6">
        <header className="verre-clair flex items-center justify-between gap-3 rounded-full py-2 pr-2 pl-5">
          <span className="large truncate text-base font-extrabold">{shop.data.name}</span>
          <Link href={`/boutique/${slug}`} className="bouton-nuit rounded-full px-4 py-2 text-sm font-semibold">
            Retour à la boutique
          </Link>
        </header>
        <div className="flex flex-col gap-2 px-1 pt-4">
          <p className="font-mono text-xs tracking-[0.08em] uppercase">Suivi de commande</p>
          <h1 className="large text-[clamp(1.8rem,5vw,2.8rem)] leading-[1.05] font-bold text-balance">Où en est ma commande ?</h1>
          <p className="max-w-[56ch] text-encre-doux">
            La référence vous a été donnée à la fin de la commande (par exemple K7F-92Q). Pas besoin de compte.
          </p>
        </div>
        <TrackOrder slug={slug} reference={reference} />
        <footer className="flex justify-center pt-4 text-sm">
          <Link href="/" className="inline-flex items-center gap-2 hover:underline">
            Boutique propulsée par <Logo tone="inherit" className="[&_.large]:text-base" />
          </Link>
        </footer>
      </div>
    </main>
  );
}

function TrackSkeleton() {
  return (
    <div aria-hidden className="relative isolate min-h-dvh px-3 pt-3 md:px-5">
      <FondOrange />
      <div className="mx-auto flex max-w-[760px] flex-col gap-6">
        <div className="h-[56px] animate-pulse rounded-full bg-[rgb(255_244_232/0.4)]" />
        <div className="h-[280px] animate-pulse rounded-[24px] bg-[rgb(255_244_232/0.4)]" />
      </div>
    </div>
  );
}
