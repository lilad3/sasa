import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

import { ApiKeyForm, SCOPE_LABEL } from "@/features/settings/api-key-form";
import { type ActivityKind, getApiKeys, getPlans, getShopActivity, getShopSettings } from "@/features/settings/data";
import { ShopJournal } from "@/features/settings/journal";
import { SecurityCard, SecurityCardSkeleton } from "@/features/settings/security-card";
import { PlanPicker } from "@/features/settings/plan-picker";
import { ProfileForm } from "@/features/settings/profile-form";
import { RevokeKey } from "@/features/settings/revoke-key";
import { LogoForm } from "@/features/settings/logo-form";
import { VacationPanel } from "@/features/settings/vacation-panel";
import { cn } from "@/lib/cn";
import { formatDateTime, formatNumber } from "@/lib/format";
import { getMe, getMyShops } from "@/lib/server/session";
import type { ApiKey, Me, PlansOverview } from "@/lib/types";

export const metadata: Metadata = { title: "Paramètres" };

const TABS = [
  { id: "boutique", label: "Boutique" },
  { id: "plan", label: "Plan" },
  { id: "cles", label: "Clés API" },
  { id: "journal", label: "Journal" },
] as const;

type Tab = (typeof TABS)[number]["id"];

const MAX_ACTIVE_KEYS = 10;

export default function SettingsPage({ params, searchParams }: PageProps<"/app/[shop]/parametres">) {
  return (
    <Suspense fallback={<SettingsSkeleton />}>
      <SettingsFromRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SettingsFromRoute({ params, searchParams }: Pick<PageProps<"/app/[shop]/parametres">, "params" | "searchParams">) {
  const [{ shop }, query] = await Promise.all([params, searchParams]);
  const wanted = typeof query.onglet === "string" ? query.onglet : "";
  // L'équipe se gère maintenant dans « Mon personnel » : les anciens liens y mènent.
  if (wanted === "equipe") redirect(`/app/${shop}/personnel`);
  const tab: Tab = TABS.find((item) => item.id === wanted)?.id ?? "boutique";

  const [shops, me] = await Promise.all([getMyShops(), getMe()]);
  if (!shops.ok || !me.ok) throw new Error("Impossible de charger les paramètres.");
  const membership = shops.data.find((item) => item.slug === shop);
  if (!membership) notFound();

  // Le menu ne montre Paramètres qu'au propriétaire ; une adresse tapée à la main arrive ici.
  // Django refuserait de toute façon (403) : on explique plutôt que d'afficher une erreur.
  if (!membership.permissions.includes("shop.manage")) {
    // Un gérant à qui le propriétaire a accordé « Gérer la vitrine » n'a que le logo.
    if (membership.permissions.includes("storefront.edit")) {
      return (
        <>
          <header className="col-span-full px-1 pt-1.5">
            <p className="text-[12.5px] text-texte-2">{membership.name}</p>
            <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">La vitrine</h1>
          </header>
          <LogoForm slug={shop} logoUrl={logoUrl(shop, membership.logo_version ?? null)} />
        </>
      );
    }
    return (
      <section className="vitre col-span-full flex flex-col items-start gap-3 rounded-[24px] p-6">
        <h1 className="text-[clamp(22px,2.4vw,28px)] font-medium tracking-tight">Réservé au propriétaire</h1>
        <p className="max-w-[60ch] text-texte-2">
          Les paramètres de {membership.name} (vitrine, équipe, plan, clés API) ne sont accessibles qu’à son propriétaire. Demandez-lui le changement dont vous avez besoin.
        </p>
        <Link href={`/app/${shop}/commandes`} className="bouton-nuit rounded-full px-5 py-2.5 text-sm font-bold">
          Revenir aux commandes
        </Link>
      </section>
    );
  }

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">{membership.name}</p>
          <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Paramètres</h1>
        </div>
        <p className="max-w-[46ch] text-[13px] text-texte-3">Les actions qui engagent la boutique (équipe, plan, clés API) demandent de confirmer que c’est bien vous.</p>
      </header>

      <nav aria-label="Rubriques des paramètres" className="vitre col-span-full flex gap-1 overflow-x-auto rounded-[16px] p-1.5">
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={item.id === "boutique" ? `/app/${shop}/parametres` : `/app/${shop}/parametres?onglet=${item.id}`}
            aria-current={item.id === tab ? "page" : undefined}
            className="shrink-0 rounded-[12px] px-3.5 py-2 text-[13.5px] font-semibold whitespace-nowrap text-texte-3 hover:text-texte aria-[current=page]:bg-white/12 aria-[current=page]:text-texte"
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "boutique" ? <ShopTab slug={shop} logoVersion={membership.logo_version ?? null} /> : null}
      {tab === "plan" ? <PlanTab slug={shop} me={me.data} /> : null}
      {tab === "cles" ? <KeysTab slug={shop} me={me.data} /> : null}
      {tab === "journal" ? (
        <JournalTab
          slug={shop}
          kind={query.type === "tout" ? "tout" : "sensible"}
          page={Math.max(1, Number.parseInt(typeof query.page === "string" ? query.page : "1", 10) || 1)}
        />
      ) : null}
    </>
  );
}

