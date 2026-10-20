import type { Metadata } from "next";

import { FondOrange } from "@/components/ui/fond-orange";
import { LandingIntro } from "@/features/landing/intro";
import { Faq, Features, Footer, Partners, Pricing, Security, Steps } from "@/features/landing/sections";

export const metadata: Metadata = {
  title: { absolute: "Akwaba · La boutique en ligne faite pour vous" },
  description: "Créez votre boutique en ligne, encaissez à la livraison ou par Mobile Money et suivez vos ventes en FCFA.",
};

/**
 * Landing publique : l'animation d'ouverture, puis la présentation du produit. Page statique.
 * La lumière orange vit derrière toute la page ; les sections sombres la recouvrent, les claires la laissent voir.
 */
export default function LandingPage() {
  return (
    <div className="relative isolate">
      <FondOrange />
      <LandingIntro />
      <main>
        <Features />
        <Steps />
        <Security />
        <Partners />
        <Pricing />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
