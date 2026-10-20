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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr" className={`${archivo.variable} ${plexMono.variable} antialiased`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
