import Link from "next/link";

export default function ShopNotFound() {
  return (
    <section className="vitre col-span-full flex flex-col items-start gap-3 rounded-[24px] p-6">
      <h1 className="text-[clamp(22px,2.4vw,28px)] font-medium tracking-tight">Boutique introuvable</h1>
      <p className="max-w-[60ch] text-texte-2">Cette boutique n’existe pas, ou vous ne faites pas partie de son équipe.</p>
      <Link href="/app" className="rounded-full bg-orange px-5 py-2.5 text-sm font-bold text-encre hover:bg-orange-clair">
        Revenir à mon espace
      </Link>
    </section>
  );
}
