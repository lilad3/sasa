import Link from "next/link";

export default function StorefrontNotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-creme px-4 text-encre scheme-light">
      <div className="flex max-w-[44ch] flex-col items-start gap-4">
        <p className="font-mono text-xs tracking-[0.08em] text-encre-doux uppercase">Boutique introuvable</p>
        <h1 className="large text-3xl font-bold">Cette boutique n’existe pas, ou plus.</h1>
        <p className="text-encre-doux">Vérifiez le lien que l’on vous a envoyé : une lettre a peut-être été oubliée.</p>
        <Link href="/" className="rounded-full bg-orange px-5 py-3 font-semibold text-encre hover:bg-orange-clair">
          Découvrir Akwaba
        </Link>
      </div>
    </main>
  );
}
