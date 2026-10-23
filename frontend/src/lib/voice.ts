// Les textes de l'espace marchand s'écrivent pour la personne qui les lit (docs/chantier-p4.md).
// Le propriétaire parle de « sa » boutique ; un gérant ou un vendeur lit le nom de la boutique.
// Neutre sur le genre : on cite la personne et son rôle, jamais « la patronne » ni « le patron ».
import { ROLE_LABEL } from "./format";
import type { Goal, Role } from "./types";

/** « d’octobre », « de mai » : élision devant une voyelle (avril, août, octobre). */
export function ofMonth(label: string) {
  return /^[aeiouâéèêîôû]/i.test(label) ? `d’${label}` : `de ${label}`;
}

export function voice(role: Role, shopName: string) {
  const own = role === "owner";
  return {
    own,
    revenue: own ? "Votre chiffre d’affaires" : `Le chiffre d’affaires de ${shopName}`,
    monthRevenue: own ? "Votre chiffre d’affaires du mois" : `Chiffre d’affaires du mois, ${shopName}`,
    monthSales: (label: string) => (own ? `Vos ventes ${ofMonth(label)}` : `Les ventes ${ofMonth(label)} de ${shopName}`),
    topProducts: own ? "Vos produits phares" : `Les produits phares de ${shopName}`,
    bestSellers: "Ce qui se vend le mieux",
    online: own ? "Votre boutique est en ligne" : `${shopName} est en ligne`,
    /** Sur la fiche d'un produit qui vient d'être créé, s'il est en vente. */
    productOnline: own ? "Il est en ligne sur votre vitrine." : `Il est en ligne sur la vitrine de ${shopName}.`,
    shareHint: own
      ? "Partagez son lien sur WhatsApp et Instagram : vos clients commandent directement, vous suivez tout ici."
      : "Partagez son lien à vos contacts : chaque commande arrive ici, et l’équipe s’en occupe.",
    customers: own ? "Vos clients" : `Les clients de ${shopName}`,
    loyal: own ? "Vos clients fidèles" : `Les fidèles de ${shopName}`,
    team: own ? "Mon personnel" : role === "manager" ? "L’équipe" : "Messages",
    allClear: own
      ? "Tout est à jour. Partagez votre lien pour vendre plus."
      : role === "manager"
        ? `Tout est à jour pour ${shopName}.`
        : "Aucune commande à traiter pour l’instant.",
    /** Sous « Offrir une réduction », pour un gérant : le plafond vient du propriétaire. */
    discountCap: (cap: number) => `En % seulement, jusqu’à ${cap} % : c’est votre plafond.`,
    goalSetBy: (goal: NonNullable<Goal["goal"]>) =>
      goal.set_by.is_you ? "Vous l’avez fixé" : `Fixé par ${goal.set_by.name}, ${ROLE_LABEL[goal.set_by.role].toLowerCase()}`,
  };
}

export type Voice = ReturnType<typeof voice>;
