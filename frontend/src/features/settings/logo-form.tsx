"use client";

import { type ChangeEvent, type FormEvent, startTransition, useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";

import { type LogoState, removeLogo, uploadLogo } from "./logo-actions";

const initial: LogoState = {};
const ACCEPTED = ["image/png", "image/jpeg", "image/webp"];
const SIDE = 512;

/** Réduit l'image à 512 px au plus, en PNG : l'envoi est léger, même sur un réseau mobile. */
async function shrink(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("image"))), "image/png"));
}

/** Le logo de la boutique : affiché en haut de la vitrine et sur sa couverture. */
export function LogoForm({ slug, logoUrl }: { slug: string; logoUrl: string | null }) {
  const [state, formAction, pending] = useActionState(uploadLogo, initial);
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview.url) : undefined), [preview]);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'aperçu disparaît une fois le logo enregistré
    if (state.done) setPreview(null);
  }, [state.done]);

  async function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setProblem(null);
    if (!file) return;
    if (!ACCEPTED.includes(file.type)) return setProblem("PNG, JPEG ou WebP seulement (pas de SVG ni de GIF).");
    if (file.size > 10 * 1024 * 1024) return setProblem("Image trop lourde : 10 Mo au maximum avant réduction.");
    try {
      const blob = await shrink(file);
      setPreview({ blob, url: URL.createObjectURL(blob) });
    } catch {
      setProblem("Cette image ne s’ouvre pas. Essayez une autre.");
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!preview) return;
    const data = new FormData();
    data.append("slug", slug);
    data.append("logo", preview.blob, "logo.png");
    startTransition(() => formAction(data));
  }

  const shown = preview?.url ?? logoUrl;

  return (
    <section aria-labelledby="titre-logo" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-4">
      <h2 id="titre-logo" className="text-sm text-texte-2">
        Logo de la boutique
      </h2>
      <div className="flex items-center gap-4">
        <div className="grid size-24 shrink-0 place-items-center overflow-hidden rounded-[20px] border border-dashed border-white/25 bg-encre/40">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element -- aperçu local (blob:) ou logo relayé par /boutique/[slug]/logo
            <img src={shown} alt="Logo de la boutique" className="size-full object-contain p-2" />
          ) : (
            <span className="px-2 text-center text-xs text-texte-3">Pas encore de logo</span>
          )}
        </div>
        <p className="text-[13px] text-texte-2">PNG, JPEG ou WebP. Un logo carré, sur fond transparent si possible, se lit le mieux.</p>
      </div>
      {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
      {problem ? <FormAlert tone="danger">{problem}</FormAlert> : null}
      {state.done && !preview ? <FormAlert tone="success">{state.done}</FormAlert> : null}
      <form onSubmit={submit} className="flex flex-wrap items-center gap-2.5">
        <label className="bouton-contour cursor-pointer rounded-full px-5 py-2.5 text-sm font-semibold focus-within:outline-2 focus-within:outline-orange-clair">
          {logoUrl ? "Changer d’image" : "Choisir une image"}
          <input type="file" accept="image/png,image/jpeg,image/webp" onChange={choose} className="sr-only" />
        </label>
        {preview ? (
          <Button type="submit" pending={pending} pendingLabel="Envoi…" className="px-5 py-2.5 text-sm">
            Enregistrer ce logo
          </Button>
        ) : null}
      </form>
      {logoUrl && !preview ? (
        <form action={removeLogo}>
          <input type="hidden" name="slug" value={slug} />
          <button type="submit" className="text-[13px] text-texte-3 hover:text-danger-clair">
            Retirer le logo
          </button>
        </form>
      ) : null}
    </section>
  );
}
