"use client";

import { useEffect, useState } from "react";

/** Secondes restantes avant de pouvoir réessayer (verrou 423 ou limite 429). */
export function useCountdown(seconds: number | undefined, key: unknown) {
  const [remaining, setRemaining] = useState(0);

  const active = !!seconds && seconds > 0;

  useEffect(() => {
    if (!active) return;
    const endsAt = Date.now() + seconds * 1000;
    const tick = () => setRemaining(Math.max(0, Math.ceil((endsAt - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
    // `key` relance le compte à rebours à chaque nouvelle réponse du serveur, même si la durée est identique.
  }, [active, seconds, key]);

  // Sans attente en cours, on renvoie 0 directement : inutile de remettre l'état à zéro dans l'effet.
  return active ? remaining : 0;
}
