"use client";

import { type KeyboardEvent, useId, useState } from "react";

import { Field } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";

import type { ProductField } from "./actions";
import type { Product, ProductStatus } from "./types";

type Errors = Partial<Record<ProductField, string>>;

/** Une section de la fiche : un titre, un contenu, le verre `vitre` des autres cartes. */
export function Section({ id, title, children, className }: { id: string; title: string; children: React.ReactNode; className?: string }) {
  return (
    <section aria-labelledby={id} className={cn("vitre flex flex-col gap-4 rounded-[24px] p-[18px]", className)}>
      <h2 id={id} className="text-sm text-texte-2">
        {title}
      </h2>
      {children}
    </section>
  );
}

/* ---------- Statut ---------- */

const STATUSES: { value: ProductStatus; label: string; hint: string }[] = [
  { value: "draft", label: "Brouillon", hint: "Pas visible sur la vitrine." },
  { value: "active", label: "Actif", hint: "Visible et commandable." },
  { value: "archived", label: "Archivé", hint: "Rangé, garde son historique." },
];

/** Trois choix en toutes lettres, avec une phrase chacun. Django retire la une quand le produit quitte « Actif ». */
export function StatusSection({ status, error }: { status: ProductStatus; error?: string }) {
  return (
    <Section id="titre-statut" title="Statut">
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Statut du produit</legend>
        {STATUSES.map((entry) => (
          <label key={entry.value} className="flex min-h-12 cursor-pointer items-start gap-3 rounded-[14px] border border-trait-doux bg-encre/30 px-3.5 py-2.5 has-[:checked]:border-orange/60 has-[:checked]:bg-orange/10">
            <input type="radio" name="status" value={entry.value} defaultChecked={status === entry.value} className="mt-1 size-4 accent-orange" />
            <span className="flex flex-col">
              <span className="text-sm font-semibold">{entry.label}</span>
              <span className="text-[13px] text-texte-3">{entry.hint}</span>
            </span>
          </label>
        ))}
        {error ? (
          <p role="alert" className="text-[13px] text-danger-clair">
            {error}
          </p>
        ) : null}
      </fieldset>
    </Section>
  );
}

/* ---------- Prix, coût et marge ---------- */

function digits(value: string) {
  const clean = value.replace(/[\s  ]/g, "").replace(/f(cfa)?$/i, "");
  return /^\d+$/.test(clean) ? Number(clean) : null;
}

/**
 * Prix, prix avant réduction (avec un aperçu de la vitrine) et, pour qui a le droit, le coût et la marge.
 * Sans le droit `products.cost`, la section coût n'est pas rendue du tout : le serveur n'envoie même pas la valeur.
 */
export function PricingSections({ product, canCost, errors }: { product?: Product; canCost: boolean; errors: Errors }) {
  const [price, setPrice] = useState(product ? String(product.price) : "");
  const [was, setWas] = useState(product?.compare_at_price ? String(product.compare_at_price) : "");
  const [cost, setCost] = useState(product?.cost != null ? String(product.cost) : "");
  const p = digits(price);
  const w = digits(was);
  const c = digits(cost);
  const percent = p && w && w > p ? Math.floor(((w - p) * 100) / w) : null;
  const margin = p !== null && c !== null ? p - c : null;
  const marginPercent = margin !== null && p ? Math.floor((margin * 200 + p) / (p * 2)) : null;

  return (
    <>
      <Section id="titre-prix" title="Prix">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="prix" name="price" label="Prix (F CFA)" value={price} onChange={(event) => setPrice(event.target.value)} inputMode="numeric" required hint="Sans centimes, par exemple 12500." error={errors.price} />
          <Field
            id="prix-barre"
            name="compare_at_price"
            label="Prix avant réduction"
            value={was}
            onChange={(event) => setWas(event.target.value)}
            inputMode="numeric"
            hint="Affiché barré. Doit être plus élevé que le prix. N’entre dans aucun calcul."
            error={errors.compare_at_price}
          />
        </div>
        {p && w && w > p ? (
          <p className="text-sm text-texte-2" aria-live="polite">
            Sur la vitrine : <span className="font-semibold text-texte">{formatFcfa(p)}</span> <del className="text-texte-3">{formatFcfa(w)}</del>
            {percent ? ` · −${percent} %` : null}
          </p>
        ) : null}
      </Section>

      {canCost ? (
        <Section id="titre-cout" title="Coût et marge">
          <Field
            id="cout"
            name="cost"
            label="Coût par article (F CFA)"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            inputMode="numeric"
            hint="Seul le propriétaire le voit. Il ne s’affiche ni sur la vitrine, ni dans les exports."
            error={errors.cost}
          />
          {margin !== null ? (
            <p aria-live="polite" className={cn("text-sm", margin < 0 ? "text-alerte" : "text-texte-2")}>
              {margin < 0 ? `Vendu à perte : ${formatFcfa(Math.abs(margin))} de moins que le coût.` : `Marge : ${formatFcfa(margin)} · ${marginPercent} %`}
            </p>
          ) : null}
        </Section>
      ) : null}
    </>
  );
}

