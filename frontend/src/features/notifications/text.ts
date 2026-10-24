// Libellés et aides des e-mails que le front connaît. Un identifiant inconnu d'ici est ignoré (pas de ligne) :
// un serveur plus récent ne casse pas un front plus ancien (docs/chantier-a2-notifications.md §7.1).
export type EventText = { label: string; what: string; content: string };

export const EVENT_ORDER = ["new_order", "low_stock", "order_cancelled", "daily_summary"] as const;

export const EVENT_TEXT: Record<string, EventText> = {
  new_order: {
    label: "Nouvelle commande",
    what: "Un e-mail à chaque commande, regroupés si elles arrivent en rafale.",
    content: "Référence, nombre d’articles, total, paiement et commune. Jamais le nom ni le téléphone du client.",
  },
  low_stock: {
    label: "Stock bas",
    what: "Quand un produit passe sous son seuil d’alerte ou s’épuise.",
    content: "Les produits concernés et ce qu’il en reste.",
  },
  order_cancelled: {
    label: "Commande annulée",
    what: "Quand une commande est annulée.",
    content: "La référence, le total et l’étape où elle en était.",
  },
  daily_summary: {
    label: "Résumé du jour",
    what: "Chaque soir, ce qui s’est passé aujourd’hui.",
    content: "Commandes reçues, à traiter et livrées.",
  },
};
