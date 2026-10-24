import Link from "next/link";

import { cn } from "@/lib/cn";
import { formatDateTime, formatSince } from "@/lib/format";
import type { SecurityOverview } from "@/lib/types";

import { getSecurityOverview } from "./data";

type Level = "ok" | "warn" | "alert" | "info";
type Check = { id: string; level: Level; text: string; href?: string; action?: string };

const MARK: Record<Level, { className: string; sign: string; sr: string }> = {
  ok: { className: "border-indigo-clair/50 text-indigo-clair", sign: "✓", sr: "En ordre : " },
  warn: { className: "border-ocre/60 bg-ocre/15 text-ocre", sign: "!", sr: "À surveiller : " },
  alert: { className: "border-danger/60 bg-danger/15 text-danger-clair", sign: "!", sr: "À corriger : " },
  info: { className: "border-sable/40 text-sable", sign: "i", sr: "" },
};

function names(list: { name: string }[]) {
  const first = list.map((item) => item.name.split(" ")[0]);
  return first.length <= 2 ? first.join(" et ") : `${first.slice(0, 2).join(", ")} et ${first.length - 2} autre${first.length > 3 ? "s" : ""}`;
}

function days(iso: string) {
  return Math.max(1, Math.round((new Date().getTime() - Date.parse(iso)) / 86_400_000));
}

/** Les verdicts : Django ne donne que des faits, la carte décide de ce qui mérite l'attention. */
function checks(overview: SecurityOverview, slug: string): Check[] {
  const base = `/app/${slug}`;
  const you = overview.team.find((member) => member.is_you);
  const others = overview.team.filter((member) => !member.is_you);
  const result: Check[] = [];

  result.push(
    you?.mfa_enabled
      ? { id: "mfa", level: "ok", text: "Votre double authentification est active." }
      : { id: "mfa", level: "alert", text: "Votre compte ouvre toute la boutique, sans double authentification.", href: `${base}/securite`, action: "L’activer" },
  );

  if (others.length > 0) {
    const without = others.filter((member) => !member.mfa_enabled);
    result.push(
      without.length === 0
        ? { id: "team-mfa", level: "ok", text: "Toute l’équipe a la double authentification." }
        : {
            id: "team-mfa",
            level: "warn",
            text: `${names(without)} ${without.length > 1 ? "n’ont" : "n’a"} pas la double authentification.`,
            href: `${base}/messages`,
            action: "Leur écrire",
          },
    );
  }

  const expired = others.filter((member) => member.temporary_password_expired);
  if (expired.length > 0) {
    result.push({
      id: "pending",
      level: "warn",
      text: `Mot de passe provisoire expiré : ${names(expired)}.`,
      href: `${base}/parametres?onglet=equipe`,
      action: "En refaire un",
    });
  }

  const { api_keys: keys } = overview;
  const dormant = keys.dormant[0];
  const expiring = keys.expiring_soon[0];
  if (dormant) {
    result.push({
      id: "keys",
      level: "warn",
      text: dormant.last_used_at
        ? `La clé « ${dormant.name} » ne sert plus depuis ${days(dormant.last_used_at)} jours.`
        : `La clé « ${dormant.name} » n’a jamais servi.`,
      href: `${base}/parametres?onglet=cles`,
      action: "La révoquer",
    });
  } else if (expiring) {
    result.push({ id: "keys", level: "warn", text: `La clé « ${expiring.name} » expire le ${formatDateTime(expiring.expires_at)}.`, href: `${base}/parametres?onglet=cles`, action: "Voir" });
  } else {
    result.push({
      id: "keys",
      level: "ok",
      text: keys.active === 0 ? "Aucune clé API ouverte." : `${keys.active} clé${keys.active > 1 ? "s" : ""} API, toutes utilisées.`,
    });
  }

  // Un vol de session ou un compte verrouillé, c'est grave ; quelques fautes de frappe, non.
  const serious = overview.suspicious.find((item) => item.type === "refresh_reuse_detected" || item.type === "account_locked");
  const failures = overview.suspicious.filter((item) => item.count >= 3);
  if (serious) {
    result.push({ id: "attempts", level: "alert", text: `${serious.is_you ? "Votre compte" : `Compte de ${serious.name.split(" ")[0]}`} : ${serious.label.toLowerCase()} ${formatSince(serious.last_at)}.`, href: `${base}/parametres?onglet=journal`, action: "Voir le journal" });
  } else if (failures.length > 0) {
    const top = failures[0];
    result.push({
      id: "attempts",
      level: "warn",
      text: `${top.count} essais refusés cette semaine sur ${top.is_you ? "votre compte" : `le compte de ${top.name.split(" ")[0]}`} (${top.label.toLowerCase()}).`,
      href: `${base}/securite`,
      action: "Vérifier",
    });
  } else {
    result.push({ id: "attempts", level: "ok", text: "Aucune tentative suspecte sur les comptes de l’équipe cette semaine." });
  }

  // Le numéro qui reçoit l'argent des clients : un changement récent est le premier signe d'un détournement.
  const waiting = overview.payout_pending[0];
  if (waiting) {
    result.push({
      id: "payout",
      level: "warn",
      text: `Un nouveau numéro de réception (${waiting.label}, ••${waiting.new_last2 ?? "—"}) attend ses 24 h : il servira dès le ${formatDateTime(waiting.activates_at)}. Ce n’est pas vous ? Annulez-le.`,
      href: `${base}/parametres/paiements`,
      action: "Voir et annuler",
    });
  } else if (overview.payout_changed_7d) {
    result.push({
      id: "payout",
      level: "warn",
      text: `Numéro de réception changé ${formatSince(overview.payout_changed_7d.last_at)}${overview.payout_changed_7d.count > 1 ? ` (${overview.payout_changed_7d.count} fois en 7 jours)` : ""}.`,
      href: `${base}/parametres?onglet=journal`,
      action: "Journal",
    });
  } else {
    result.push({ id: "payout", level: "ok", text: "Aucun changement de numéro de réception cette semaine." });
  }

  result.push(
    overview.last_export
      ? {
          id: "export",
          level: "info",
          text: `Dernier export des ventes ${formatSince(overview.last_export.at)}, par ${overview.last_export.by.split(" ")[0]}.`,
          href: `${base}/parametres?onglet=journal`,
          action: "Journal",
        }
      : { id: "export", level: "info", text: "Personne n’a exporté le fichier clients.", href: `${base}/parametres?onglet=journal`, action: "Journal" },
  );
  return result;
}

