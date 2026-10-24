import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, formatNumber, PAYMENT_LABEL, ROLE_LABEL, STATUS_LABEL } from "@/lib/format";
import type { OrderStatus, Paginated, PaymentMethod, Role, ShopActivityEvent } from "@/lib/types";

import type { ActivityKind } from "./data";

const KINDS: { kind: ActivityKind; label: string; hint: string }[] = [
  { kind: "sensible", label: "Sensible", hint: "équipe, clés API, exports, robots" },
  { kind: "tout", label: "Tout", hint: "aussi les commandes, le catalogue et les messages" },
];

const PLAN_NAME: Record<string, string> = { free: "Gratuit", pro: "Pro", business: "Business" };

const FIELD_NAME: Record<string, string> = {
  name: "le nom",
  description: "la présentation",
  city: "la ville",
  accent: "la couleur",
  vacation_active: "le mode congé",
  vacation_message: "le message de congé",
  vacation_until: "la date de retour",
};

const SCOPE_NAME: Record<string, string> = { "catalog:read": "catalogue", "orders:read": "commandes et clients" };

const TONE: Record<ShopActivityEvent["severity"], string> = {
  info: "bg-sable/60",
  warning: "bg-ocre shadow-[0_0_8px_rgb(242_179_61/0.6)]",
  critical: "bg-danger shadow-[0_0_8px_rgb(255_122_107/0.6)]",
};

