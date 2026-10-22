"use client";

import { type CSSProperties, useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber } from "@/lib/format";
import type { Goal } from "@/lib/types";

import { type GoalState, setGoal } from "./goal-actions";

const TICKS = 44;
const initial: GoalState = {};

type GoalGaugeProps = {
  slug: string;
  goal: Goal;
  /** Le propriétaire seul fixe l'objectif (goals.manage, vérifié par Django). */
  canEdit: boolean;
  title: string;
  setBy: string | null;
  /** CA du mois, pour prévoir le % pendant le réglage ; null pour qui ne le voit pas. */
  revenue: number | null;
  /** Montant proposé quand aucun objectif n'est fixé. */
  suggestion: number;
};

/** Jauge en traits verticaux : chaque trait s'allume à son tour jusqu'au % atteint, puis le curseur s'y pose. */
function Ticks({ percent, label }: { percent: number; label: string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(percent));
    return () => cancelAnimationFrame(frame);
  }, [percent]);
  const lit = Math.round((Math.min(shown, 100) / 100) * TICKS);
  const knob = Math.min(shown, 100);

  return (
    <div className="relative pt-12 pb-1" aria-hidden>
      <span
        className="absolute top-0 -translate-x-1/2 rounded-full border border-white/15 bg-nuit-2/90 px-3 py-1.5 text-[13px] font-bold whitespace-nowrap transition-[left] duration-1000 ease-out"
        style={{ left: `clamp(70px, ${knob}%, calc(100% - 70px))` }}
      >
        {label}
      </span>
      <div className="relative flex h-9 items-stretch justify-between">
        {Array.from({ length: TICKS }, (_, i) => (
          <span
            key={i}
            className={cn("trait-jauge w-[3px] rounded-full", i < lit && "trait-jauge-allume")}
            style={{ "--i": i } as CSSProperties}
          />
        ))}
        <span
          className="absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-sable bg-encre shadow-[0_0_0_5px_rgb(255_122_31/0.25),0_0_18px_rgb(255_122_31/0.55)] transition-[left] duration-1000 ease-out"
          style={{ left: `${knob}%` }}
        />
      </div>
    </div>
  );
}

export function GoalGauge({ slug, goal, canEdit, title, setBy, revenue, suggestion }: GoalGaugeProps) {
  const current = goal.goal;
  const [state, formAction, pending] = useActionState(setGoal, initial);
  const start = current?.amount ?? suggestion;
  const [amount, setAmount] = useState(start);
  const [touched, setTouched] = useState(false);
  // Bornes du curseur : de la moitié au triple du point de départ, par pas de 50 000 F.
  const min = Math.max(50_000, Math.round(start / 2 / 50_000) * 50_000);
  const max = Math.max(min + 500_000, Math.round((start * 3) / 50_000) * 50_000);
  // L'aperçu ne s'affiche qu'une fois le curseur touché : avant, la jauge montre l'objectif réel.
  const editing = canEdit && touched && amount !== current?.amount;
  // Pendant le réglage, la jauge montre le % qu'aurait l'objectif choisi avec le CA déjà fait.
  const percent = editing && revenue !== null ? (revenue / amount) * 100 : (current?.percent ?? 0);
  const percentText = `${formatNumber(Math.round(percent))} %`;

  return (
    <section aria-labelledby="titre-objectif" className="carte-objectif flex h-full flex-col gap-3 rounded-[24px] p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 id="titre-objectif" className="text-[clamp(19px,1.8vw,23px)] font-medium tracking-tight">
            {title}
          </h3>
          <p className="mt-1 text-[13.5px] text-texte-2">
            {current?.amount != null ? formatFcfa(current.amount) : current ? "Suivez la progression de l’équipe" : "Pas encore fixé"}
          </p>
        </div>
        {current ? (
          <span className={cn("rounded-full border px-3 py-1 text-[13px] font-semibold", current.reached ? "border-orange-clair/50 text-orange-clair" : "border-white/15 text-texte-2")}>
            {current.reached ? "Atteint" : percentText}
          </span>
        ) : null}
      </div>

      {current || editing ? (
        <Ticks percent={percent} label={editing ? `Avec ${formatFcfa(amount)} · ${percentText}` : `Aujourd’hui · ${percentText}`} />
      ) : (
        <p className="py-4 text-sm text-texte-3">{canEdit ? "Fixez un objectif : toute l’équipe sera prévenue." : "Aucun objectif fixé pour ce mois."}</p>
      )}
      <p className="sr-only">{current ? `Objectif atteint à ${Math.round(current.percent)} %.` : ""}</p>

      {setBy || goal.days_left >= 0 ? (
        <p className="text-xs text-texte-3">
          {setBy ? `${setBy} · ` : ""}
          {goal.days_left > 1 ? `encore ${goal.days_left} jours` : goal.days_left === 1 ? "dernier jour demain" : "dernier jour du mois"}
        </p>
      ) : null}

      {canEdit ? (
        <form action={formAction} className="mt-auto flex flex-col gap-2.5">
          <input type="hidden" name="slug" value={slug} />
          <label htmlFor="objectif-montant" className="flex items-baseline justify-between gap-3 text-[13.5px] text-texte-2">
            Ajuster l’objectif
            <output htmlFor="objectif-montant" className="font-semibold text-texte tabular-nums">
              {formatFcfa(amount)}
            </output>
          </label>
          <input
            id="objectif-montant"
            name="amount"
            type="range"
            min={min}
            max={max}
            step={50_000}
            value={amount}
            onChange={(event) => {
              setTouched(true);
              setAmount(Number(event.target.value));
            }}
            className="curseur curseur-nuit w-full"
            style={{ "--rempli": `${((amount - min) / (max - min)) * 100}%` } as CSSProperties}
          />
          {state.error ? <FormAlert tone="danger">{state.error.message}</FormAlert> : null}
          {state.done && !editing ? <FormAlert tone="success">Objectif enregistré : l’équipe est prévenue.</FormAlert> : null}
          {editing || (!current && canEdit) ? (
            <Button type="submit" pending={pending} pendingLabel="Enregistrement…" className="self-start px-5 py-2.5 text-sm">
              {current ? "Enregistrer le nouvel objectif" : `Fixer l’objectif à ${formatFcfa(amount)}`}
            </Button>
          ) : null}
        </form>
      ) : null}

      {goal.history.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5 border-t border-trait-doux pt-3 text-xs" aria-label="Mois précédents">
          {goal.history.map((month) => (
            <li key={month.month} className={cn("rounded-full px-2.5 py-1", month.reached ? "bg-orange/15 text-orange-clair" : "bg-white/[0.06] text-texte-3")}>
              {month.label} · {formatNumber(Math.round(month.percent))} %{month.reached ? " atteint" : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
