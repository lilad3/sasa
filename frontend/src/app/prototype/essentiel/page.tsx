import type { Metadata } from "next";

import { PrototypeVitrine } from "@/features/prototype-essentiel/proto";

// Prototype P16 (docs/chantier-a2-essentiel.md) : relié à rien, supprimé à l'étape 2.
export const metadata: Metadata = { title: "Prototype · Essentiel, la photo d’abord", robots: { index: false, follow: false } };

export default function PrototypeEssentielPage() {
  return <PrototypeVitrine />;
}
