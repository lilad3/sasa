import type { Metadata } from "next";

import { PrototypeProduit } from "@/features/prototype-essentiel/proto";

// Prototype P16 (docs/chantier-a2-essentiel.md) : relié à rien, supprimé à l'étape 2.
export const metadata: Metadata = { title: "Prototype · Page produit", robots: { index: false, follow: false } };

export default function PrototypeProduitPage() {
  return <PrototypeProduit />;
}
