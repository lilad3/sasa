"use client";

export default function ShopError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section role="alert" className="vitre col-span-full flex flex-col items-start gap-3 rounded-[24px] p-6">
      <h1 className="text-[clamp(22px,2.4vw,28px)] font-medium tracking-tight">Cette page n’a pas pu se charger</h1>
      <p className="max-w-[60ch] text-texte-2">Le serveur n’a pas répondu comme prévu. Vos données ne sont pas perdues : réessayez dans un instant.</p>
      <button type="button" onClick={reset} className="bouton-nuit rounded-full px-5 py-2.5 text-sm font-bold">
        Réessayer
      </button>
    </section>
  );
}
