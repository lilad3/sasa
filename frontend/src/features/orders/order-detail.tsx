import Link from "next/link";

import { StatusPill, TwoTone } from "@/features/dashboard/parts";
import { cn } from "@/lib/cn";
import { formatDateTime, formatFcfa, formatNumber, formatPhone, PAYMENT_LABEL } from "@/lib/format";
import type { OrderDetail as OrderDetailData, OrderStatus } from "@/lib/types";

import { OrderNotes } from "./order-notes";
import { StatusActions } from "./status-actions";

const STEPS: { status: OrderStatus; label: string; detail: string }[] = [
  { status: "pending", label: "Reçue", detail: "à confirmer par téléphone" },
  { status: "confirmed", label: "Confirmée", detail: "colis à préparer" },
  { status: "shipped", label: "Expédiée", detail: "chez le livreur" },
  { status: "delivered", label: "Livrée", detail: "remise au client" },
];

export function OrderDetail({ order, slug, canManage }: { order: OrderDetailData; slug: string; canManage: boolean }) {
  const { customer } = order;
  const phoneDigits = customer.phone.replace(/\D/g, "");
  const cashOnDelivery = order.payment_method === "cash_on_delivery";
  const articles = order.items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div className="flex flex-col gap-1.5">
          <Link href={`/app/${slug}/commandes`} className="inline-flex items-center gap-1.5 self-start text-[12.5px] text-texte-2 hover:text-texte">
            <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 5l-7 7 7 7" />
            </svg>
            Toutes les commandes
          </Link>
          <h1 className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">
            <span className="sr-only">Commande </span>
            <span className="font-mono">{order.reference}</span>
            <StatusPill status={order.status} />
          </h1>
          <p className="text-[12.5px] text-texte-3">Passée le {formatDateTime(order.created_at)}</p>
        </div>
      </header>

      <StatusTrack status={order.status} />

      <section aria-labelledby="titre-articles" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-6">
        <h2 id="titre-articles" className="text-sm text-texte-2">
          {formatNumber(articles)} article{articles > 1 ? "s" : ""}
        </h2>
        <ul className="carte flex flex-col rounded-carte px-4">
          {order.items.map((item, index) => (
            <li key={`${item.product_id}-${index}`} className="flex items-baseline justify-between gap-4 border-b border-trait-doux py-3 last:border-0">
              <span className="min-w-0">
                <span className="block text-[14.5px] font-semibold">{item.name}</span>
                <span className="text-[13px] text-texte-3 tabular-nums">
                  {item.quantity} × {formatFcfa(item.unit_price)}
                </span>
              </span>
              <span className="shrink-0 text-sm font-semibold tabular-nums">{formatFcfa(item.line_total)}</span>
            </li>
          ))}
        </ul>
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 px-1 text-sm">
          <dt className="text-texte-2">Sous-total</dt>
          <dd className="text-right tabular-nums">{formatFcfa(order.subtotal)}</dd>
          <dt className="text-texte-2">Livraison · {customer.commune || customer.city}</dt>
          <dd className="text-right tabular-nums">{order.delivery_fee ? formatFcfa(order.delivery_fee) : "offerte"}</dd>
          <dt className="self-end pt-2 text-texte-2">Total</dt>
          <dd className="pt-2">
            <TwoTone value={formatNumber(order.total)} unit=" F" className="text-right text-[clamp(30px,3.4vw,40px)]" />
          </dd>
        </dl>
        <p className="rounded-[14px] border border-trait-doux bg-encre/40 px-3.5 py-2.5 text-sm text-texte-2">
          {cashOnDelivery ? (
            <>
              <span className="font-semibold text-ocre">À encaisser à la livraison :</span> {formatFcfa(order.total)}, en espèces.
            </>
          ) : (
            <>
              Paiement par <span className="font-semibold text-texte">{PAYMENT_LABEL[order.payment_method]}</span> : envoyez la demande de paiement au{" "}
              <span className="font-mono">{formatPhone(customer.phone)}</span>.
            </>
          )}
        </p>
      </section>

      <div className="col-span-full flex flex-col gap-2.5 md:gap-3 lg:col-span-4 lg:gap-3.5">
        <section aria-labelledby="titre-client" className="vitre flex flex-col gap-3.5 rounded-[24px] p-[18px]">
          <h2 id="titre-client" className="text-sm text-texte-2">
            Client
          </h2>
          <div>
            <p className="large text-lg font-bold">{customer.name}</p>
            <p className="mt-0.5 font-mono text-sm text-texte-2">{formatPhone(customer.phone)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={`tel:${customer.phone}`} className="inline-flex items-center gap-2 rounded-full border border-sable/25 bg-white/[0.04] px-3.5 py-2 text-sm font-semibold hover:bg-white/10">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M6.5 3.5h3l1.5 4.5-2 1.3a11 11 0 0 0 5.7 5.7l1.3-2 4.5 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z" />
              </svg>
              Appeler
            </a>
            <a
              href={`https://wa.me/${phoneDigits}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-full border border-sable/25 bg-white/[0.04] px-3.5 py-2 text-sm font-semibold hover:bg-white/10"
            >
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M4.5 19.5l1.2-3.6A8 8 0 1 1 8.6 18.7z" />
                <path d="M9.5 9.5c.3 2 1.8 3.8 4 4.6" />
              </svg>
              WhatsApp
              <span className="sr-only">(nouvel onglet)</span>
            </a>
          </div>
          <dl className="flex flex-col gap-2.5 border-t border-trait-doux pt-3.5 text-sm">
            <div>
              <dt className="text-xs text-texte-3">Livraison</dt>
              <dd>{[customer.commune, customer.city].filter(Boolean).join(", ")}</dd>
            </div>
            {customer.landmark ? (
              <div>
                <dt className="text-xs text-texte-3">Repère</dt>
                <dd>{customer.landmark}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        {canManage ? (
          <section aria-labelledby="titre-traitement" className="vitre flex flex-col gap-3 rounded-[24px] p-[18px]">
            <h2 id="titre-traitement" className="text-sm text-texte-2">
              Traitement
            </h2>
            <StatusActions slug={slug} orderId={order.id} status={order.status} />
          </section>
        ) : null}

        <OrderNotes slug={slug} orderId={order.id} notes={order.notes} canWrite={canManage} />
      </div>
    </>
  );
}

/** Le circuit d'une commande : les étapes franchies s'allument, une commande annulée s'éteint. */
function StatusTrack({ status }: { status: OrderStatus }) {
  const cancelled = status === "cancelled";
  const reached = cancelled ? -1 : STEPS.findIndex((step) => step.status === status);

  return (
    <section aria-label="Étapes de la commande" className="vitre col-span-full flex flex-col gap-3 rounded-[24px] px-[18px] py-4">
      <ol className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-4">
        {STEPS.map((step, index) => {
          const done = index <= reached;
          const current = index === reached;
          const delivered = done && status === "delivered";
          return (
            <li key={step.status} aria-current={current ? "step" : undefined} className="flex flex-col gap-2">
              <span
                aria-hidden
                className={cn(
                  "h-1 rounded-full",
                  !done && "bg-white/10",
                  done && !delivered && "bg-orange-clair shadow-[0_0_10px_rgb(255_155_82/0.6)]",
                  delivered && "bg-indigo-clair shadow-[0_0_10px_rgb(163_171_255/0.6)]",
                )}
              />
              <span className={cn("text-sm", current ? "font-semibold text-texte" : done ? "text-texte-2" : "text-texte-3")}>
                {step.label}
                {done && !current ? <span className="sr-only"> (fait)</span> : null}
              </span>
              <span className="text-xs text-texte-3">{step.detail}</span>
            </li>
          );
        })}
      </ol>
      {cancelled ? <p className="text-sm text-danger-clair">Commande annulée : elle ne compte ni dans le chiffre d’affaires ni dans les commandes.</p> : null}
    </section>
  );
}
