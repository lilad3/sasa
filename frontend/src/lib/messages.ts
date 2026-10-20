// Textes affichés selon le code d'erreur de l'API. Le front choisit ses propres mots ; `detail` de Django n'est qu'un secours.

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
};

export function messageFor(code: string, fallback?: string) {
  return MESSAGES[code] ?? fallback ?? MESSAGES.server_error;
}

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
