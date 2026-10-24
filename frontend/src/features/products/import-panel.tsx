"use client";

import Link from "next/link";
import { startTransition, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";
import { formatNumber } from "@/lib/format";
import { formatWait } from "@/lib/messages";

import { importProducts, type ImportState } from "./actions";

const initial: ImportState = {};

const COLUMN_LABEL: Record<string, string> = {
  sku: "Référence",
  name: "Nom",
  price: "Prix",
  stock: "Stock",
  category: "Type de produit",
  description: "Description",
  is_active: "Actif (ancienne colonne)",
  status: "Statut",
  compare_at_price: "Prix avant réduction",
  cost: "Coût",
  tags: "Étiquettes",
  low_stock_threshold: "Seuil",
  image_url: "Photo",
  file: "Fichier",
};

// Point-virgule et BOM : Excel en français ouvre ce fichier directement, accents compris.
const TEMPLATE =
  "﻿sku;nom;prix;prix_barre;stock;categorie;description;statut;seuil;image;etiquettes\n" +
  "PAGNE-001;Pagne wax 6 yards;12500;15000;20;Pagnes;Coton imprimé, motif ananas;actif;5;;Fait main|Cadeau\n" +
  "SAC-014;Sac en raphia tressé;8000;;6;Accessoires;;brouillon;3;;\n";

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "akwaba-modele-produits.csv";
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Import en deux temps : Django vérifie d'abord tout le fichier (dry_run) sans rien enregistrer,
 * puis importe tout ou rien. Le fichier reste en mémoire dans la page entre les deux envois.
 */
export function ImportPanel({ slug }: { slug: string }) {
  const [state, formAction, pending] = useActionState(importProducts, initial);
  const [file, setFile] = useState<File | null>(null);
  // Le rapport affiché porte sur ce fichier-là : en choisir un autre efface l'aperçu.
  const [sentFile, setSentFile] = useState<File | null>(null);
  const [checking, setChecking] = useState(true);

  function send(dryRun: boolean) {
    if (!file) return;
    const data = new FormData();
    data.set("slug", slug);
    data.set("file", file);
    data.set("dry_run", dryRun ? "1" : "0");
    setSentFile(file);
    setChecking(dryRun);
    startTransition(() => formAction(data));
  }

  const current = sentFile !== null && sentFile === file;
  const report = current ? state.report : undefined;
  const imported = report && !report.dry_run && report.error_count === 0;

  return (
    <div className="col-span-full grid grid-cols-subgrid gap-y-2.5 md:gap-y-3 lg:gap-y-3.5">
      <section aria-labelledby="titre-fichier" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-6">
        <h2 id="titre-fichier" className="text-sm text-texte-2">
          1. Votre fichier
        </h2>
        <p className="max-w-[60ch] text-[14.5px] text-texte-2">
          Dans Excel : <span className="text-texte">Fichier &gt; Enregistrer sous &gt; CSV</span>. La première ligne nomme les colonnes ; seule la référence (
          <span className="font-mono">sku</span>) est obligatoire. Une référence qui existe déjà met le produit à jour, une cellule vide ne change rien.
        </p>
        <ul className="carte flex flex-wrap gap-x-4 gap-y-1.5 rounded-carte p-3.5 font-mono text-[13px] text-texte-2">
          {["sku", "nom", "prix", "stock", "prix_barre", "categorie", "description", "statut", "seuil", "image", "etiquettes"].map((column) => (
            <li key={column}>{column}</li>
          ))}
        </ul>
        <button type="button" onClick={downloadTemplate} className="self-start text-sm font-semibold text-sable underline decoration-sable/40 underline-offset-[3px] hover:decoration-sable">
          Télécharger un modèle à remplir
        </button>

        <div className="flex flex-col gap-[7px]">
          <label htmlFor="fichier" className="text-[13px] font-semibold text-texte-2">
            Fichier CSV (512 Ko au plus, 1 000 produits)
          </label>
          <input
            id="fichier"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            className="w-full rounded-champ border border-white/15 bg-encre/45 p-2 text-sm text-texte-2 outline-none focus-visible:border-orange file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-white/10 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-texte hover:file:bg-white/15"
          />
        </div>
        <Button type="button" onClick={() => send(true)} disabled={!file} pending={pending && checking} pendingLabel="Vérification…" className="self-start">
          Vérifier le fichier
        </Button>
      </section>

      <section aria-labelledby="titre-apercu" aria-live="polite" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-4">
        <h2 id="titre-apercu" className="text-sm text-texte-2">
          2. Vérification, puis import
        </h2>

        {current && state.error ? (
          <FormAlert tone="danger">
            <p>{state.error.message}</p>
            {state.error.retryAfter ? <p className="mt-1 font-semibold">Réessayez dans {formatWait(state.error.retryAfter)}.</p> : null}
          </FormAlert>
        ) : null}

        {imported ? (
          <>
            <FormAlert tone="success">
              Import terminé : {formatNumber(report.created)} produit{report.created > 1 ? "s" : ""} ajouté{report.created > 1 ? "s" : ""},{" "}
              {formatNumber(report.updated)} mis à jour.
            </FormAlert>
            <Link href={`/app/${slug}/produits`} className="bouton-nuit self-start rounded-full px-5 py-2.5 text-sm font-bold">
              Voir le catalogue
            </Link>
          </>
        ) : report ? (
          <>
            <dl className="grid grid-cols-3 gap-2">
              <Count label="Lignes lues" value={report.rows} />
              <Count label="À ajouter" value={report.created} />
              <Count label="À mettre à jour" value={report.updated} />
            </dl>
            {report.error_count > 0 ? (
              <>
                <p className="rounded-[16px] border border-ocre/35 bg-ocre/10 px-3.5 py-3 text-sm">
                  <span className="font-semibold text-ocre">
                    {formatNumber(report.error_count)} erreur{report.error_count > 1 ? "s" : ""} à corriger.
                  </span>{" "}
                  Rien n’est importé tant qu’il en reste une : corrigez le fichier, choisissez-le à nouveau, puis vérifiez.
                </p>
                <ul className="flex max-h-[340px] flex-col overflow-y-auto">
                  {report.errors.map((error, index) => (
                    <li key={`${error.line}-${error.field}-${index}`} className="grid grid-cols-[64px_1fr] gap-x-3 border-b border-trait-doux py-2 text-[13px] last:border-0">
                      <span className="font-mono text-texte-3">{error.line > 0 ? `ligne ${error.line}` : "fichier"}</span>
                      <span>
                        <span className="font-semibold">{COLUMN_LABEL[error.field] ?? error.field}</span> : {error.message}
                      </span>
                    </li>
                  ))}
                </ul>
                {report.error_count > report.errors.length ? (
                  <p className="text-[13px] text-texte-3">Les {formatNumber(report.errors.length)} premières sont affichées.</p>
                ) : null}
              </>
            ) : report.rows === 0 ? (
              <p className="text-sm text-texte-2">Ce fichier ne contient aucune ligne de produit sous les noms de colonnes.</p>
            ) : (
              <>
                <p className="text-sm text-texte-2">Tout est bon. L’import enregistre toutes les lignes d’un coup.</p>
                <Button type="button" onClick={() => send(false)} pending={pending && !checking} pendingLabel="Import en cours…" className="self-start">
                  Importer {formatNumber(report.created + report.updated)} produit{report.created + report.updated > 1 ? "s" : ""}
                </Button>
              </>
            )}
          </>
        ) : (
          <p className="text-sm text-texte-3">Choisissez un fichier : vous verrez ce qui sera ajouté ou modifié avant que rien ne soit enregistré.</p>
        )}
      </section>
    </div>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="carte flex flex-col gap-1.5 rounded-[16px] p-3">
      <dt className="text-xs text-texte-3">{label}</dt>
      <dd className="chiffres text-[26px]">{formatNumber(value)}</dd>
    </div>
  );
}
