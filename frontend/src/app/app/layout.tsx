import { Suspense } from "react";

import { LiveOrders } from "@/features/live/live-orders";

/**
 * Tout l'espace marchand (/app…). Seul ajout : l'alerte des nouvelles commandes, qui lit la boutique
 * dans l'adresse. Le décor, la barre latérale et la grille restent dans app/app/[shop]/layout.tsx.
 */
export default function MerchantLayout({ children }: LayoutProps<"/app">) {
  return (
    <>
      {children}
      {/* L'adresse n'est connue qu'à la requête : sans Suspense, Next refuserait de pré-rendre les pages. */}
      <Suspense fallback={null}>
        <LiveOrders />
      </Suspense>
    </>
  );
}
