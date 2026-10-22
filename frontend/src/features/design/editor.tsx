"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { FormAlert } from "@/features/auth/form-alert";
import { ACCENTS } from "@/features/storefront/accent";
import { cn } from "@/lib/cn";
import { encodeDesign, MOTION_LABEL, SECTION_LABEL, THEME_META } from "@/lib/design";
import { formatDateTime } from "@/lib/format";
import { type DesignOverview, type DesignVersion, MOTIONS, SECTION_IDS, type SectionId, type StorefrontDesign, type ThemeId } from "@/lib/types";

import { type DesignResult, discardDesign, publishDesign, restoreDesign, saveDesign } from "./actions";

const PLAN_LABEL = { free: "Gratuit", pro: "Pro", business: "Business" } as const;
const ACCENT_LABEL = { orange: "Orange", indigo: "Indigo", ocre: "Ocre", corail: "Corail", lagune: "Lagune" } as const;

// Une vignette par thème, dessinée en CSS : on reconnaît le thème d'un coup d'œil.
const THUMB: Record<ThemeId, string> = {
  essentiel: "bg-[#0e0c0a] [background-image:radial-gradient(circle_at_78%_50%,#ff7a1f_0_14px,transparent_15px),linear-gradient(180deg,transparent_0_60%,#f2b98a_60%)]",
  epicerie: "bg-creme [background-image:linear-gradient(180deg,transparent_0_14px,#f2b33d_14px_24px,transparent_24px),repeating-linear-gradient(180deg,transparent_0_34px,#17110a_34px_35px)]",
  beaute: "[background-image:radial-gradient(circle_at_72%_48%,#f2b33d_0_13px,transparent_14px),linear-gradient(180deg,#fbf3e6_0_58%,#24709f_58%)]",
  artisanat: "bg-[#efe3cc] [background-image:radial-gradient(60%_40%_at_30%_60%,transparent_60%,#17110a_61%_64%,transparent_65%)]",
  "piece-phare": "bg-[#3b2417] [background-image:radial-gradient(60%_60%_at_80%_80%,rgb(242_179_61/0.45),transparent_70%),linear-gradient(180deg,transparent_55%,rgb(14_12_10/0.9))]",
};

type EditorProps = { slug: string; overview: DesignOverview; versions: DesignVersion[]; canManageShop: boolean };

const sameDesign = (a: StorefrontDesign, b: StorefrontDesign) => JSON.stringify(a) === JSON.stringify(b);

/**
 * L'éditeur « Ma boutique » (docs/chantier-p5.md §3.5). Tout se règle dans des listes fermées ;
 * l'aperçu montre le résultat en direct, sans rien enregistrer. Django vérifie le plan à l'enregistrement.
 */
