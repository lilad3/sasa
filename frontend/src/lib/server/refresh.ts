import type { Problem } from "@/lib/types";

/**
 * Le renouvellement a-t-il échoué pour de bon (docs/chantier-p5.md §5.4) ? Session fermée, expirée
 * ou refresh invalide : oui, on efface les cookies. Une panne passagère (réseau, 429 de la limite
 * de débit, erreur 5xx) : non, la session reste, et la requête suivante réessaiera.
 */
export function sessionIsOver(problem: Problem) {
  return problem.status === 400 || problem.status === 401 || problem.status === 403;
}
