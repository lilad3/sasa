import type { InputHTMLAttributes, ReactNode, Ref } from "react";

import { cn } from "@/lib/cn";

type FieldProps = InputHTMLAttributes<HTMLInputElement> & {
  ref?: Ref<HTMLInputElement>;
  id: string;
  label: string;
  error?: string;
  hint?: string;
  /** Élément posé à droite dans le champ, par exemple « Afficher » pour un mot de passe. */
  trailing?: ReactNode;
};

/** Champ en verre : libellé au-dessus, message d'erreur relié par aria-describedby. */
export function Field({ id, label, error, hint, trailing, className, ...input }: FieldProps) {
  const describedBy = [error ? `${id}-erreur` : null, hint ? `${id}-aide` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-[7px]">
      <label htmlFor={id} className="text-[13px] font-semibold text-texte-2">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...input}
          className={cn(
            "w-full rounded-champ border border-white/15 bg-encre/45 px-[15px] py-[13px] text-base text-texte outline-none transition-[border-color,box-shadow]",
            "placeholder:text-texte-3 focus-visible:border-lime focus-visible:shadow-[0_0_0_3px_rgb(97_196_18/0.28)] focus-visible:outline-none",
            error && "border-danger",
            trailing && "pr-24",
            className,
          )}
        />
        {trailing ? <div className="absolute top-1/2 right-2 -translate-y-1/2">{trailing}</div> : null}
      </div>
      {hint ? (
        <p id={`${id}-aide`} className="text-[13px] text-texte-3">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-erreur`} className="text-[13px] text-danger-clair">
          {error}
        </p>
      ) : null}
    </div>
  );
}
