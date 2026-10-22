"use client";

import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/ui/logo";
import { cn } from "@/lib/cn";
import { CHANNEL_LABEL } from "@/lib/format";
import type { Channel } from "@/lib/types";

/** Un lien par réseau : chaque commande dira d'où elle vient (onglet « Canaux »). */
const READY: Channel[] = ["facebook", "instagram", "tiktok", "sms"];

type ShareCardProps = {
  url: string;
  /** L'adresse telle qu'on la lit : « akwaba.ci/boutique/maison-adjoua ». */
  display: string;
  title: string;
  hint: string;
  shopName: string;
};

/**
 * Le lien de la vitrine, que tout le monde dans l'équipe peut partager : c'est lui qui fait vendre.
 * Copier, envoyer sur WhatsApp (message prêt), ou ouvrir la boutique.
 */
export function ShareCard({ url, display, title, hint, shopName }: ShareCardProps) {
  const [copied, setCopied] = useState(false);
  const [copiedVia, setCopiedVia] = useState<Channel | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Presse-papiers refusé (page non sécurisée, ancien navigateur) : on sélectionne l'adresse pour une copie à la main.
      const range = document.createRange();
      const node = document.getElementById("lien-boutique");
      if (node) {
        range.selectNodeContents(node);
        window.getSelection()?.removeAllRanges();
        window.getSelection()?.addRange(range);
      }
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2200);
  }

  async function copyVia(channel: Channel) {
    try {
      await navigator.clipboard.writeText(`${url}?via=${channel}`);
    } catch {
      return;
    }
    setCopiedVia(channel);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopiedVia(null), 2200);
  }

  const whatsapp = `https://wa.me/?text=${encodeURIComponent(`Découvrez ${shopName} et commandez en ligne : ${url}?via=whatsapp`)}`;

  return (
    <section aria-labelledby="titre-lien" className="carte-une flex h-full flex-col gap-5 rounded-[28px] p-6">
      <div className="flex items-center justify-between gap-3">
        <Logo />
        <span className="inline-flex items-center gap-2 rounded-full bg-sable/15 px-3 py-1 text-xs font-semibold text-sable">
          <span aria-hidden className="pastille-en-ligne size-2 rounded-full bg-orange" />
          En ligne
        </span>
      </div>
      <div className="flex flex-col gap-3">
        <h2 id="titre-lien" className="text-[clamp(22px,2.2vw,28px)] leading-tight font-medium tracking-tight">
          {title}
        </h2>
        <p className="text-[14px] leading-relaxed text-texte-2">{hint}</p>
        <p id="lien-boutique" className="font-mono text-[13.5px] break-all text-sable">
          {display}
        </p>
      </div>
      <div className="mt-auto flex flex-col gap-2.5">
        <button
          type="button"
          onClick={copy}
          className="bouton-clair flex items-center justify-center gap-2.5 rounded-full px-5 py-3.5 text-[15px] font-bold"
        >
          <span className="relative size-[18px]" aria-hidden>
            <svg viewBox="0 0 24 24" className={cn("absolute inset-0 transition-[opacity,transform] duration-300", copied && "scale-50 opacity-0")} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="8" y="8" width="12" height="12" rx="2.5" />
              <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
            </svg>
            <svg viewBox="0 0 24 24" className={cn("absolute inset-0 transition-[opacity,transform] duration-300", !copied && "scale-50 opacity-0")} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </span>
          {copied ? "Lien copié" : "Copier le lien"}
        </button>
        <span aria-live="polite" className="sr-only">
          {copied ? "Le lien de la boutique est copié." : copiedVia ? `Le lien pour ${CHANNEL_LABEL[copiedVia]} est copié.` : ""}
        </span>
        <div className="grid grid-cols-2 gap-2.5">
          <a href={whatsapp} target="_blank" rel="noopener noreferrer" className="bouton-contour flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M4.5 19.5l1.2-3.6A8 8 0 1 1 8.3 18.4z" />
              <path d="M9.2 9.2c.3 2.2 2.2 4.4 4.6 5.2l1.4-1.2 1.8.9c-.2 1-1 1.7-2 1.7-3.5-.3-6.9-3.7-7.2-7.2 0-1 .7-1.8 1.7-2l.9 1.8z" />
            </svg>
            WhatsApp
          </a>
          <a href={url} target="_blank" rel="noopener noreferrer" className="bouton-contour flex items-center justify-center gap-2 rounded-full px-4 py-3 text-sm font-semibold">
            Ouvrir
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M7 17L17 7M9 7h8v8" />
            </svg>
          </a>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-1 gap-y-1 pt-1 text-[13px]">
          <span className="mr-1 text-texte-3">Liens prêts :</span>
          {READY.map((channel, index) => (
            <span key={channel} className="inline-flex items-baseline">
              <button
                type="button"
                onClick={() => copyVia(channel)}
                aria-label={`Copier le lien pour ${CHANNEL_LABEL[channel]}`}
                className="rounded px-1 font-semibold text-texte-2 underline decoration-white/25 underline-offset-[3px] hover:text-texte hover:decoration-sable"
              >
                {copiedVia === channel ? `${CHANNEL_LABEL[channel]} copié` : CHANNEL_LABEL[channel]}
              </button>
              {index < READY.length - 1 ? <span aria-hidden className="text-texte-3">·</span> : null}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