/** Un appel refusé par Django : la page d'erreur de l'espace marchand prend le relais. */
function fail(detail: string): never {
  throw new Error(detail);
}

/** Demain au format des champs date. L'heure d'Abidjan est l'heure UTC, sans heure d'été. */
function tomorrowInAbidjan() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

/** L'adresse du logo, relayée par Next ; ?v= change avec chaque nouveau logo. */
function logoUrl(slug: string, version: string | null) {
  return version ? `/boutique/${slug}/logo?v=${encodeURIComponent(version)}` : null;
}

async function ShopTab({ slug, logoVersion }: { slug: string; logoVersion: string | null }) {
  const settings = await getShopSettings(slug);
  if (!settings.ok) fail(settings.problem.detail);
  return (
    <>
      <ProfileForm settings={settings.data} />
      <LogoForm slug={slug} logoUrl={logoUrl(slug, logoVersion)} />
      <VacationPanel settings={settings.data} tomorrow={tomorrowInAbidjan()} />
    </>
  );
}

function currentPlan(overview: PlansOverview) {
  return overview.plans.find((plan) => plan.id === overview.current) ?? overview.plans[0];
}

async function PlanTab({ slug, me }: { slug: string; me: Me }) {
  const plans = await getPlans(slug);
  if (!plans.ok) fail(plans.problem.detail);
  const plan = currentPlan(plans.data);
  const { usage } = plans.data;
  const meters = [
    { label: "Produits", value: usage.products, limit: plan.products },
    { label: "Équipe", value: usage.members, limit: plan.members },
    { label: "Commandes ce mois-ci", value: usage.orders_this_month, limit: plan.monthly_orders },
    { label: "Clés API actives", value: usage.active_api_keys, limit: plan.api_keys ? MAX_ACTIVE_KEYS : 0 },
  ];

  return (
    <>
      <section aria-labelledby="titre-usage" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px]">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="titre-usage" className="text-sm text-texte-2">
            Votre utilisation · plan {plan.name}
          </h2>
          <p className="max-w-[60ch] text-[12.5px] text-texte-3">
            Paiement simulé pour l’instant : aucun prélèvement. Les limites, elles, sont appliquées par le serveur. Une commande client n’est jamais refusée à cause du plan.
          </p>
        </div>
        <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {meters.map((meter) => {
            const ratio = meter.limit ? Math.min(1, meter.value / meter.limit) : 0;
            return (
              <div key={meter.label} className="carte flex flex-col gap-2 rounded-[18px] p-3.5">
                <dt className="text-[12.5px] text-texte-3">{meter.label}</dt>
                <dd className="flex items-baseline gap-1.5">
                  <span className="chiffres text-[28px]">{formatNumber(meter.value)}</span>
                  <span className="text-[13px] text-texte-3">{meter.limit === null ? "· sans limite" : meter.limit === 0 ? "· pas dans ce plan" : `/ ${formatNumber(meter.limit)}`}</span>
                </dd>
                {meter.limit ? (
                  <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div className={cn("h-full rounded-full", ratio >= 0.9 ? "bg-ocre" : "bg-indigo-clair")} style={{ width: `${Math.max(ratio * 100, 2)}%` }} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </dl>
      </section>
      <PlanPicker slug={slug} overview={plans.data} mfaEnabled={me.mfa_enabled} />
    </>
  );
}

function keyStatus(key: ApiKey) {
  if (key.revoked_at) return { label: `Révoquée le ${formatDateTime(key.revoked_at)}`, tone: "text-texte-3" };
  if (!key.active) return { label: "Expirée", tone: "text-texte-3" };
  return { label: key.expires_at ? `Active · expire le ${formatDateTime(key.expires_at)}` : "Active · sans expiration", tone: "text-texte" };
}

async function KeysTab({ slug, me }: { slug: string; me: Me }) {
  const [keys, plans] = await Promise.all([getApiKeys(slug), getPlans(slug)]);
  if (!keys.ok) fail(keys.problem.detail);
  if (!plans.ok) fail(plans.problem.detail);
  const plan = currentPlan(plans.data);
  const active = keys.data.filter((key) => key.revoked_at === null).length;
  const blocked = me.is_demo
    ? "Les comptes de démonstration ne créent pas de clé : leur mot de passe est public, la clé le serait aussi."
    : !plan.api_keys
      ? `Les clés API s’ouvrent à partir du plan Pro (vous êtes sur le plan ${plan.name}).`
      : active >= MAX_ACTIVE_KEYS
        ? `${MAX_ACTIVE_KEYS} clés actives au maximum : révoquez-en une avant d’en créer une autre.`
        : null;

  return (
    <>
      <ApiKeyForm slug={slug} mfaEnabled={me.mfa_enabled} blocked={blocked} />
      <div className="col-span-full flex flex-col gap-2.5 md:gap-3 lg:col-span-6 lg:gap-3.5">
        <section aria-labelledby="titre-cles" className="vitre flex flex-col gap-3 rounded-[24px] p-[18px]">
          <h2 id="titre-cles" className="text-sm text-texte-2">
            Vos clés
          </h2>
          {keys.data.length === 0 ? (
            <p className="text-sm text-texte-3">Aucune clé pour l’instant. Une clé permet à un logiciel de lire votre catalogue ou vos commandes, sans jamais rien modifier.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {keys.data.map((key) => {
                const status = keyStatus(key);
                return (
                  <li key={key.id} className={cn("carte flex flex-col gap-2 rounded-[18px] p-3.5", !key.active && "opacity-60")}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-[15px] font-semibold">{key.name}</p>
                        <p className="font-mono text-[12.5px] text-texte-3">{key.prefix}…</p>
                      </div>
                      {key.revoked_at === null ? <RevokeKey slug={slug} id={key.id} name={key.name} /> : null}
                    </div>
                    <p className="flex flex-wrap gap-1.5">
                      {key.scopes.map((scope) => (
                        <span key={scope} className="rounded-full bg-indigo/25 px-2 py-0.5 text-[11.5px] font-semibold text-indigo-clair">
                          {SCOPE_LABEL[scope] ?? scope}
                        </span>
                      ))}
                    </p>
                    <p className="text-[12.5px] text-texte-3">
                      <span className={status.tone}>{status.label}</span> · créée le {formatDateTime(key.created_at)} ·{" "}
                      {key.last_used_at ? `dernier appel le ${formatDateTime(key.last_used_at)}${key.last_used_ip ? ` depuis ${key.last_used_ip}` : ""}` : "jamais utilisée"}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section aria-labelledby="titre-utiliser" className="vitre flex flex-col gap-2 rounded-[24px] p-[18px] text-[13.5px] text-texte-2">
          <h2 id="titre-utiliser" className="text-sm text-texte-2">
            Utiliser une clé
          </h2>
          <p>Le logiciel envoie la clé dans l’en-tête Authorization. Deux adresses, en lecture seule :</p>
          <pre className="overflow-x-auto rounded-xl bg-encre/60 p-3 font-mono text-[12.5px] text-texte">
            {"GET /api/public/v1/products   (catalog:read)\nGET /api/public/v1/orders     (orders:read)\n\nAuthorization: Bearer akw_live_…"}
          </pre>
          <p className="text-texte-3">Une clé révoquée ou expirée reçoit 401. Chaque création et chaque révocation est notée dans le journal de sécurité.</p>
        </section>
      </div>
    </>
  );
}

async function JournalTab({ slug, kind, page }: { slug: string; kind: ActivityKind; page: number }) {
  const events = await getShopActivity(slug, kind, page);
  // Une page du journal qui n'existe plus (adresse ancienne) : retour à la première.
  if (!events.ok && events.problem.status === 404 && page > 1) redirect(`/app/${slug}/parametres?onglet=journal${kind === "tout" ? "&type=tout" : ""}`);
  if (!events.ok) fail(events.problem.detail);
  return (
    <>
      <div className="col-span-full self-start lg:col-span-4">
        <Suspense fallback={<SecurityCardSkeleton />}>
          <SecurityCard slug={slug} />
        </Suspense>
      </div>
      <ShopJournal slug={slug} kind={kind} events={events.data} />
    </>
  );
}

function SettingsSkeleton() {
  return (
    <>
      <div aria-hidden className="col-span-full h-[70px]" />
      <div aria-hidden className="vitre col-span-full h-[52px] animate-pulse rounded-[16px]" />
      <div aria-hidden className="vitre col-span-full h-[420px] animate-pulse rounded-[24px] lg:col-span-6" />
      <div aria-hidden className="vitre col-span-full h-[320px] animate-pulse rounded-[24px] lg:col-span-4" />
    </>
  );
}
