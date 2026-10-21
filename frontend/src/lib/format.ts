// Mise en forme pour la Côte d'Ivoire : montants entiers en FCFA, dates à l'heure d'Abidjan (UTC+0).
import type { OrderStatus, PaymentMethod, Role } from "./types";

const integer = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 0 });
const twoDecimals = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

/** 4 812 500 */
export function formatNumber(value: number) {
  return integer.format(value);
}

/** « 4 812 500 F » */
export function formatFcfa(value: number) {
  return `${integer.format(value)} F`;
}

/** Montant court pour les petites cartes : [« 1,25 », « M F »] ou [« 945 », « k F »]. */
export function compactFcfa(value: number): [string, string] {
  if (value >= 1_000_000) return [twoDecimals.format(value / 1_000_000), " M F"];
  if (value >= 10_000) return [integer.format(Math.round(value / 1000)), " k F"];
  return [integer.format(value), " F"];
}

/** Variation en % entre deux périodes ; null quand la période précédente est vide. */
export function variation(value: number, previous: number): number | null {
  if (!previous) return null;
  return ((value - previous) / previous) * 100;
}

export function formatVariation(percent: number) {
  const sign = percent > 0 ? "+" : percent < 0 ? "−" : "";
  return `${sign}${oneDecimal.format(Math.abs(percent))} %`;
}

const dateTime = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const shortDate = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", day: "numeric", month: "short" });
const longDate = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", weekday: "long", day: "numeric", month: "long" });

export function formatDateTime(iso: string) {
  return dateTime.format(new Date(iso));
}

/** Une date « AAAA-MM-JJ » de l'API, sans décalage de fuseau. */
export function formatDay(day: string) {
  return shortDate.format(new Date(`${day}T12:00:00Z`));
}

export function formatToday(date = new Date()) {
  const text = longDate.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** « +225 07 08 09 10 11 » : un numéro ivoirien se lit par paires. */
export function formatPhone(phone: string) {
  const match = /^\+225(\d{10})$/.exec(phone);
  if (!match) return phone;
  return `+225 ${match[1].replace(/(\d{2})(?=\d)/g, "$1 ")}`;
}

/** « il y a 5 min », « il y a 3 h », puis la date. */
export function formatSince(iso: string, now = Date.now()) {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "à l’instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  if (minutes < 24 * 60) return `il y a ${Math.round(minutes / 60)} h`;
  return `le ${formatDateTime(iso)}`;
}

export const STATUS_LABEL: Record<OrderStatus, string> = {
  pending: "En attente",
  confirmed: "Confirmée",
  shipped: "Expédiée",
  delivered: "Livrée",
  cancelled: "Annulée",
};

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  cash_on_delivery: "À la livraison",
  orange_money: "Orange Money",
  mtn_momo: "MTN MoMo",
  moov_money: "Moov Money",
  wave: "Wave",
};

export const ROLE_LABEL: Record<Role, string> = {
  owner: "Propriétaire",
  manager: "Gérant",
  seller: "Vendeur",
};