/* ---------- Stock et précommande ---------- */

/**
 * En création : le stock de départ. En modification, le stock ne se change plus ici (« Ajuster le stock », avec une raison) :
 * on garde le seuil d'alerte et la vente en rupture de stock.
 */
export function StockSettings({ product, errors }: { product?: Product; errors: Errors }) {
  const [backorder, setBackorder] = useState(product?.allow_backorder ?? false);
  return (
    <Section id="titre-stock" title="Stock">
      <div className="grid gap-4 sm:grid-cols-2">
        {product ? (
          <div className="flex flex-col gap-[7px]">
            <span className="text-[13px] font-semibold text-texte-2">Stock actuel</span>
            <p className="text-lg tabular-nums">{formatNumber(product.stock)}</p>
            <p className="text-[13px] text-texte-3">Pour le changer, utilisez « Ajuster le stock » plus bas : chaque variation garde sa raison.</p>
          </div>
        ) : (
          <Field id="stock" name="stock" label="Stock de départ" defaultValue={0} inputMode="numeric" required error={errors.stock} />
        )}
        <Field
          id="seuil"
          name="low_stock_threshold"
          label="Seuil d’alerte"
          defaultValue={product?.low_stock_threshold ?? 5}
          inputMode="numeric"
          hint="À ce stock ou moins, le produit passe en « stock bas » et la vitrine annonce les derniers articles."
          error={errors.low_stock_threshold}
        />
      </div>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" name="allow_backorder" checked={backorder} onChange={(event) => setBackorder(event.target.checked)} className="mt-1 size-4 accent-orange" />
        <span className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold">Continuer à vendre en rupture de stock</span>
          <span className="text-[13px] text-texte-3">Ce qui dépasse le stock devient une précommande, livrée dans le délai que vous indiquez.</span>
        </span>
      </label>
      {backorder ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="delai" name="backorder_days" label="Disponible sous … jours" defaultValue={product?.backorder_days ?? ""} inputMode="numeric" hint="De 1 à 60 jours." error={errors.backorder_days} />
          <Field
            id="plafond"
            name="backorder_limit"
            label="Précommandes ouvertes au plus"
            defaultValue={product?.backorder_limit ?? 20}
            inputMode="numeric"
            hint="Au-delà, la vitrine n’accepte plus de précommande tant que les anciennes ne sont pas prêtes."
            error={errors.backorder_limit}
          />
        </div>
      ) : null}
    </Section>
  );
}

/* ---------- Étiquettes ---------- */

const MAX_TAGS = 10;

/** Saisie d'étiquettes : Entrée ou virgule valide, chaque puce se retire au clavier. Les étiquettes ne sont jamais publiques. */
export function TagsSection({ defaultTags, suggestions, categories, defaultCategory, errors }: { defaultTags: string[]; suggestions: string[]; categories: string[]; defaultCategory: string; errors: Errors }) {
  const [tags, setTags] = useState(defaultTags);
  const [draft, setDraft] = useState("");
  const list = useId();
  const key = (label: string) => label.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

  function add(raw: string) {
    const label = raw.replace(/\s+/g, " ").trim().slice(0, 30);
    if (!label || tags.length >= MAX_TAGS || tags.some((tag) => key(tag) === key(label))) {
      setDraft("");
      return;
    }
    setTags([...tags, label]);
    setDraft("");
  }

  function onKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(draft);
    } else if (event.key === "Backspace" && draft === "" && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  }

  return (
    <Section id="titre-type" title="Type et étiquettes">
      <Field
        id="rayon"
        name="category"
        label="Type de produit"
        defaultValue={defaultCategory}
        list="rayons"
        maxLength={40}
        hint="Facultatif. Les clients filtrent la vitrine par type."
      />
      <datalist id="rayons">
        {categories.map((category) => (
          <option key={category} value={category} />
        ))}
      </datalist>

      <div className="flex flex-col gap-[7px]">
        <label htmlFor="etiquette" className="text-[13px] font-semibold text-texte-2">
          Étiquettes
        </label>
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-trait bg-encre/40 py-1 pr-1 pl-3 text-[13px]">
              {tag}
              <input type="hidden" name="tags" value={tag} />
              <button type="button" onClick={() => setTags(tags.filter((entry) => entry !== tag))} aria-label={`Retirer ${tag}`} className="grid size-8 place-items-center rounded-full text-texte-3 hover:bg-white/10 hover:text-texte">
                ×
              </button>
            </span>
          ))}
        </div>
        <input
          id="etiquette"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKey}
          onBlur={() => add(draft)}
          list={list}
          maxLength={30}
          disabled={tags.length >= MAX_TAGS}
          aria-describedby="etiquette-aide"
          className="w-full rounded-champ border border-white/15 bg-encre/45 px-[15px] py-[13px] text-base text-texte outline-none placeholder:text-texte-3 focus-visible:border-orange disabled:opacity-60"
          placeholder="Fait main, Cadeau…"
        />
        <datalist id={list}>
          {suggestions.filter((label) => !tags.some((tag) => key(tag) === key(label))).map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
        <p id="etiquette-aide" className="text-[13px] text-texte-3">
          Entrée ou virgule pour valider. Elles servent à ranger (« à relancer », « fournisseur X ») et ne sont pas visibles des clients.{" "}
          <span className="tabular-nums">{tags.length} sur {MAX_TAGS}</span>
        </p>
        {errors.tags ? (
          <p role="alert" className="text-[13px] text-danger-clair">
            {errors.tags}
          </p>
        ) : null}
      </div>
    </Section>
  );
}

