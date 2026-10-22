import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SubmitButton } from "@/components/ui/submit-button";
import { removeVip } from "@/features/customers/actions";
import { DiscountList } from "@/features/customers/discount-list";
import { GiveDiscount } from "@/features/customers/discounts";
import { CustomerTags, Reliability } from "@/features/customers/parts";
import { StatusPill, TwoTone } from "@/features/dashboard/parts";
import { compactFcfa, formatDateTime, formatFcfa, formatNumber, formatPhone, PAYMENT_LABEL } from "@/lib/format";
import { getCustomer, getMe, getMyShops } from "@/lib/server/session";
import { storefrontLink } from "@/lib/server/storefront-link";

export const metadata: Metadata = { title: "Fiche client" };

const longMonth = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric", timeZone: "Africa/Abidjan" });

export default function CustomerPage({ params }: PageProps<"/app/[shop]/clients/[id]">) {
  return (
    <Suspense fallback={<div aria-hidden className="vitre col-span-full h-[520px] animate-pulse rounded-[26px]" />}>
      <CustomerFromRoute params={params} />
    </Suspense>
  );
}

async function CustomerFromRoute({ params }: Pick<PageProps<"/app/[shop]/clients/[id]">, "params">) {
  const { shop, id } = await params;
  const [result, shops, me, link] = await Promise.all([getCustomer(shop, id), getMyShops(), getMe(), storefrontLink(shop)]);
  if (!result.ok) {
    if ([400, 403, 404].includes(result.problem.status)) notFound();
    throw new Error(result.problem.detail);
  }
  const customer = result.data;
  const membership = shops.ok ? shops.data.find((item) => item.slug === shop) : undefined;
  const canNameVip = membership?.permissions.includes("customers.vip") ?? false;
  const canGive = membership?.permissions.includes("discounts.give") ?? false;
  const digits = customer.phone.replace(/\D/g, "");
  const [spent, spentUnit] = compactFcfa(customer.spent);
  const firstName = customer.name.split(" ")[0];

  return (
    <>
      <header className="col-span-full flex flex-col gap-4 px-1 pt-1.5">
        <Link href={`/app/${shop}/clients`} className="inline-flex items-center gap-1.5 self-start text-[13px] text-texte-3 hover:text-texte">
          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M15 6l-6 6 6 6" />
          </svg>
          Clients
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-[clamp(26px,3vw,38px)] font-medium tracking-tight">{customer.name}</h1>
              <CustomerTags customer={customer} />
            </div>
            <p className="text-[13.5px] text-texte-2">
              <span className="font-mono">{formatPhone(customer.phone)}</span>
              {customer.first_order_at ? ` · client depuis ${longMonth.format(new Date(customer.first_order_at))}` : " · nommé fidèle avant toute commande en ligne"}
              {customer.payment_favorite ? ` · paie surtout par ${PAYMENT_LABEL[customer.payment_favorite]}` : ""}
            </p>
            {customer.vip && customer.vip_set_by ? (
              <p className="text-xs text-texte-3">
                Nommé fidèle par {customer.vip_set_by.name}
                {customer.vip_set_at ? `, le ${formatDateTime(customer.vip_set_at)}` : ""}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2.5">
            <a
              href={`https://wa.me/${digits}?text=${encodeURIComponent(`Bonjour ${firstName}, `)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="bouton-clair rounded-full px-5 py-3 text-sm font-bold"
            >
              Écrire sur WhatsApp
            </a>
            <a href={`tel:${customer.phone}`} className="bouton-contour rounded-full px-5 py-3 text-sm font-bold">
              Appeler
            </a>
            {canGive && membership ? (
              <GiveDiscount
                slug={shop}
                customerId={customer.id}
                customerName={customer.name}
                shopName={membership.name}
                shopUrl={link.url}
                cap={membership.role === "owner" ? null : (membership.discount_cap_percent ?? 0)}
                mfaEnabled={me.ok && me.data.mfa_enabled}
              />
            ) : null}
            {canNameVip && customer.vip ? (
              <form action={removeVip}>
                <input type="hidden" name="slug" value={shop} />
                <input type="hidden" name="customer" value={customer.id} />
                <SubmitButton variant="ghost" pendingLabel="…" className="px-5 py-3 text-sm">
                  Retirer des fidèles
                </SubmitButton>
              </form>
            ) : null}
          </div>
        </div>
      </header>

      <div className="cascade col-span-full grid gap-2.5 sm:grid-cols-2 md:gap-3 xl:grid-cols-4">
        <div className="vitre flex flex-col gap-2.5 rounded-[22px] p-4">
          <span className="text-[14px] text-texte-2">Total dépensé</span>
          <TwoTone value={spent} unit={spentUnit} className="text-[clamp(32px,3vw,44px)]" />
          <span className="text-[12.5px] text-texte-3">hors commandes annulées</span>
        </div>
        <div className="vitre flex flex-col gap-2.5 rounded-[22px] p-4">
          <span className="text-[14px] text-texte-2">Commandes</span>
          <TwoTone value={formatNumber(customer.order_count)} className="text-[clamp(32px,3vw,44px)]" />
          <span className="text-[12.5px] text-texte-3">
            {formatNumber(customer.delivered)} livrée{customer.delivered > 1 ? "s" : ""}, {formatNumber(customer.cancelled)} annulée{customer.cancelled > 1 ? "s" : ""}
          </span>
        </div>
        <div className="vitre flex flex-col gap-2.5 rounded-[22px] p-4">
          <span className="text-[14px] text-texte-2">Panier moyen</span>
          <TwoTone value={formatNumber(customer.average_basket)} unit=" F" className="text-[clamp(32px,3vw,44px)]" />
        </div>
        <div className="vitre flex flex-col gap-2.5 rounded-[22px] p-4">
          <span className="text-[14px] text-texte-2">Fiabilité</span>
          <TwoTone value={customer.reliability === null ? "—" : String(Math.round(customer.reliability))} unit={customer.reliability === null ? "" : " %"} className="text-[clamp(32px,3vw,44px)]" />
          <Reliability value={customer.reliability} />
        </div>
      </div>

      <section aria-labelledby="titre-ses-commandes" className="vitre col-span-full rounded-[26px] px-[18px] pt-4 pb-3 lg:col-span-6">
        <h2 id="titre-ses-commandes" className="pb-1 text-sm text-texte-2">
          Ses commandes
        </h2>
        {customer.orders.length === 0 ? (
          <p className="py-3 text-sm text-texte-3">Pas encore de commande en ligne.</p>
        ) : (
          <ul className="flex flex-col">
            {customer.orders.map((order) => (
              <li key={order.id} className="border-b border-trait-doux last:border-0">
                <Link
                  href={`/app/${shop}/commandes/${order.id}`}
                  className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 rounded-xl px-2 py-2.5 transition-colors hover:bg-white/[0.05] sm:grid-cols-[100px_minmax(0,1fr)_110px_120px]"
                >
                  <span className="font-mono text-[13px]">{order.reference}</span>
                  <span className="text-[13px] text-texte-3">{formatDateTime(order.created_at)}</span>
                  <span className="text-sm font-semibold tabular-nums">{formatFcfa(order.total)}</span>
                  <StatusPill status={order.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="cascade col-span-full flex flex-col gap-2.5 md:gap-3 lg:col-span-4">
        <DiscountList slug={shop} discounts={customer.discounts ?? []} />
        <section aria-labelledby="titre-achats" className="vitre flex flex-col gap-2.5 rounded-[26px] p-[18px]">
          <h2 id="titre-achats" className="text-sm text-texte-2">
            Ses achats préférés
          </h2>
          {customer.products.length === 0 ? (
            <p className="text-sm text-texte-3">Rien pour l’instant.</p>
          ) : (
            <ol className="flex flex-col gap-1.5">
              {customer.products.map((product) => (
                <li key={product.name} className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{product.name}</span>
                  <span className="shrink-0 text-texte-3 tabular-nums">× {formatNumber(product.quantity)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section aria-labelledby="titre-livraison" className="vitre flex flex-col gap-2.5 rounded-[26px] p-[18px]">
          <h2 id="titre-livraison" className="text-sm text-texte-2">
            Où le livrer
          </h2>
          {customer.addresses.length === 0 ? (
            <p className="text-sm text-texte-3">Aucune adresse : pas encore de livraison.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {customer.addresses.map((address) => (
                <li key={`${address.city}-${address.commune}-${address.landmark}`} className="text-sm">
                  <span className="font-semibold">{address.commune ? `${address.commune}, ${address.city}` : address.city}</span>
                  {address.landmark ? <span className="block text-texte-2">« {address.landmark} »</span> : null}
                  <span className="text-xs text-texte-3">
                    {formatNumber(address.orders)} livraison{address.orders > 1 ? "s" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {customer.names_used.length > 1 ? (
            <p className="border-t border-trait-doux pt-2.5 text-xs text-texte-3">Noms utilisés : {customer.names_used.join(", ")}.</p>
          ) : null}
        </section>
      </div>
    </>
  );
}
