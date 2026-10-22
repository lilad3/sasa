import type { Metadata } from "next";
import Link from "next/link";

import { FondOrange } from "@/components/ui/fond-orange";
import { Logo } from "@/components/ui/logo";

export const metadata: Metadata = { title: "Page introuvable", robots: { index: false } };

/** Toute adresse inconnue arrive ici, à la place de la page anglaise et blanche de Next. */
export default function NotFound() {
  return (
    <main className="surface-orange relative isolate grid min-h-dvh place-items-center px-4 py-10 scheme-light">
      <FondOrange />
      <div className="verre-clair flex w-full max-w-[560px] flex-col items-start gap-4 rounded-[28px] p-6 md:p-8">
        <Logo tone="inherit" />
        <p className="font-mono text-xs tracking-[0.08em] uppercase">Erreur 404 · page introuvable</p>
        <h1 className="large text-[clamp(1.6rem,4vw,2.2rem)] leading-[1.1] font-bold text-balance">Cette page n’existe pas, ou plus.</h1>
        <p className="text-encre-doux">
          Le lien est peut-être incomplet, ou la page a déménagé. Si vous cherchiez une boutique, vérifiez son adresse : elle ressemble à
          <span className="font-mono text-encre"> /boutique/nom-de-la-boutique</span>.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/" className="bouton-nuit rounded-full px-5 py-3 font-bold">
            Retour à l’accueil
          </Link>
          <Link href="/app" className="bouton-verre rounded-full px-5 py-3 font-semibold">
            Mon espace marchand
          </Link>
        </div>
      </div>
    </main>
  );
}
