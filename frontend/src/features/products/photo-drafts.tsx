"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";

import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";

import { type PhotoState, uploadPhoto } from "./photo-actions";
import { ACCEPTED, MAX_PHOTOS, photoProblem, shrink, UNREADABLE } from "./photo-files";

/** Une photo choisie pendant la création : déjà réduite, pas encore envoyée. `url` est une adresse locale (blob:). */
export type DraftPhoto = { url: string; blob: Blob };

/** Les photos d'un produit pas encore créé : choisies, réduites et rangées dans le navigateur, envoyées à l'enregistrement. */
export function usePhotoDrafts() {
  const [drafts, setDrafts] = useState<DraftPhoto[]>([]);
  const [preparing, setPreparing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Les adresses locales sont libérées au départ de la page, et dès qu'une photo est retirée.
  const current = useRef(drafts);
  useEffect(() => {
    current.current = drafts;
  }, [drafts]);
  useEffect(() => () => current.current.forEach((draft) => URL.revokeObjectURL(draft.url)), []);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files ?? []);
    input.value = "";
    setProblem(null);
    const room = MAX_PHOTOS - drafts.length;
    if (files.length === 0 || room <= 0) return;
    setPreparing(true);
    const added: DraftPhoto[] = [];
    let refused: string | null = files.length > room ? `${MAX_PHOTOS} photos au plus par produit : les premières choisies sont gardées.` : null;
    try {
      for (const file of files.slice(0, room)) {
        const reason = photoProblem(file);
        if (reason) {
          refused = reason;
          continue;
        }
        try {
          const blob = await shrink(file);
          added.push({ url: URL.createObjectURL(blob), blob });
        } catch {
          refused = UNREADABLE;
        }
      }
    } finally {
      setPreparing(false);
      setProblem(refused);
      if (added.length) setDrafts((list) => [...list, ...added].slice(0, MAX_PHOTOS));
    }
  }

  function remove(url: string) {
    URL.revokeObjectURL(url);
    setDrafts((list) => list.filter((draft) => draft.url !== url));
  }

  function makeFirst(url: string) {
    setDrafts((list) => [...list.filter((draft) => draft.url === url), ...list.filter((draft) => draft.url !== url)]);
  }

  return { drafts, preparing, problem, choose, remove, makeFirst };
}

/**
 * Envoie les photos au produit créé, une par une et dans l'ordre : une Server Action accepte 1 Mo,
 * et Django range chaque photo à la première place libre (shops/photos.py), donc la première reste la principale.
 * Une photo refusée pour elle-même n'arrête pas les suivantes ; un réseau coupé ou une limite atteinte, si.
 */
export async function sendDrafts(slug: string, productId: string, drafts: DraftPhoto[], onStep: (position: number) => void) {
  let sent = 0;
  let reason: string | undefined;
  for (const [index, draft] of drafts.entries()) {
    onStep(index + 1);
    const data = new FormData();
    data.append("slug", slug);
    data.append("product", productId);
    data.append("photo", draft.blob, "photo");
    let outcome: PhotoState;
    try {
      outcome = await uploadPhoto({}, data);
    } catch {
      break;
    }
    if (!outcome.error) {
      sent += 1;
      continue;
    }
    reason ??= outcome.error.code;
    if (!SKIPPABLE.has(outcome.error.code)) break;
  }
  return { sent, reason };
}

const SKIPPABLE = new Set(["unsupported_file", "file_too_large"]);

type DraftPhotosProps = ReturnType<typeof usePhotoDrafts> & { productName: string; locked: boolean };

/** La zone Photos du formulaire de création : même dessin que le bloc Photos de la fiche (photos.tsx). */
export function DraftPhotos({ drafts, preparing, problem, choose, remove, makeFirst, productName, locked }: DraftPhotosProps) {
  const busy = preparing || locked;

  return (
    <div role="group" aria-labelledby="titre-photos" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p id="titre-photos" className="text-[13px] font-semibold text-texte-2">
          Photos
        </p>
        <p className="text-[12.5px] text-texte-3">
          {drafts.length} sur {MAX_PHOTOS} · la première est la principale
        </p>
      </div>
      {problem ? <FormAlert tone="danger">{problem}</FormAlert> : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {drafts.map((draft, index) => (
          <li key={draft.url} className="flex flex-col gap-2">
            <div className="relative aspect-square overflow-hidden rounded-[18px] border border-trait-doux bg-encre/60">
              {/* eslint-disable-next-line @next/next/no-img-element -- adresse locale (blob:), jamais envoyée ni publique */}
              <img src={draft.url} alt={`Photo ${index + 1} de ${productName || "votre produit"}`} className="size-full object-cover" />
              {index === 0 ? (
                <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-nuit/80 px-2.5 py-1 text-[12px] font-semibold text-sable backdrop-blur">
                  <span aria-hidden className="h-3 w-1 rounded-sm bg-current" />
                  Principale
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
              {index > 0 ? (
                <button
                  type="button"
                  onClick={() => makeFirst(draft.url)}
                  disabled={locked}
                  className="rounded-full px-2 py-1 text-[13px] font-semibold text-indigo-clair hover:underline disabled:opacity-60"
                >
                  Mettre en premier
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => remove(draft.url)}
                disabled={locked}
                aria-label={`Retirer la photo ${index + 1}`}
                className="rounded-full px-2 py-1 text-[13px] text-texte-3 hover:text-danger-clair disabled:opacity-60"
              >
                Retirer
              </button>
            </div>
          </li>
        ))}
        {drafts.length < MAX_PHOTOS ? (
          <li>
            <label
              className={cn(
                "flex aspect-square cursor-pointer flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-white/25 bg-encre/40 px-3 text-center text-[13px] font-semibold text-texte-2 transition-colors hover:border-sable/60 hover:text-texte",
                "focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-orange-clair",
                busy && "pointer-events-none opacity-60",
              )}
            >
              <svg viewBox="0 0 24 24" className="size-7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4.5 8.5A2 2 0 0 1 6.5 6.5h1.6l1.3-2h5.2l1.3 2h1.6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2z" />
                <circle cx="12" cy="12.6" r="3.1" />
                <path d="M18.6 3.2v3.4M16.9 4.9h3.4" />
              </svg>
              <span aria-live="polite">{preparing ? "Préparation…" : drafts.length === 0 ? "Ajouter une photo" : "Ajouter une autre photo"}</span>
              <input type="file" accept={ACCEPTED.join(",")} multiple onChange={choose} disabled={busy} className="sr-only" />
            </label>
          </li>
        ) : null}
      </ul>
      <p className="text-[12.5px] text-texte-3">
        PNG, JPEG ou WebP. La photo est réduite dans votre navigateur, puis redessinée par Akwaba : sa position GPS et les infos de l’appareil disparaissent.
      </p>
    </div>
  );
}