export function DesignEditor({ slug, overview, versions, canManageShop }: EditorProps) {
  const saved = overview.draft?.config ?? overview.published?.config ?? overview.default;
  // Une boutique repassée au plan Gratuit garde ses sections d'avant : on reprend d'office celles du thème,
  // sinon la publication serait refusée sans moyen de les changer (le bloc Sections est verrouillé).
  const [design, setDesign] = useState<StorefrontDesign>(() => {
    const fixed = overview.limits.custom_sections ? null : overview.themes.find((t) => t.id === saved.theme)?.sections;
    return fixed ? { ...saved, sections: fixed } : saved;
  });
  const [sectionsTouched, setSectionsTouched] = useState(false);
  const [notice, setNotice] = useState<DesignResult | null>(null);
  const [pending, startTransition] = useTransition();
  const { limits } = overview;
  const theme = overview.themes.find((t) => t.id === design.theme);
  const locked = theme ? !theme.allowed : false;
  const dirty = !sameDesign(design, saved);

  function update(patch: Partial<StorefrontDesign>) {
    setNotice(null);
    setDesign((current) => ({ ...current, ...patch }));
  }

  function chooseTheme(id: ThemeId) {
    const next = overview.themes.find((t) => t.id === id);
    // Sans sections personnalisées (Gratuit), ou tant qu'on n'y a pas touché : celles du thème.
    update({ theme: id, ...(next && (!limits.custom_sections || !sectionsTouched) ? { sections: next.sections } : {}) });
  }

  function moveSection(section: SectionId, delta: -1 | 1) {
    const list = [...design.sections];
    const index = list.indexOf(section);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    setSectionsTouched(true);
    update({ sections: list });
  }

  function toggleSection(section: SectionId, on: boolean) {
    setSectionsTouched(true);
    update({ sections: on ? [...design.sections, section] : design.sections.filter((s) => s !== section) });
  }

  function run(action: () => Promise<DesignResult>) {
    setNotice(null);
    startTransition(async () => {
      const result = await action();
      // Dans la même transition que la page rafraîchie : le message et l'état à jour arrivent ensemble.
      startTransition(() => {
        if (result.ok && result.config) setDesign(result.config);
        setNotice(result);
      });
    });
  }

  const absent = SECTION_IDS.filter((section) => !design.sections.includes(section));

  return (
    <>
      <div className="col-span-full flex flex-col gap-2.5 md:gap-3 lg:col-span-6 lg:gap-3.5">
        <StatusCard overview={overview} dirty={dirty} slug={slug} />

        <fieldset className="vitre flex flex-col gap-3 rounded-[24px] p-[18px]">
          <legend className="sr-only">Thème</legend>
          <p aria-hidden className="text-sm text-texte-2">
            Thème · selon ce que vous vendez
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {overview.themes.map((option) => {
              const meta = THEME_META[option.id];
              const selected = option.id === design.theme;
              return (
                <label
                  key={option.id}
                  className={cn(
                    "flex cursor-pointer flex-col gap-2 rounded-[18px] border p-3 transition-colors has-focus-visible:ring-2 has-focus-visible:ring-orange-clair",
                    selected ? "border-orange-clair/70 bg-orange/10" : "border-trait-doux bg-encre/40 hover:bg-white/[0.05]",
                  )}
                >
                  <span aria-hidden className={cn("block h-14 rounded-[12px]", THUMB[option.id])} />
                  <span className="flex items-center gap-2 text-[15px] font-semibold">
                    <input type="radio" name="theme" value={option.id} checked={selected} onChange={() => chooseTheme(option.id)} className="size-4 accent-orange" />
                    {meta.label}
                  </span>
                  <span className="text-[12.5px] leading-snug text-texte-3">{meta.forWho}</span>
                  <span className="text-[12.5px] leading-snug text-texte-2">{meta.pitch}</span>
                  <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-semibold", option.allowed ? "text-sable" : "text-ocre")}>
                    <span aria-hidden className="h-3 w-[3px] rounded-sm bg-current" />
                    {option.allowed ? `Plan ${PLAN_LABEL[option.plan]}` : `Plan ${PLAN_LABEL[option.plan]} · aperçu seulement`}
                  </span>
                </label>
              );
            })}
          </div>
          {locked ? (
            <FormAlert tone="info">
              {THEME_META[design.theme].label} est compris à partir du plan {PLAN_LABEL[theme?.plan ?? "pro"]}. Essayez-le dans l’aperçu ; pour le publier,{" "}
              {canManageShop ? (
                <Link href={`/app/${slug}/parametres?onglet=plan`} className="font-semibold underline underline-offset-2">
                  changez de plan
                </Link>
              ) : (
                "le propriétaire doit changer de plan"
              )}
              .
            </FormAlert>
          ) : null}
        </fieldset>

        <div className="grid gap-2.5 md:gap-3 sm:grid-cols-2">
          <fieldset className="vitre flex flex-col gap-2.5 rounded-[24px] p-[18px]">
            <legend className="sr-only">Mouvement</legend>
            <p aria-hidden className="text-sm text-texte-2">
              Mouvement
            </p>
            {MOTIONS.map((motion) => (
              <label key={motion} className="flex cursor-pointer items-start gap-2.5 text-[14px]">
                <input type="radio" name="motion" value={motion} checked={design.motion === motion} onChange={() => update({ motion })} className="mt-1 size-4 accent-orange" />
                <span>
                  {MOTION_LABEL[motion].label}
                  <span className="block text-[12.5px] text-texte-3">{MOTION_LABEL[motion].hint}</span>
                </span>
              </label>
            ))}
            <p className="text-[12px] text-texte-3">Un client qui a demandé « moins d’animations » sur son téléphone ne voit jamais rien bouger.</p>
          </fieldset>

          <fieldset className="vitre flex flex-col gap-2.5 rounded-[24px] p-[18px]">
            <legend className="sr-only">Couverture</legend>
            <p aria-hidden className="text-sm text-texte-2">
              Couverture
            </p>
            <label className="flex cursor-pointer items-start gap-2.5 text-[14px]">
              <input type="radio" name="cover" value="featured" checked={design.cover === "featured"} onChange={() => update({ cover: "featured" })} className="mt-1 size-4 accent-orange" />
              <span>
                Le produit à la une
                <span className="block text-[12.5px] text-texte-3">Celui que vous avez choisi, sinon le plus vendu sur 30 jours.</span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2.5 text-[14px]">
              <input type="radio" name="cover" value="name" checked={design.cover === "name"} onChange={() => update({ cover: "name" })} className="mt-1 size-4 accent-orange" />
              <span>Le nom de la boutique seul</span>
            </label>
            <p className="mt-auto flex items-center gap-2 border-t border-trait-doux pt-2.5 text-[12.5px] text-texte-3">
              <span aria-hidden className="size-4 shrink-0 rounded-full border border-white/20" style={{ background: ACCENTS[overview.accent].hex }} />
              <span>
                Couleur : {ACCENT_LABEL[overview.accent]} ·{" "}
                {canManageShop ? (
                  <Link href={`/app/${slug}/parametres`} className="font-semibold text-sable underline underline-offset-2">
                    à régler dans Paramètres
                  </Link>
                ) : (
                  "réglée par le propriétaire"
                )}
              </span>
            </p>
          </fieldset>
        </div>

        <fieldset disabled={!limits.custom_sections} className="vitre flex flex-col gap-1 rounded-[24px] p-[18px] disabled:opacity-80">
          <legend className="sr-only">Sections, dans l’ordre de la page</legend>
          <p aria-hidden className="pb-1 text-sm text-texte-2">
            Sections, dans l’ordre de la page
          </p>
          {design.sections.map((section, index) => (
            <div key={section} className="flex items-center gap-2 border-b border-trait-doux py-1">
              <label className="flex flex-1 cursor-pointer items-center gap-2.5 text-[14px]">
                <input type="checkbox" checked disabled={section === "collection"} onChange={() => toggleSection(section, false)} className="size-4 accent-orange" />
                {SECTION_LABEL[section]}
                {section === "collection" ? <span className="text-[12px] text-texte-3">toujours là</span> : null}
                {section === "histoire" && !design.texts.story ? <span className="text-[12px] text-texte-3">à écrire plus bas</span> : null}
              </label>
              <button type="button" aria-label={`Monter : ${SECTION_LABEL[section]}`} disabled={index === 0} onClick={() => moveSection(section, -1)} className="grid size-11 place-items-center rounded-full border border-trait text-texte-2 hover:bg-white/10 disabled:opacity-30">
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 15l6-6 6 6" />
                </svg>
              </button>
              <button type="button" aria-label={`Descendre : ${SECTION_LABEL[section]}`} disabled={index === design.sections.length - 1} onClick={() => moveSection(section, 1)} className="grid size-11 place-items-center rounded-full border border-trait text-texte-2 hover:bg-white/10 disabled:opacity-30">
                <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </button>
            </div>
          ))}
          {absent.map((section) => (
            <label key={section} className="flex cursor-pointer items-center gap-2.5 py-2 text-[14px] text-texte-3">
              <input type="checkbox" checked={false} onChange={() => toggleSection(section, true)} className="size-4 accent-orange" />
              {SECTION_LABEL[section]}
            </label>
          ))}
          {!limits.custom_sections ? <p className="pt-2 text-[12.5px] text-texte-3">Plan Gratuit : les sections suivent le thème. Choisir et ordonner : à partir du plan Pro.</p> : null}
        </fieldset>

        <fieldset className="vitre flex flex-col gap-3.5 rounded-[24px] p-[18px]">
          <legend className="sr-only">Textes</legend>
          <p aria-hidden className="text-sm text-texte-2">
            Textes
          </p>
          <TextField
            id="accroche"
            label="Accroche, sous le nom"
            value={design.texts.tagline}
            max={80}
            onChange={(tagline) => update({ texts: { ...design.texts, tagline } })}
            hint="Vide : la description de la boutique."
          />
          <TextField
            id="histoire"
            label="Notre histoire"
            value={design.texts.story}
            max={400}
            multiline
            // Sans le plan Pro, on peut encore effacer une histoire écrite avant : c'est ce qui débloque l'enregistrement.
            disabled={!limits.story && !design.texts.story}
            onChange={(story) => update({ texts: { ...design.texts, story } })}
            hint={
              limits.story
                ? "Qui fabrique, où, depuis quand. Du texte seul : pas de lien ni de mise en forme."
                : design.texts.story
                  ? "Réservé au plan Pro : effacez ce texte pour pouvoir publier."
                  : "À partir du plan Pro."
            }
          />
        </fieldset>

        <div className="vitre sticky bottom-3 z-10 flex flex-col gap-3 rounded-[24px] p-[18px]">
          {notice ? <FormAlert tone={notice.ok ? "success" : "danger"}>{notice.message}</FormAlert> : null}
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              disabled={pending || locked}
              onClick={() => run(() => publishDesign(slug, design))}
              className="bouton-clair min-h-12 rounded-full px-6 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Un instant…" : "Publier sur la vitrine"}
            </button>
            <button
              type="button"
              disabled={pending || locked || !dirty}
              onClick={() => run(() => saveDesign(slug, design))}
              className="bouton-contour min-h-12 rounded-full px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50"
            >
              Enregistrer le brouillon
            </button>
            {overview.draft ? (
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  run(async () => {
                    const result = await discardDesign(slug);
                    return result.ok ? { ...result, config: overview.published?.config ?? overview.default } : result;
                  })
                }
                className="min-h-12 rounded-full px-4 text-sm text-texte-3 hover:text-danger-clair"
              >
                Abandonner le brouillon
              </button>
            ) : null}
          </div>
        </div>

        <Versions versions={versions} keep={limits.versions_kept} pending={pending} onRestore={(number) => run(() => restoreDesign(slug, number))} />
      </div>

      <Preview slug={slug} design={design} />
    </>
  );
}

