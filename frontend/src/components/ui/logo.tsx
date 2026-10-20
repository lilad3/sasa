import { cn } from "@/lib/cn";

type LogoProps = {
  className?: string;
  /** Étiquette affichée à côté du nom, par exemple le nom de l'espace. */
  badge?: string;
};

export function Logo({ className, badge }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden className="size-[9px] rounded-full bg-lime shadow-[0_0_0_4px_rgb(97_196_18/0.22)]" />
      <span className="large text-lg font-extrabold text-texte">akwaba</span>
      {badge ? (
        <span className="rounded-full bg-pistache/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-pistache">
          {badge}
        </span>
      ) : null}
    </span>
  );
}
