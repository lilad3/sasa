// Textes affichés selon le code d'erreur de l'API. Le front choisit ses propres mots ; `detail` de Django n'est qu'un secours.
import type { Problem } from "./types";

export type FormError = {
  code: string;
  message: string;
  retryAfter?: number;
  attemptsRemaining?: number;
  requestId?: string;
};

const MESSAGES: Record<string, string> = {
  invalid_credentials: "E-mail ou mot de passe incorrect.",
  account_locked: "Trop de tentatives : ce compte est bloqué temporairement.",
  too_many_requests: "Trop de tentatives depuis cette connexion.",
  mfa_invalid_code: "Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.",
  mfa_token_expired: "Le délai pour saisir le code est dépassé. Reprenez depuis le mot de passe.",
  token_invalid_or_expired: "Ce lien n'est plus valable. Demandez-en un nouveau.",
  validation_error: "Certains champs sont à corriger.",
  demo_restricted: "Action désactivée sur les comptes de démonstration.",
  permission_denied: "Votre rôle ne permet pas cette action.",
  network_error: "Le serveur ne répond pas. Vérifiez votre connexion, puis réessayez.",
  bff_required: "Le serveur est mal configuré : contactez l'exploitant de la plateforme.",
  server_error: "Une erreur inattendue est survenue. Réessayez dans un instant.",
  // Espace marchand
  invalid_transition: "Cette commande a changé de statut entre-temps. La page est à jour : vérifiez avant de continuer.",
  not_found: "Introuvable : cet élément n'existe plus ou n'est pas dans cette boutique.",
  shop_not_empty: "Cette boutique a déjà de vraies commandes : les données de démo ne sont pas ajoutées.",
  reauth_required: "Confirmez votre identité pour continuer.",
  invalid_password: "Mot de passe incorrect.",
  mfa_already_enabled: "La double authentification est déjà active. La page est à jour.",
  mfa_not_enabled: "La double authentification n'est pas active. La page est à jour.",
  mfa_setup_required: "L'activation a expiré : recommencez depuis le début.",
  temporary_password_expired: "Ce mot de passe provisoire a expiré. Demandez-en un nouveau au propriétaire de la boutique.",
  password_change_required: "Choisissez votre mot de passe avant de continuer.",
  plan_limit_reached: "Votre plan actuel ne le permet pas : passez au plan supérieur dans Paramètres.",
  plan_too_small: "Ce plan est trop petit pour votre boutique actuelle.",
  account_exists: "Cette adresse a déjà un compte Akwaba : utilisez une autre adresse pour cette personne.",
  email_taken: "Cette adresse a déjà un compte Akwaba. Connectez-vous, ou utilisez « Mot de passe oublié ».",
  password_already_chosen: "Cette personne a déjà choisi son mot de passe : elle peut le réinitialiser par e-mail.",
  too_many_api_keys: "Trop de clés actives : révoquez-en une avant d'en créer une autre.",
  discount_invalid: "Ce code ne fonctionne pas avec ce numéro. Vérifiez le code et le numéro donné à la boutique.",
  discount_cap_exceeded: "C’est au-delà de votre plafond de remise.",
  discount_kind_forbidden: "Vous pouvez offrir des remises en % seulement.",
  shop_on_vacation: "La boutique est en congé : elle ne prend pas de commande pour le moment.",
  file_too_large: "Fichier trop lourd : 512 Ko au maximum, soit environ 1 000 produits.",
  unsupported_file: "Envoyez un fichier .csv (dans Excel : Fichier, Enregistrer sous, CSV).",
  invalid_event: "Ce réglage n’existe plus. La page est à jour.",
  notifications_disabled: "L’envoi d’e-mails n’est pas encore activé sur ce serveur. Vos choix sont gardés.",
  email_failed: "L’e-mail de test n’a pas pu partir. Réessayez dans un instant ; si cela continue, prévenez la personne qui gère le serveur.",
  // Boutique publique
  out_of_stock: "Un article de votre panier n’a plus assez de stock : la quantité a été ajustée.",
  price_changed: "Le total a changé depuis l’affichage de votre panier. Vérifiez le nouveau montant, puis confirmez.",
  idempotency_conflict: "Votre commande précédente est peut-être déjà enregistrée. Rechargez la page avant de recommencer.",
};

export function messageFor(code: string, fallback?: string) {
  return MESSAGES[code] ?? fallback ?? MESSAGES.server_error;
}

/** Erreur globale d'un formulaire, à partir d'une erreur de l'API. */
export function describeProblem(problem: Problem): FormError {
  return {
    code: problem.code,
    message: messageFor(problem.code, problem.detail),
    retryAfter: problem.retry_after,
    attemptsRemaining: problem.attempts_remaining,
    requestId: problem.status >= 500 ? problem.request_id : undefined,
  };
}

// Codes renvoyés par Django dans errors.password (contrat §3.2).
export const PASSWORD_RULES: Record<string, string> = {
  password_too_short: "Au moins 10 caractères.",
  password_too_long: "128 caractères au maximum.",
  password_too_common: "Ce mot de passe fait partie des plus courants : choisissez-en un autre.",
  password_too_similar: "Trop proche de votre e-mail, de votre nom ou du nom de votre boutique.",
  password_entirely_numeric: "Il ne peut pas contenir uniquement des chiffres.",
  password_local_pattern: "Évitez un mot évident (abidjan, akwaba, babi…) suivi de chiffres.",
};

/** Raisons affichées en haut du formulaire de connexion (?raison=…). */
export const LOGIN_REASONS: Record<string, string> = {
  deconnexion: "Vous êtes déconnecté. À bientôt.",
  session_expiree: "Votre session a expiré. Connectez-vous à nouveau.",
  session_fermee: "Votre session a été fermée depuis un autre appareil ou après un changement de mot de passe.",
  code_expire: "Le délai pour saisir le code est dépassé. Reprenez depuis le mot de passe.",
  mot_de_passe_modifie: "Mot de passe modifié. Connectez-vous avec le nouveau.",
  compte_deverrouille: "Votre compte est déverrouillé. Vous pouvez vous connecter.",
};

/** « 14 min 05 s », « 42 s » */
export function formatWait(seconds: number) {
  const s = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(s / 60);
  const rest = s % 60;
  if (minutes === 0) return `${rest} s`;
  return `${minutes} min ${String(rest).padStart(2, "0")} s`;
}