function StatusCard({ overview, dirty, slug }: { overview: DesignOverview; dirty: boolean; slug: string }) {
  const { published, draft } = overview;
  return (
    <section aria-labelledby="titre-etat" className="vitre flex flex-wrap items-center justify-between gap-3 rounded-[24px] p-[18px]">
      <div className="flex flex-col gap-1">
        <h2 id="titre-etat" className="text-sm text-texte-2">
          En ligne
        </h2>
        <p className="text-[15px]">
          {published
            ? `${THEME_META[published.config.theme].label}, publiée le ${formatDateTime(published.published_at ?? published.updated_at)}${published.published_by_name ? ` par ${published.published_by_name}` : ""}`
            : "Rien n’est encore publié : vos clients voient le thème Essentiel."}
        </p>
        <p aria-live="polite" className="text-[13px] text-texte-3">
          {dirty ? "Modifications non enregistrées." : draft ? `Brouillon enregistré le ${formatDateTime(draft.updated_at)}.` : "Aucun brouillon en cours."}
        </p>
      </div>
      <a href={`/boutique/${slug}`} target="_blank" rel="noopener noreferrer" className="bouton-contour min-h-11 rounded-full px-4 text-sm font-semibold">
        Voir la vitrine
        <span className="sr-only"> (nouvel onglet)</span>
      </a>
    </section>
  );
}

