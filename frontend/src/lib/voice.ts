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

/** Textes de « Paiements » et « Livraison » : écrits au « vous » du propriétaire, sans marque de genre. */
export const payoutVoice = {
  payoutChangeWarning:
    "Vous changez le numéro qui reçoit l’argent de vos clients. Pour votre sécurité, confirmez que c’est bien vous. Nous le notons dans le journal et nous vous écrivons par e-mail.",
  payoutReplaceWarning:
    "Un numéro qui en remplace un autre n’est utilisé qu’au bout de 24 h. D’ici là, vos clients voient l’ancien numéro. Vous pouvez annuler l’attente d’un clic.",
  payoutsMissing: "Ajoutez vos numéros Mobile Money",
  missingNumberHint: "Sans numéro, le client verra seulement que la boutique le contactera.",
  deliveryNone: "Ajoutez une zone ou le retrait sur place",
  keepOnePayment: "Gardez au moins un moyen de paiement",
  keepOneOption: "Gardez au moins une zone active ou le retrait sur place",
} as const;

export type Voice = ReturnType<typeof voice>;
