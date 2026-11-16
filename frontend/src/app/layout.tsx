import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Archivo est une police variable : l'axe de largeur (wdth) donne la version étendue des titres.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  axes: ["wdth"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "Akwaba",
    template: "%s · Akwaba",
  },
  description: "La boutique en ligne faite pour vous : votre vitrine, vos ventes en FCFA et votre équipe.",
};

/*
 * Apparence de l'espace marchand (claire ou sombre), posée sur <html> avant le premier affichage :
 * sans ce script, la page s'afficherait d'abord en sombre puis basculerait. Le cookie est écrit par
 * le bouton Clair / Sombre (features/dashboard/mode-toggle.tsx). Ce script ne lit rien d'autre.
 */
const MODE_SCRIPT = `try{document.documentElement.dataset.mode=/(?:^|; *)akwaba_mode=clair(?:;|$)/.test(document.cookie)?"clair":"sombre"}catch(e){}`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-mode est posé par le script avant React : l'écart avec le rendu serveur est voulu.
    <html lang="fr" className={`${archivo.variable} ${plexMono.variable} antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: MODE_SCRIPT }} />
      </head>
      <body className="font-sans">{children}</body>
    </html>
  );
}
