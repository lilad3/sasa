import "server-only";

import Link from "next/link";

import { FondOrange } from "@/components/ui/fond-orange";

/**
 * La vitrine ne peut pas joindre l'API Django (serveur arrêté, mauvaise adresse, délai dépassé).
 * Plutôt qu'une erreur brute, le client voit quoi faire ; le panier, lui, reste dans son navigateur.
 * En développement seulement, un encadré dit au développeur quelle commande lancer.
 */
export function StorefrontUnavailable({ slug }: { slug: string }) {
  const development = process.env.NODE_ENV === "development";
  return (
    <main className="surface-orange relative isolate grid min-h-dvh place-items-center px-4 py-10 scheme-light">
      <FondOrange />
      <div role="alert" className="verre-clair flex w-full max-w-[560px] flex-col items-start gap-4 rounded-[28px] p-6 md:p-8">
        <p className="font-mono text-xs tracking-[0.08em] uppercase">Boutique momentanément injoignable</p>
        <h1 className="large text-[clamp(1.6rem,4vw,2.2rem)] leading-[1.1] font-bold text-balance">
          Impossible d’ouvrir la boutique pour l’instant.
        </h1>
        <p className="text-encre-doux">
          Le serveur ne répond pas. Votre panier est gardé sur cet appareil : réessayez dans un instant, rien n’est perdu.
        </p>
        <div className="flex flex-wrap gap-2">
          {/* Lien classique (pas <Link>) : un vrai rechargement redemande les données au serveur. */}
          <a href={`/boutique/${encodeURIComponent(slug)}`} className="bouton-nuit rounded-full px-5 py-3 font-bold">
            Réessayer
          </a>
          <Link href="/" className="bouton-verre rounded-full px-5 py-3 font-semibold">
            Retour à l’accueil
          </Link>
        </div>

        {development ? (
          <aside className="zone-sombre w-full rounded-[18px] bg-nuit p-4 text-sm text-texte-2">
            <p className="font-mono text-xs tracking-[0.08em] text-sable uppercase">Mode développement</p>
            <p className="mt-2">
              Next n’a pas pu joindre Django à <code className="font-mono text-texte">{process.env.API_URL ?? "(API_URL manquant)"}</code>.
              Vérifiez qu’il tourne dans un autre terminal :
            </p>
            <pre className="mt-2 overflow-x-auto rounded-xl bg-black/40 p-3 font-mono text-[13px] text-texte">
              {"cd backend\n.venv\\Scripts\\python manage.py runserver"}
            </pre>
            <p className="mt-2 text-xs text-texte-3">
              Si Django tourne sur un autre port, corrigez API_URL dans frontend/.env.local, puis relancez npm run dev.
            </p>
          </aside>
        ) : null}
      </div>
    </main>
  );
}
