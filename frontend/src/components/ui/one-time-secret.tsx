"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Un secret montré une seule fois (mot de passe provisoire, clé API) : Django n'en garde que l'empreinte,
 * personne ne pourra le relire. Le bouton copie dans le presse-papiers ; le texte reste sélectionnable
 * si le navigateur refuse la copie (page en http, permissions).
 */
export function OneTimeSecret({ label, value, children }: { label: string; value: string; children?: React.ReactNode }) {
  const [copied, setCopied] = useState<"ok" | "refused" | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Le secret vient d'apparaître : on y amène le focus pour qu'un lecteur d'écran l'annonce.
  useEffect(() => {
    box.current?.focus();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied("ok");
    } catch {
      setCopied("refused");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2500);
  }

  return (
    <div ref={box} tabIndex={-1} role="status" className="flex flex-col gap-3 rounded-[18px] border border-ocre/40 bg-ocre/[0.08] p-4 outline-none">
      <p className="text-[13px] font-semibold text-ocre">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 rounded-xl bg-encre/60 px-3 py-2.5 font-mono text-[15px] tracking-wide break-all text-texte select-all">{value}</code>
        <button type="button" onClick={copy} className="bouton-nuit rounded-full px-4 py-2 text-sm font-bold">
          {copied === "ok" ? "Copié" : "Copier"}
        </button>
      </div>
      <p aria-live="polite" className="text-[12.5px] text-texte-3">
        {copied === "refused" ? "Le navigateur a refusé la copie : sélectionnez le texte à la main. " : null}
        Notez-le maintenant : il ne sera plus jamais affiché.
      </p>
      {children}
    </div>
  );
}
