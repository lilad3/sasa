"use client";

import Link from "next/link";
import { type FormEvent, startTransition, useActionState, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { memberPhotoUrl } from "@/lib/photos";

import { type ProductFormState, saveProduct } from "./actions";
import { DetailsSection, PricingSections, StatusSection, StockSettings, TagsSection } from "./product-extras";
import { ProductThumb } from "./product-rows";
import type { Product } from "./types";

const initial: ProductFormState = {};

type ProductFormProps = {
  slug: string;
  product?: Product;
  categories: string[];
  /** Droit products.cost (propriétaire seul) : sans lui, la section « Coût et marge » n'est pas rendue. */
  canCost?: boolean;
  /** Les étiquettes déjà utilisées dans la boutique, proposées à la saisie. */
  tagSuggestions?: string[];
  /** Le secteur de la boutique (P04), qui choisit les détails proposés d'abord ; null : tout est dans « Plus de détails ». */
  sector?: string | null;
};

/**
 * Fiche produit : création (sans `product`) ou modification.
 * L'envoi passe par onSubmit plutôt que par `action` : React viderait sinon les champs après une erreur.
 */
export function ProductForm({ slug, product, categories, canCost = false, tagSuggestions = [], sector = null }: ProductFormProps) {
  const [state, formAction, pending] = useActionState(saveProduct, initial);
  const [imageUrl, setImageUrl] = useState(product?.image_url ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const fields = state.fields ?? {};
  const formRef = useRef<HTMLFormElement>(null);

  // Une erreur du serveur s'affiche sous son champ, et le focus y va.
  useEffect(() => {
    if (state.fields) formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')?.focus?.();
  }, [state.fields]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Le bouton choisi (« Enregistrer en brouillon » ou « Mettre en vente ») donne le statut d'un nouveau produit.
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const data = new FormData(event.currentTarget, submitter);
    startTransition(() => formAction(data));
  }

  const external = /^https:\/\/\S+$/i.test(imageUrl.trim()) ? imageUrl.trim() : "";
  // Une photo envoyée passe avant l'adresse externe, comme sur la vitrine.
  const firstPhoto = product?.photos[0];
  // Un brouillon ou un archivé n'a pas de photo publique : l'équipe passe par la route membre.
  const preview = firstPhoto && product ? memberPhotoUrl(slug, product.id, firstPhoto) : external;

  return (
    <form ref={formRef} onSubmit={submit} noValidate className="col-span-full grid grid-cols-subgrid gap-y-2.5 md:gap-y-3 lg:gap-y-3.5">
      <input type="hidden" name="slug" value={slug} />
      {product ? <input type="hidden" name="product" value={product.id} /> : null}

      <section aria-labelledby="titre-fiche" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-7">
        <h2 id="titre-fiche" className="text-sm text-texte-2">
          Fiche
        </h2>
        {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
        {state.done && !pending ? <FormAlert tone="success">{state.done}</FormAlert> : null}

        <Field id="nom" name="name" label="Nom du produit" defaultValue={product?.name} onChange={(event) => setName(event.target.value)} maxLength={120} required error={fields.name} />
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
        <TextArea id="description" name="description" label="Description" defaultValue={product?.description} maxLength={2000} error={fields.description} />
      </section>

      <div className="col-span-full flex flex-col gap-2.5 md:gap-3 lg:col-span-7 lg:col-start-1 lg:row-start-2 lg:gap-3.5">
        <PricingSections product={product} canCost={canCost} errors={fields} />
        <StockSettings product={product} errors={fields} />
        <TagsSection defaultTags={product?.tags ?? []} suggestions={tagSuggestions} categories={categories} defaultCategory={product?.category ?? ""} errors={fields} />
        <DetailsSection product={product} sector={sector} errors={fields} />
      </div>

      <aside className="col-span-full flex flex-col gap-2.5 md:gap-3 lg:col-span-3 lg:row-span-2 lg:gap-3.5">
        {product ? <StatusSection status={product.status} error={fields.status} /> : null}
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
        </section>

        <div className="flex flex-col gap-2">
          {product ? (
            <Button type="submit" pending={pending} pendingLabel="Enregistrement…" className="w-full">
              Enregistrer
            </Button>
          ) : (
            <>
              <Button type="submit" name="status" value="draft" variant="ghost" pending={pending} pendingLabel="Enregistrement…" className="w-full">
                Enregistrer en brouillon
              </Button>
              <Button type="submit" name="status" value="active" pending={pending} pendingLabel="Enregistrement…" className="w-full">
                Mettre en vente
              </Button>
            </>
          )}
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
