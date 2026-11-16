import { Suspense } from "react";

import { LiveOrders } from "@/features/live/live-orders";

/**
 * Tout l'espace marchand (/app…). « espace » porte l'apparence claire ou sombre (globals.css), y compris
 * pour l'alerte des nouvelles commandes, qui lit la boutique dans l'adresse.
 * La barre latérale et la grille restent dans app/app/[shop]/layout.tsx.
 */
export default function MerchantLayout({ children }: LayoutProps<"/app">) {
  return (
    <div className="espace min-h-dvh">
      {children}
      {/* L'adresse n'est connue qu'à la requête : sans Suspense, Next refuserait de pré-rendre les pages. */}
      <Suspense fallback={null}>
        <LiveOrders />
      </Suspense>
    </div>
  );
}
