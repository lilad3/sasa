import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Logo } from "@/components/ui/logo";
import { logout } from "@/features/auth/actions";
import { getMyShops } from "@/lib/server/session";

export const metadata: Metadata = { title: "Espace marchand" };

/** /app : ouvre la première boutique du compte. */
export default function AppHome() {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <Suspense fallback={<p className="text-texte-2">Ouverture de votre espace…</p>}>
        <OpenFirstShop />
      </Suspense>
    </main>
  );
}

async function OpenFirstShop() {
  const shops = await getMyShops();
  if (!shops.ok) throw new Error(shops.problem.detail);
  const first = shops.data[0];
  if (first) {
    // Le vendeur n'a pas accès au chiffre d'affaires : il arrive directement sur les commandes.
    redirect(first.permissions.includes("dashboard.view") ? `/app/${first.slug}` : `/app/${first.slug}/commandes`);
  }
  return (
    <section className="vitre-claire flex max-w-md flex-col gap-4 rounded-vitre p-7">
      <Logo />
      <h1 className="text-2xl font-medium">Aucune boutique liée à ce compte</h1>
      <p className="text-texte-2">Demandez au propriétaire d’une boutique de vous ajouter à son équipe, puis reconnectez-vous.</p>
      <form action={logout}>
        <button type="submit" className="text-sm font-semibold text-sable underline underline-offset-[3px]">
          Se déconnecter
        </button>
      </form>
    </section>
  );
}
