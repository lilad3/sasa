"use client";

import Link from "next/link";
import { type FormEvent, startTransition, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { photoUrl } from "@/lib/photos";

import { type ProductFormState, saveProduct } from "./actions";
import { ProductThumb } from "./product-rows";
import type { Product } from "./types";

const initial: ProductFormState = {};

type ProductFormProps = { slug: string; product?: Product; categories: string[] };

/**
 * Fiche produit : création (sans `product`) ou modification.
 * L'envoi passe par onSubmit plutôt que par `action` : React viderait sinon les champs après une erreur.
 */
export function ProductForm({ slug, product, categories }: ProductFormProps) {
  const [state, formAction, pending] = useActionState(saveProduct, initial);
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const fields = state.fields ?? {};

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    startTransition(() => formAction(data));
  }

  const external = /^https:\/\/\S+$/i.test(imageUrl.trim()) ? imageUrl.trim() : "";
  // Une photo envoyée passe avant l'adresse externe, comme sur la vitrine.
  const firstPhoto = product?.photos[0];
  const preview = firstPhoto ? photoUrl(slug, firstPhoto) : external;

  return (
    <form onSubmit={submit} noValidate className="col-span-full grid grid-cols-subgrid gap-y-2.5 md:gap-y-3 lg:gap-y-3.5">
      <input type="hidden" name="slug" value={slug} />
      {product ? <input type="hidden" name="product" value={product.id} /> : null}

      <section aria-labelledby="titre-fiche" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-7">
        <h2 id="titre-fiche" className="text-sm text-texte-2">
          Fiche
        </h2>
        {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
        {state.done && !pending ? <FormAlert tone="success">{state.done}</FormAlert> : null}

        <Field id="nom" name="name" label="Nom du produit" defaultValue={product?.name} onChange={(event) => setName(event.target.value)} maxLength={120} required error={fields.name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id="sku"
            name="sku"
            label="Référence (SKU)"
            defaultValue={product?.sku}
            maxLength={40}
            autoCapitalize="characters"
            spellCheck={false}
            required
            hint="Votre code interne, unique dans la boutique. Il sert aussi à l’import CSV."
            error={fields.sku}
            className="font-mono"
          />
          <Field id="prix" name="price" label="Prix (F CFA)" defaultValue={product?.price} inputMode="numeric" required hint="Sans centimes, par exemple 12500." error={fields.price} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="stock" name="stock" label="Stock" defaultValue={product?.stock ?? 0} inputMode="numeric" required error={fields.stock} />
          <Field
            id="seuil"
            name="low_stock_threshold"
            label="Seuil d’alerte"
            defaultValue={product?.low_stock_threshold ?? 5}
            inputMode="numeric"
            hint="À ce stock ou moins, le produit passe en « stock bas » et la vitrine annonce les derniers articles."
            error={fields.low_stock_threshold}
          />
        </div>
        <Field
          id="rayon"
          name="category"
          label="Rayon"
          defaultValue={product?.category}
          list="rayons"
          maxLength={40}
          hint="Facultatif. Les clients filtrent la vitrine par rayon."
          error={fields.category}
        />
        <datalist id="rayons">
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
        <TextArea id="description" name="description" label="Description" defaultValue={product?.description} maxLength={2000} error={fields.description} />
      </section>

      <aside className="col-span-full flex flex-col gap-2.5 md:gap-3 lg:col-span-3 lg:gap-3.5">
        <section aria-labelledby="titre-vitrine" className="vitre flex flex-col gap-4 rounded-[24px] p-[18px]">
          <h2 id="titre-vitrine" className="text-sm text-texte-2">
            Dans la vitrine
          </h2>
          <div className="flex items-center gap-3">
            <ProductThumb name={name || "?"} src={preview || null} className="size-16 rounded-[16px] text-xl" />
            <p className="min-w-0 text-[13px] text-texte-3">
              {firstPhoto ? "Photo principale, choisie dans « Photos »." : preview ? "Aperçu de la photo." : "Sans photo, la vitrine affiche l’initiale du produit."}
            </p>
          </div>
          <Field
            id="image"
            name="image_url"
            type="url"
            label="Ou l’adresse d’une photo en ligne"
            hint="Utilisée seulement sans photo envoyée."
            defaultValue={product?.image_url}
            onChange={(event) => setImageUrl(event.target.value)}
            placeholder="https://…"
            maxLength={200}
            spellCheck={false}
            error={fields.image_url}
          />
          <Toggle name="is_active" defaultChecked={product?.is_active ?? true} label="En vente" hint="Décoché, le produit est masqué de la vitrine mais reste dans vos commandes." />
        </section>

        <div className="flex flex-col gap-2">
          <Button type="submit" pending={pending} pendingLabel="Enregistrement…" className="w-full">
            {product ? "Enregistrer" : "Ajouter le produit"}
          </Button>
          <Link href={`/app/${slug}/produits`} className="rounded-full px-4 py-2.5 text-center text-sm text-texte-2 hover:text-texte">
            Retour au catalogue
          </Link>
        </div>
      </aside>
    </form>
  );
}

function TextArea({ id, label, error, ...props }: { id: string; name: string; label: string; error?: string; defaultValue?: string; maxLength?: number }) {
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={id} className="text-[13px] font-semibold text-texte-2">
        {label}
      </label>
      <textarea
        id={id}
        rows={5}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-erreur` : undefined}
        {...props}
        className={cn(
          "w-full resize-y rounded-champ border border-white/15 bg-encre/45 px-[15px] py-[13px] text-base text-texte outline-none transition-[border-color,box-shadow]",
          "placeholder:text-texte-3 focus-visible:border-orange focus-visible:shadow-[0_0_0_3px_rgb(255_122_31/0.28)] focus-visible:outline-none",
          error && "border-danger",
        )}
      />
      {error ? (
        <p id={`${id}-erreur`} className="text-[13px] text-danger-clair">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Case à cocher dessinée (la native est blanche) : une glissière sombre, l'orange quand elle est active. */
function Toggle({ name, label, hint, defaultChecked }: { name: string; label: string; hint: string; defaultChecked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} className="peer sr-only" />
      <span
        aria-hidden
        className="relative mt-0.5 h-6 w-10 shrink-0 rounded-full border border-white/20 bg-encre/60 transition-colors peer-checked:border-orange/60 peer-checked:bg-orange/35 peer-focus-visible:shadow-[0_0_0_3px_rgb(255_122_31/0.35)] after:absolute after:top-[3px] after:left-[3px] after:size-4 after:rounded-full after:bg-texte-2 after:transition-transform peer-checked:after:translate-x-4 peer-checked:after:bg-creme"
      />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-[13px] text-texte-3">{hint}</span>
      </span>
    </label>
  );
}
