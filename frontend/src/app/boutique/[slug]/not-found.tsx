import Link from "next/link";

import { FondOrange } from "@/components/ui/fond-orange";

export default function StorefrontNotFound() {
  return (
    <main className="surface-orange relative isolate grid min-h-dvh place-items-center px-4 scheme-light">
      <FondOrange />
      <div className="flex max-w-[44ch] flex-col items-start gap-4">
        <p className="font-mono text-xs tracking-[0.08em] text-encre uppercase">Boutique introuvable</p>
        <h1 className="large text-3xl font-bold">Cette boutique n’existe pas, ou plus.</h1>
        <p className="text-encre">Vérifiez le lien que l’on vous a envoyé : une lettre a peut-être été oubliée.</p>
        <Link href="/" className="bouton-nuit rounded-full px-5 py-3 font-semibold">
          Découvrir Akwaba
        </Link>
      </div>
    </main>
  );
}