const day = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", weekday: "long", day: "numeric", month: "long" });
const hour = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", hour: "2-digit", minute: "2-digit" });
const short = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", day: "numeric", month: "short" });
const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** « Aujourd'hui », « Hier », puis « mardi 14 octobre ». L'heure d'Abidjan est l'heure UTC. */
function dayLabel(key: string, today: string, yesterday: string) {
  if (key === today) return "Aujourd’hui";
  if (key === yesterday) return "Hier";
  const text = day.format(new Date(`${key}T12:00:00Z`));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function count(value: unknown) {
  return typeof value === "number" ? formatNumber(value) : "?";
}

function roleName(value: unknown) {
  return ROLE_LABEL[value as Role]?.toLowerCase() ?? text(value);
}

function statusName(value: unknown) {
  return STATUS_LABEL[value as OrderStatus] ?? text(value);
}

function Strong({ children }: { children: ReactNode }) {
  return <span className="font-semibold text-texte">{children}</span>;
}

/** Une phrase par événement. Les détails viennent d'une liste blanche côté Django : rien d'autre n'arrive ici. */
function describe(event: ShopActivityEvent): ReactNode {
  // « Vous a ajouté » ne se dit pas : le nom reste, suivi de « (vous) ».
  const who = event.actor ? (
    <>
      <Strong>{event.actor.name}</Strong>
      {event.actor.is_you ? <span className="text-texte-3"> (vous)</span> : null}
    </>
  ) : null;
  const target = <Strong>{event.target?.label ?? "?"}</Strong>;
  const d = event.details;
  switch (event.type) {
    case "member_added":
      return <>{who} a ajouté {target} à l’équipe, comme {roleName(d.role)}</>;
    case "member_role_changed":
      return <>{who} a fait passer {target} de {roleName(d.previous_role)} à {roleName(d.new_role)}</>;
    case "member_removed":
      return <>{who} a retiré {target} de l’équipe</>;
    case "member_password_reset":
      return <>{who} a refait le mot de passe provisoire de {target}</>;
    case "api_key_created": {
      const scopes = Array.isArray(d.scopes) ? d.scopes.map((scope) => SCOPE_NAME[String(scope)] ?? String(scope)).join(", ") : "";
      return <>{who} a créé la clé API {target}{scopes ? ` (${scopes})` : ""}</>;
    }
    case "api_key_revoked":
      return <>{who} a révoqué la clé API {target}</>;
    case "orders_exported": {
      const period = text(d.first) && text(d.last) ? `, du ${short.format(new Date(`${text(d.first).slice(0, 10)}T12:00:00Z`))} au ${short.format(new Date(`${text(d.last).slice(0, 10)}T12:00:00Z`))}` : "";
      return <>{who} a exporté <Strong>{count(d.rows)} commandes</Strong> avec les coordonnées des clients{period}</>;
    }
    case "checkout_bot_blocked":
      return <>Un robot a tenté de commander en vitrine : la commande a été bloquée</>;
    case "order_placed":
      return (
        <>
          Nouvelle commande {target} en vitrine
          {typeof d.total === "number" ? ` · ${formatFcfa(d.total)}` : ""}
          {d.payment_method ? ` · ${PAYMENT_LABEL[d.payment_method as PaymentMethod] ?? ""}` : ""}
        </>
      );
    case "order_status_changed":
      return <>{who} a passé la commande {target} de « {statusName(d.previous_status)} » à « {statusName(d.new_status)} »</>;
    case "plan_changed":
      return <>{who} a fait passer la boutique du plan {PLAN_NAME[text(d.previous_plan)] ?? text(d.previous_plan)} au plan {PLAN_NAME[text(d.new_plan)] ?? text(d.new_plan)}</>;
    case "shop_updated": {
      const fields = Array.isArray(d.fields) ? d.fields.map((field) => FIELD_NAME[String(field)] ?? String(field)) : [];
      return <>{who} a modifié la vitrine{fields.length ? ` : ${fields.join(", ")}` : ""}</>;
    }
    case "products_imported":
      return <>{who} a importé des produits : {count(d.created)} créés, {count(d.updated)} mis à jour</>;
    case "team_note_sent":
      return <>{who} a envoyé {d.urgent ? "un mot urgent" : "un mot"} à l’équipe</>;
    case "demo_data_generated":
      return <>{who} a ajouté les données de démonstration</>;
    case "payout_number_changed":
      return (
        <>
          {who} a modifié le numéro de réception {target}
          {d.previous_last2 || d.new_last2 ? ` (••${text(d.previous_last2) || "—"} → ••${text(d.new_last2) || "—"})` : ""}
        </>
      );
    case "payout_number_pending":
      return <>{who} a demandé un nouveau numéro de réception {target} (••{text(d.previous_last2) || "—"} → ••{text(d.new_last2)}) : il servira dans 24 h</>;
    case "payout_number_activated":
      return <>Le nouveau numéro de réception {target} (••{text(d.new_last2)}) est en service après 24 h d’attente</>;
    case "payout_number_cancelled":
      return <>{who} a annulé le changement du numéro de réception {target}</>;
    case "payment_methods_changed":
      return <>{who} a modifié les moyens de paiement proposés</>;
    case "delivery_settings_changed":
      return <>{who} a modifié la livraison{event.target?.label ? <> : {target}</> : null}</>;
    case "shop_created":
      return <>{who} a créé la boutique</>;
    default:
      return who ? <>{who} : {event.label.toLowerCase()}</> : event.label;
  }
}

type JournalProps = { slug: string; kind: ActivityKind; events: Paginated<ShopActivityEvent> };

/** L'onglet Journal de Paramètres : 90 jours d'activité, groupés par jour. */
export function ShopJournal({ slug, kind, events }: JournalProps) {
  const now = new Date();
  const today = isoDay(now);
  const yesterday = isoDay(new Date(now.getTime() - 86_400_000));
  const href = (next: { kind?: ActivityKind; page?: number }) => {
    const query = new URLSearchParams({ onglet: "journal" });
    const wanted = next.kind ?? kind;
    if (wanted !== "sensible") query.set("type", wanted);
    if (next.page && next.page > 1) query.set("page", String(next.page));
    return `/app/${slug}/parametres?${query}`;
  };

  const days: { key: string; items: ShopActivityEvent[] }[] = [];
  for (const event of events.results) {
    const key = isoDay(new Date(event.created_at));
    const last = days.at(-1);
    if (last?.key === key) last.items.push(event);
    else days.push({ key, items: [event] });
  }

  return (
    <section aria-labelledby="titre-journal" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="titre-journal" className="text-sm text-texte-2">
            Journal de la boutique
          </h2>
          <p className="mt-1 max-w-[62ch] text-[13px] text-texte-3">
            Qui a fait quoi, depuis quel appareil, sur 90 jours. Personne ne peut modifier ni effacer ces lignes, pas même vous : le journal est en ajout seul et
            chaîné, toute retouche se verrait.
          </p>
        </div>
        <nav aria-label="Événements affichés" className="flex gap-1 rounded-[14px] border border-trait-doux bg-encre/50 p-1">
          {KINDS.map((item) => (
            <Link
              key={item.kind}
              href={href({ kind: item.kind })}
              aria-current={item.kind === kind ? "page" : undefined}
              title={item.hint}
              className="rounded-[10px] px-3 py-1.5 text-[13px] font-semibold text-texte-3 hover:text-texte aria-[current=page]:bg-white/12 aria-[current=page]:text-texte"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      {days.length === 0 ? (
        <p className="carte rounded-[18px] p-5 text-sm text-texte-3">
          {kind === "sensible"
            ? "Rien de sensible sur les 90 derniers jours : ni export, ni changement dans l’équipe, ni clé API."
            : "Aucune activité sur les 90 derniers jours."}
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {days.map((group) => (
            <div key={group.key} className="flex flex-col gap-1.5">
              <h3 className="px-1 font-mono text-[11.5px] tracking-[0.08em] text-texte-3 uppercase">{dayLabel(group.key, today, yesterday)}</h3>
              <ol className="carte flex flex-col divide-y divide-trait-doux rounded-[18px]">
                {group.items.map((event) => (
                  <li key={event.id} className="grid grid-cols-[52px_10px_minmax(0,1fr)] items-start gap-x-3 px-3.5 py-3">
                    <time dateTime={event.created_at} className="pt-px font-mono text-[12.5px] text-texte-3 tabular-nums">
                      {hour.format(new Date(event.created_at))}
                    </time>
                    <span aria-hidden className={cn("mt-[7px] size-2 rounded-full", TONE[event.severity])} />
                    <div className="min-w-0">
                      <p className="text-[14px] text-texte-2">
                        {event.severity === "info" ? null : <span className="sr-only">{event.severity === "critical" ? "Critique : " : "À surveiller : "}</span>}
                        {describe(event)}
                        {event.actor && event.actor.role === null ? <span className="text-texte-3"> (a quitté la boutique)</span> : null}
                      </p>
                      {event.actor && (event.device_label || event.ip) ? (
                        <p className="mt-0.5 text-[12px] text-texte-3">
                          {[event.device_label, event.ip].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}

      {events.pages > 1 ? (
        <nav aria-label="Pages du journal" className="flex items-center justify-between gap-3 text-[13px]">
          {events.page > 1 ? (
            <Link href={href({ page: events.page - 1 })} className="rounded-full border border-trait px-4 py-2 text-texte-2 hover:bg-white/10 hover:text-texte">
              Plus récent
            </Link>
          ) : (
            <span />
          )}
          <span className="text-texte-3 tabular-nums">
            Page {events.page} sur {events.pages}
          </span>
          {events.page < events.pages ? (
            <Link href={href({ page: events.page + 1 })} className="rounded-full border border-trait px-4 py-2 text-texte-2 hover:bg-white/10 hover:text-texte">
              Plus ancien
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </section>
  );
}