/* ---------- Détails selon l'activité ---------- */

type DetailKey = "condition" | "warranty_months" | "sold_by" | "one_of_a_kind" | "made_to_order" | "bulky";

// Ce qu'on met en premier plan selon le secteur de la boutique ; tout le reste vit dans « Plus de détails ».
const BY_SECTOR: Record<string, DetailKey[]> = {
  tech: ["condition", "warranty_months"],
  epicerie: ["sold_by"],
  artisanat: ["one_of_a_kind", "made_to_order"],
  maison: ["warranty_months", "bulky"],
};
const ALL: DetailKey[] = ["condition", "warranty_months", "sold_by", "one_of_a_kind", "made_to_order", "bulky"];

/**
 * Le serveur accepte ces champs pour toute boutique ; c'est ici qu'on choisit quoi proposer d'abord, d'après le secteur
 * (null tant que la boutique n'en a pas : tout est alors dans « Plus de détails »).
 */
export function DetailsSection({ product, sector, errors }: { product?: Product; sector: string | null; errors: Errors }) {
  const first = (sector && BY_SECTOR[sector]) || [];
  const rest = ALL.filter((key) => !first.includes(key));
  const filled = rest.some((key) => {
    const value = product?.[key];
    return key === "sold_by" ? value !== "piece" && value !== undefined : Boolean(value);
  });
  const render = (keys: DetailKey[]) => keys.map((key) => <Detail key={key} name={key} product={product} errors={errors} />);
  return (
    <Section id="titre-details" title="Détails selon votre activité">
      {first.length ? <div className="grid gap-4 sm:grid-cols-2">{render(first)}</div> : null}
      <details open={filled || !first.length} className="group">
        <summary className="cursor-pointer text-sm font-semibold text-texte-2 hover:text-texte">Plus de détails</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">{render(rest)}</div>
      </details>
      <p className="text-[13px] text-texte-3">Les quantités sont entières : « au kilo » vend 1, 2, 3 kg, sans décimales.</p>
    </Section>
  );
}

const CONDITIONS = [
  ["", "Non précisé"],
  ["new", "Neuf"],
  ["refurbished", "Reconditionné"],
  ["used", "Occasion"],
] as const;
const SOLD_BY = [
  ["piece", "À la pièce"],
  ["kg", "Au kilo"],
  ["sachet", "Au sachet"],
  ["tas", "Au tas"],
  ["litre", "Au litre"],
] as const;

function Detail({ name, product, errors }: { name: DetailKey; product?: Product; errors: Errors }) {
  if (name === "warranty_months") {
    return <Field id="garantie" name="warranty_months" label="Garantie (mois)" defaultValue={product?.warranty_months ?? ""} inputMode="numeric" hint="De 1 à 60 mois." error={errors.warranty_months} />;
  }
  if (name === "condition" || name === "sold_by") {
    const options = name === "condition" ? CONDITIONS : SOLD_BY;
    const id = name === "condition" ? "etat" : "vendu-par";
    return (
      <div className="flex flex-col gap-[7px]">
        <label htmlFor={id} className="text-[13px] font-semibold text-texte-2">
          {name === "condition" ? "État" : "Vendu"}
        </label>
        <select id={id} name={name} defaultValue={product?.[name] ?? options[0][0]} className="w-full rounded-champ border border-white/15 bg-encre/45 px-[15px] py-[13px] text-base text-texte outline-none focus-visible:border-orange">
          {options.map(([value, label]) => (
            <option key={value} value={value} className="bg-nuit-2">
              {label}
            </option>
          ))}
        </select>
      </div>
    );
  }
  const labels = {
    one_of_a_kind: ["Pièce unique", "La vitrine n’en propose qu’une à la fois."],
    made_to_order: ["Fabriqué sur commande", "Demande la vente en rupture de stock et un délai : c’est le délai de fabrication."],
    bulky: ["Gros colis", "La vitrine prévient que la livraison est à convenir."],
  } as const;
  const [label, hint] = labels[name];
  return (
    <label className="flex cursor-pointer items-start gap-3 sm:col-span-2">
      <input type="checkbox" name={name} defaultChecked={Boolean(product?.[name])} className="mt-1 size-4 accent-orange" />
      <span className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-[13px] text-texte-3">{hint}</span>
        {name === "made_to_order" && errors.made_to_order ? (
          <span role="alert" className="text-[13px] text-danger-clair">
            {errors.made_to_order}
          </span>
        ) : null}
      </span>
    </label>
  );
}