/** La sécurité de la boutique en un coup d'œil, pour le propriétaire (Paramètres > Journal). */
export async function SecurityCard({ slug }: { slug: string }) {
  const result = await getSecurityOverview(slug);
  if (!result.ok) return null;
  const list = checks(result.data, slug);
  const graded = list.filter((check) => check.level !== "info");
  const fine = graded.filter((check) => check.level === "ok").length;
  const worst = list.some((check) => check.level === "alert") ? "alert" : list.some((check) => check.level === "warn") ? "warn" : "ok";

  return (
    <aside
      aria-labelledby="titre-securite-boutique"
      className="relative flex flex-col gap-3 overflow-hidden rounded-[24px] border border-sable/30 bg-[radial-gradient(70%_60%_at_85%_0%,rgb(74_87_214/0.5),transparent_70%),linear-gradient(165deg,rgb(38_30_24/0.94),rgb(16_13_11/0.95))] p-[20px] before:pointer-events-none before:absolute before:inset-0 before:bg-[repeating-linear-gradient(90deg,rgb(255_255_255/0.05)_0_1px,transparent_1px_26px)]"
    >
      <div className="relative flex items-start justify-between gap-2">
        <div>
          <h2 id="titre-securite-boutique" className="text-[clamp(18px,1.8vw,22px)] font-medium tracking-tight">
            Sécurité de la boutique
          </h2>
          <p className="text-[12.5px] text-texte-3">
            {fine} point{fine > 1 ? "s" : ""} sur {graded.length} en ordre
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2.5 py-1 text-[12px] font-bold",
            worst === "ok" && "bg-indigo/40 text-creme",
            worst === "warn" && "bg-ocre text-encre",
            worst === "alert" && "bg-danger text-encre",
          )}
        >
          {worst === "ok" ? "En ordre" : worst === "warn" ? "À surveiller" : "À corriger"}
        </span>
      </div>
      <ul className="relative flex flex-col gap-2">
        {list.map((check) => (
          <li key={check.id} className="flex items-start gap-2.5 text-[13px] leading-snug text-texte-2">
            <span aria-hidden className={cn("mt-px grid size-[18px] shrink-0 place-items-center rounded-full border text-[11px] font-bold", MARK[check.level].className)}>
              {MARK[check.level].sign}
            </span>
            <span className="min-w-0">
              {MARK[check.level].sr ? <span className="sr-only">{MARK[check.level].sr}</span> : null}
              {check.text}
              {check.href ? (
                <>
                  {" "}
                  <Link href={check.href} className="font-semibold whitespace-nowrap text-indigo-clair underline-offset-2 hover:underline">
                    {check.action}
                  </Link>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function SecurityCardSkeleton() {
  return <div aria-hidden className="h-full min-h-[250px] animate-pulse rounded-[24px] bg-white/[0.06]" />;
}
