"use client";

import Link from "next/link";

import { FondOrange } from "@/components/ui/fond-orange";

/** Erreur inattendue dans la vitrine (le cas « serveur injoignable » a sa propre page, sans passer par ici). */
export default function StorefrontError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="surface-orange relative isolate grid min-h-dvh place-items-center px-4 py-10 scheme-light">
      <FondOrange />
      <div role="alert" className="verre-clair flex w-full max-w-[520px] flex-col items-start gap-4 rounded-[28px] p-6 md:p-8">
        <h1 className="large text-[clamp(1.5rem,4vw,2rem)] leading-[1.1] font-bold">La boutique n’a pas pu s’afficher.</h1>
        <p className="text-encre-doux">Un incident inattendu est survenu. Votre panier est gardé sur cet appareil : réessayez.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={retry} className="bouton-nuit rounded-full px-5 py-3 font-bold">
            Réessayer
          </button>
          <Link href="/" className="bouton-verre rounded-full px-5 py-3 font-semibold">
            Retour à l’accueil
          </Link>
        </div>
      </div>
    </main>
  );
}
