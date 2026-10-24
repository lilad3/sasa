"use client";

import { type ChangeEvent, startTransition, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { memberPhotoUrl } from "@/lib/photos";
import type { ProductPhoto } from "@/lib/types";

import { makeMainPhoto, type PhotoState, removePhoto, uploadPhoto } from "./photo-actions";

const initial: PhotoState = {};
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const MAX_PHOTOS = 3;
// Une Server Action accepte 1 Mo : on vise moins, en baissant la qualité puis la taille s'il le faut.
const TARGET_BYTES = 900 * 1024;
const STEPS: [side: number, quality: number][] = [
  [1200, 0.85],
  [1200, 0.7],
  [960, 0.7],
  [800, 0.6],
];

function encode(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Réduit la photo dans le navigateur (1 200 px au plus) avant l'envoi : léger sur un réseau mobile,
 * et sous la limite des Server Actions. WebP garde la transparence ; un navigateur qui ne sait pas
 * l'écrire envoie du JPEG sur fond blanc. Django redessine de toute façon l'image.
 */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    for (const [side, quality] of STEPS) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) break;
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      let blob = await encode(canvas, "image/webp", quality);
      if (!blob || blob.type !== "image/webp") {
        context.globalCompositeOperation = "destination-over";
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        blob = await encode(canvas, "image/jpeg", quality);
      }
      if (blob && blob.size <= TARGET_BYTES) return blob;
    }
  } finally {
    bitmap.close();
  }
  throw new Error("image");
}

type ProductPhotosProps = { slug: string; productId: string; productName: string; photos: ProductPhoto[] };

/** Les photos d'un produit : 3 au plus, la première est la principale (vignette, cartes et couverture de la vitrine). */
export function ProductPhotos({ slug, productId, productName, photos }: ProductPhotosProps) {
  const [state, formAction, pending] = useActionState(uploadPhoto, initial);
  const [problem, setProblem] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = "";
    setProblem(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setProblem("PNG, JPEG ou WebP seulement (pas de SVG ni de GIF).");
    if (file.size > 15 * 1024 * 1024) return setProblem("Image trop lourde : 15 Mo au maximum avant réduction.");
    setPreparing(true);
    try {
      const blob = await shrink(file);
      const data = new FormData();
      data.append("slug", slug);
      data.append("product", productId);
      data.append("photo", blob, "photo");
      startTransition(() => formAction(data));
    } catch {
      setProblem("Cette image ne s’ouvre pas. Essayez une autre photo.");
    } finally {
      setPreparing(false);
    }
  }

  const busy = pending || preparing;

  return (
    <section aria-labelledby="titre-photos" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-7">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titre-photos" className="text-sm text-texte-2">
          Photos
        </h2>
        <p className="text-[12.5px] text-texte-3">
          {photos.length} sur {MAX_PHOTOS} · la première est la principale
        </p>
      </div>
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      {problem ? <FormAlert tone="danger">{problem}</FormAlert> : null}
      {state.done && !busy ? <FormAlert tone="success">{state.done}</FormAlert> : null}

      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((photo, index) => (
          <PhotoSlot key={photo.id} slug={slug} productId={productId} productName={productName} photo={photo} index={index} />
        ))}
        {photos.length < MAX_PHOTOS ? (
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
              <span aria-live="polite">{busy ? "Envoi…" : photos.length === 0 ? "Ajouter une photo" : "Ajouter une autre photo"}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} disabled={busy} className="sr-only" />
            </label>
          </li>
        ) : null}
      </ul>
      <p className="text-[12.5px] text-texte-3">
        PNG, JPEG ou WebP. La photo est réduite dans votre navigateur, puis redessinée par Akwaba : sa position GPS et les infos de l’appareil disparaissent.
      </p>
    </section>
  );
}

type PhotoSlotProps = { slug: string; productId: string; productName: string; photo: ProductPhoto; index: number };

function PhotoSlot({ slug, productId, productName, photo, index }: PhotoSlotProps) {
  const [mainState, mainAction, moving] = useActionState(makeMainPhoto, initial);
  const [removeState, removeAction, removing] = useActionState(removePhoto, initial);
  const [confirming, setConfirming] = useState(false);
  const error = mainState.error ?? removeState.error;
  const hidden = (
    <>
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="product" value={productId} />
      <input type="hidden" name="photo" value={photo.id} />
    </>
  );

  return (
    <li className="flex flex-col gap-2">
      <div className="relative aspect-square overflow-hidden rounded-[18px] border border-trait-doux bg-encre/60">
        {/* eslint-disable-next-line @next/next/no-img-element -- photo relayée par /app/[shop]/photo (réservée à l’équipe, quel que soit le statut du produit) */}
        <img src={memberPhotoUrl(slug, productId, photo)} alt={`Photo ${index + 1} de ${productName}`} loading="lazy" className="size-full object-cover" />
        {index === 0 ? (
          <span className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-nuit/80 px-2.5 py-1 text-[12px] font-semibold text-sable backdrop-blur">
            <span aria-hidden className="h-3 w-1 rounded-sm bg-current" />
            Principale
          </span>
        ) : null}
      </div>
      {error ? <p className="text-[12.5px] text-danger-clair">{error.message}</p> : null}
      <p aria-live="polite" className="sr-only">
        {mainState.done && !moving ? mainState.done : ""}
      </p>
      {confirming ? (
        <form action={removeAction} className="flex flex-wrap items-center gap-1.5">
          {hidden}
          <Button type="submit" variant="ghost" pending={removing} pendingLabel="…" className="border-danger/50 px-3 py-1.5 text-[13px] text-danger-clair hover:bg-danger/15">
            Retirer
          </Button>
          <button type="button" onClick={() => setConfirming(false)} className="rounded-full px-2.5 py-1.5 text-[13px] text-texte-3 hover:text-texte">
            Garder
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
          {index > 0 ? (
            <form action={mainAction}>
              {hidden}
              <button type="submit" disabled={moving} className="rounded-full px-2 py-1 text-[13px] font-semibold text-indigo-clair hover:underline disabled:opacity-60">
                {moving ? "…" : "Mettre en premier"}
              </button>
            </form>
          ) : null}
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Retirer la photo ${index + 1}`}
            className="rounded-full px-2 py-1 text-[13px] text-texte-3 hover:text-danger-clair"
          >
            Retirer
          </button>
        </div>
      )}
    </li>
  );
}
