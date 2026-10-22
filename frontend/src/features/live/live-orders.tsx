"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { formatFcfa } from "@/lib/format";

const EVERY_MS = 30_000;
const SLUG = /^[a-z0-9-]{1,60}$/;
const SOUND_KEY = "akwaba:son-commandes";

type Latest = { reference: string; total: number; place: string; created_at: string };
type Poll = { count: number; latest: Latest | null };

function readSound() {
  try {
    return window.localStorage.getItem(SOUND_KEY) === "1";
  } catch {
    return false;
  }
}

function writeSound(on: boolean) {
  try {
    window.localStorage.setItem(SOUND_KEY, on ? "1" : "0");
  } catch {
    // Navigation privée ou stockage bloqué : le réglage vaut pour cette page seulement.
  }
}

function newAudioContext() {
  const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Context ? new Context() : null;
}

/** Deux notes brèves, fabriquées à la volée : pas de fichier son à charger. */
function chime(context: AudioContext) {
  const start = context.currentTime;
  for (const [offset, frequency] of [
    [0, 880],
    [0.16, 1320],
  ]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.25);
  }
}

/**
 * Nouvelles commandes en direct, sur toutes les pages de l'espace marchand : un bandeau, le nombre
 * dans le titre de l'onglet, et un son si on l'a demandé. Le serveur est interrogé toutes les 30 s,
 * jamais quand l'onglet est caché ; la première réponse sert de point de départ.
 */
export function LiveOrders() {
  const router = useRouter();
  const pathname = usePathname();
  // Monté par app/app/layout.tsx : la boutique se lit dans l'adresse (/app/{slug}/…). Sur /app, rien à surveiller.
  const segment = pathname.split("/")[2] ?? "";
  const slug = SLUG.test(segment) ? segment : null;
  const [fresh, setFresh] = useState(0);
  const [latest, setLatest] = useState<Latest | null>(null);
  // Lu au premier rendu : sur le serveur, readSound() répond false, et le bandeau n'existe de toute façon pas encore.
  const [sound, setSound] = useState(readSound);
  const baseline = useRef<number | null>(null);
  const lastCount = useRef<number | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const soundOn = useRef(sound);

  // Son déjà activé lors d'une visite précédente : le navigateur attend un geste avant de jouer quoi que ce soit.
  useEffect(() => {
    if (!soundOn.current) return;
    const unlock = () => {
      audio.current ??= newAudioContext();
      void audio.current?.resume();
    };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => {
      document.removeEventListener("pointerdown", unlock);
      document.removeEventListener("keydown", unlock);
    };
  }, []);

  useEffect(() => {
    if (!slug) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    baseline.current = null;
    lastCount.current = null;

    async function poll() {
      if (stopped) return;
      if (document.visibilityState === "visible") {
        try {
          // redirect: "manual" : une session morte renvoie vers /connexion, on s'arrête au lieu de lire du HTML.
          const response = await fetch(`/app/${slug}/nouvelles-commandes`, { cache: "no-store", redirect: "manual", headers: { Accept: "application/json" } });
          if (response.type === "opaqueredirect" || [401, 403, 404].includes(response.status)) {
            stopped = true;
            return;
          }
          if (response.ok) {
            const data = (await response.json()) as Poll;
            if (baseline.current === null) baseline.current = data.count;
            if (lastCount.current !== null && data.count > lastCount.current && soundOn.current && audio.current) chime(audio.current);
            lastCount.current = data.count;
            setFresh(Math.max(0, data.count - baseline.current));
            setLatest(data.latest);
          }
        } catch {
          // Réseau coupé : on réessaie au prochain tour, sans rien afficher.
        }
      }
      timer = setTimeout(poll, EVERY_MS);
    }

    // Retour sur l'onglet : on regarde tout de suite, sans attendre la fin du tour.
    function onVisible() {
      if (document.visibilityState !== "visible" || stopped) return;
      clearTimeout(timer);
      void poll();
    }

    void poll();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug]);

  // « (2) Vos ventes · Akwaba » : visible même dans un autre onglet. Next réécrit le titre à chaque page, d'où pathname.
  // On ne touche au titre que pour ajouter ou retirer le compteur : pendant un changement de page,
  // le titre est un instant vide, et le réécrire à ce moment-là laisserait l'onglet sans nom.
  useEffect(() => {
    const title = document.title;
    if (!title) return;
    const base = title.replace(/^\(\d+\) /, "");
    if (fresh > 0) document.title = `(${fresh}) ${base}`;
    else if (base !== title) document.title = base;
  }, [fresh, pathname]);

  function acknowledge() {
    baseline.current = lastCount.current;
    setFresh(0);
  }

  function toggleSound() {
    const next = !sound;
    // Le navigateur n'autorise le son qu'après un geste de la personne : ce clic en est un.
    if (next) audio.current ??= newAudioContext();
    if (next && audio.current) chime(audio.current);
    soundOn.current = next;
    setSound(next);
    writeSound(next);
  }

  if (!slug || fresh === 0) return null;

  return (
    <aside
      role="status"
      aria-live="polite"
      className="zone-sombre fixed inset-x-3 bottom-3 z-40 flex flex-col gap-3 rounded-[22px] border border-ocre/40 bg-nuit/92 p-4 text-texte shadow-[0_18px_50px_rgb(0_0_0/0.5)] backdrop-blur-lg sm:inset-x-auto sm:right-5 sm:bottom-5 sm:w-[360px]"
    >
      <div className="flex items-start gap-3">
        <span className="chiffres grid size-11 shrink-0 place-items-center rounded-full bg-ocre text-[22px] font-semibold text-encre">{fresh}</span>
        <div className="min-w-0">
          <p className="font-semibold">
            {fresh > 1 ? `${fresh} nouvelles commandes` : "Nouvelle commande"} en vitrine
          </p>
          {latest ? (
            <p className="truncate text-[13px] text-texte-2">
              <span className="font-mono text-texte">{latest.reference}</span> · {formatFcfa(latest.total)}
              {latest.place ? ` · ${latest.place}` : ""}
            </p>
          ) : null}
          <p className="text-[12.5px] text-texte-3">Le premier qui rappelle le client gagne la vente.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={`/app/${slug}/commandes?statut=pending`}
          onClick={() => {
            acknowledge();
            router.refresh();
          }}
          className="bouton-nuit rounded-full px-4 py-2 text-sm font-bold"
        >
          Voir les commandes
        </Link>
        <button type="button" onClick={acknowledge} className="rounded-full px-3 py-2 text-[13px] text-texte-3 hover:text-texte">
          Plus tard
        </button>
        <button
          type="button"
          onClick={toggleSound}
          aria-pressed={sound}
          className="ml-auto rounded-full border border-trait px-3 py-1.5 text-[12.5px] text-texte-2 hover:text-texte aria-pressed:border-ocre/50 aria-pressed:text-ocre"
        >
          {sound ? "Son activé" : "Activer le son"}
        </button>
      </div>
    </aside>
  );
}