function TextField({
  id,
  label,
  value,
  max,
  onChange,
  hint,
  multiline = false,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  hint: string;
  multiline?: boolean;
  disabled?: boolean;
}) {
  const shared = {
    id,
    value,
    maxLength: max,
    disabled,
    "aria-describedby": `${id}-aide`,
    // Les chevrons sont refusés par Django : on les retire dès la saisie, sans surprise à l'enregistrement.
    onChange: (event: { target: { value: string } }) => onChange(event.target.value.replace(/[<>]/g, "")),
    className:
      "w-full rounded-champ border border-white/15 bg-encre/45 px-[15px] py-3 text-base text-texte outline-none placeholder:text-texte-3 focus-visible:border-orange focus-visible:shadow-[0_0_0_3px_rgb(255_122_31/0.28)] disabled:opacity-60",
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-texte-2">
        {label}
      </label>
      {multiline ? <textarea rows={4} {...shared} className={cn(shared.className, "resize-y")} /> : <input {...shared} />}
      <p id={`${id}-aide`} className="flex justify-between gap-3 text-[12px] text-texte-3">
        <span>{hint}</span>
        <span className="tabular-nums">
          {value.length} / {max}
        </span>
      </p>
    </div>
  );
}

function Versions({ versions, keep, pending, onRestore }: { versions: DesignVersion[]; keep: number; pending: boolean; onRestore: (number: number) => void }) {
  return (
    <section aria-labelledby="titre-versions" className="vitre flex flex-col gap-2 rounded-[24px] p-[18px]">
      <h2 id="titre-versions" className="text-sm text-texte-2">
        Versions publiées · {keep} gardée{keep > 1 ? "s" : ""} avec votre plan
      </h2>
      {versions.length === 0 ? <p className="text-[13.5px] text-texte-3">Aucune pour l’instant.</p> : null}
      <ul className="flex flex-col">
        {versions.map((version) => (
          <li key={version.number} className="flex flex-wrap items-center justify-between gap-2 border-b border-trait-doux py-2.5 last:border-0">
            <span className="text-[14px]">
              Version {version.number} · {THEME_META[version.config.theme].label}
              <span className="block text-[12.5px] text-texte-3">
                {version.published_at ? formatDateTime(version.published_at) : ""}
                {version.published_by_name ? ` · ${version.published_by_name}` : ""}
              </span>
            </span>
            {version.status === "published" ? (
              <span className="text-[12.5px] font-semibold text-indigo-clair">En ligne</span>
            ) : (
              <button type="button" disabled={pending} onClick={() => onRestore(version.number)} className="bouton-contour min-h-11 rounded-full px-4 text-[13px] font-semibold disabled:opacity-50">
                Reprendre celle-ci
              </button>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] text-texte-3">Une publication se défait en un clic : reprenez la version d’avant, puis publiez.</p>
    </section>
  );
}

// Le cadre a la taille réelle de l'écran imité, puis il est réduit pour tenir dans la colonne :
// les media queries et les éléments fixes de la vitrine restent justes.
const DEVICES = {
  phone: { label: "Téléphone", width: 375, height: 740, frame: 12 },
  desktop: { label: "Grand écran", width: 1280, height: 800, frame: 2 },
} as const;

/** L'aperçu en direct : la vraie vitrine, dans un cadre, avec les réglages à l'écran (rien n'est enregistré). */
function Preview({ slug, design }: { slug: string; design: StorefrontDesign }) {
  const [device, setDevice] = useState<keyof typeof DEVICES>("phone");
  const encoded = useMemo(() => encodeDesign(design), [design]);
  const [src, setSrc] = useState(`/apercu/${slug}?c=${encoded}`);
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState<number>(DEVICES.phone.width);

  // On attend une courte pause dans les réglages avant de recharger l'aperçu.
  useEffect(() => {
    const timer = window.setTimeout(() => setSrc(`/apercu/${slug}?c=${encoded}`), 450);
    return () => window.clearTimeout(timer);
  }, [encoded, slug]);

  useEffect(() => {
    const node = box.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => setRoom(entry.contentRect.width));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const { width, height, frame } = DEVICES[device];
  const scale = Math.min(1, room / (width + frame));

  return (
    <section aria-labelledby="titre-apercu" className="vitre col-span-full flex flex-col gap-3 self-start rounded-[24px] p-[18px] lg:sticky lg:top-5 lg:col-span-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="titre-apercu" className="text-sm text-texte-2">
          Aperçu en direct
        </h2>
        <div role="group" aria-label="Taille de l’aperçu" className="flex gap-1 rounded-full border border-trait-doux bg-encre/50 p-1">
          {(Object.keys(DEVICES) as (keyof typeof DEVICES)[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={device === option}
              onClick={() => setDevice(option)}
              className="min-h-9 rounded-full px-3 text-[13px] font-semibold text-texte-3 aria-pressed:bg-white/12 aria-pressed:text-texte"
            >
              {DEVICES[option].label}
            </button>
          ))}
        </div>
      </div>
      <div ref={box} className="w-full">
        <div className="mx-auto" style={{ width: (width + frame) * scale, height: (height + frame) * scale }}>
          <div
            className={cn("origin-top-left overflow-hidden bg-nuit", device === "phone" ? "rounded-[34px] border-[6px] border-[#2a231d] shadow-[0_20px_50px_rgb(0_0_0/0.45)]" : "rounded-[10px] border border-trait")}
            style={{ width: width + frame, height: height + frame, transform: `scale(${scale})` }}
          >
            {/* Même origine, mais sans popup ni navigation de la page qui contient l'éditeur. */}
            <iframe title={`Aperçu de la vitrine : ${DEVICES[device].label.toLowerCase()}`} src={src} sandbox="allow-scripts allow-same-origin allow-forms" className="block" style={{ width, height }} />
          </div>
        </div>
      </div>
      <p className="text-[12.5px] text-texte-3">Vos clients ne voient rien tant que vous n’avez pas publié.</p>
    </section>
  );
}
