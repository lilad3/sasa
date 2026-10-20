import type { NextConfig } from "next";

const production = process.env.NODE_ENV === "production";

// En-têtes de sécurité appliqués à toutes les pages (contrat §2.14).
const securityHeaders = [
  // Personne ne peut afficher Akwaba dans un cadre (protection contre le clickjacking).
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // La page du nouveau mot de passe arrive avec un jeton dans l'URL : il ne doit fuiter vers aucun autre site.
      { source: "/nouveau-mot-de-passe", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
  async redirects() {
    // Les e-mails du backend utilisent ces adresses : on les envoie vers les pages françaises (la requête est conservée).
    return [
      { source: "/login", destination: "/connexion", permanent: false },
      { source: "/forgot-password", destination: "/mot-de-passe-oublie", permanent: false },
      { source: "/reset-password", destination: "/nouveau-mot-de-passe", permanent: false },
    ];
  },
};

export default nextConfig;
