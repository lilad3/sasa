// Les pouvoirs que le propriétaire peut accorder à un gérant, en plus de ceux de son rôle (docs/chantier-p4.md §A).
// Hors du fichier des Server Actions : un module « use server » n'exporte que des fonctions asynchrones.
export const GRANTABLE = ["team.manage_sellers", "team.presence", "storefront.edit", "discounts.give", "customers.export"] as const;
export type Grant = (typeof GRANTABLE)[number];

export const GRANT_TEXT: Record<Grant, { label: string; help: string }> = {
  "team.manage_sellers": { label: "Gérer les vendeurs", help: "Ajouter ou retirer un vendeur, lui refaire un mot de passe provisoire." },
  "team.presence": { label: "Voir la présence", help: "Qui s’est connecté aujourd’hui, et combien de commandes chacun a traitées." },
  "storefront.edit": { label: "Gérer la vitrine", help: "Changer le logo de la boutique et choisir le produit à la une." },
  "discounts.give": { label: "Offrir des réductions", help: "En % seulement, jusqu’au plafond que vous fixez juste en dessous." },
  "customers.export": { label: "Exporter les clients", help: "Un fichier avec les noms et téléphones, après confirmation de son identité." },
};
