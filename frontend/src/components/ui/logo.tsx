import { cn } from "@/lib/cn";

type LogoProps = {
  className?: string;
  /** Étiquette affichée à côté du nom, par exemple le nom de l'espace. */
  badge?: string;
  /** « clair » sur fond sombre ; « inherit » reprend la couleur du parent (barre qui passe du sombre au clair). */
  tone?: "clair" | "inherit";
};

export function Logo({ className, badge, tone = "clair" }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span aria-hidden className="size-[9px] rounded-full bg-orange shadow-[0_0_0_4px_rgb(255_122_31/0.22)]" />
      <span className={cn("large text-lg font-extrabold", tone === "clair" ? "text-texte" : "text-current")}>akwaba</span>
      {badge ? (
        <span className="rounded-full bg-sable/15 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.07em] text-sable">
          {badge}
        </span>
      ) : null}
    </span>
  );
}
