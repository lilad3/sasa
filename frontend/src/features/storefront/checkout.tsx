"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, useTransition } from "react";

import { cn } from "@/lib/cn";
import { formatFcfa, PAYMENT_LABEL } from "@/lib/format";
import { formatWait } from "@/lib/messages";
import type { PaymentMethod, PlacedOrder, Storefront } from "@/lib/types";

import { type CheckoutInput, placeOrder } from "./actions";
import { subtotalOf } from "./basket";
import { type Line, Price } from "./catalogue";

// Champs en pêche translucide (plus de blanc). Indice gris-brun à 4,6:1, anneau de focus indigo.
const INPUT =
  "w-full rounded-[14px] border border-encre/20 bg-[rgb(255_246_236/0.62)] px-4 py-3 text-base text-encre outline-none transition-[border-color,box-shadow] placeholder:text-[#6b5440] focus-visible:border-encre focus-visible:shadow-[0_0_0_3px_rgb(74_87_214/0.35)] aria-invalid:border-[#8a2412]";

type FieldName = "name" | "phone" | "zone" | "landmark";

// Clés d'erreur de l'API → champs du formulaire.
const API_FIELDS: Record<string, FieldName> = {
  "customer.name": "name",
  "customer.phone": "phone",
  "customer.city": "zone",
  "customer.commune": "zone",
  "customer.landmark": "landmark",
};

/** Même règle que Django (contrat §2.13), pour prévenir avant l'envoi : 01, 05, 07, 21, 25 ou 27, puis 8 chiffres. */
function isIvorianPhone(raw: string) {
  let digits = raw.replace(/\D/g, "");
  if (raw.trim().startsWith("+225")) digits = digits.slice(3);
  else if (digits.startsWith("00225")) digits = digits.slice(5);
  return /^(0[157]|2[157])\d{8}$/.test(digits);
}

export type Receipt = { order: PlacedOrder; name: string; phone: string; zone: string; payment: PaymentMethod };

export function Checkout({
  shop,
  lines,
  onBack,
  onPlaced,
  onStockShortage,
}: {
  shop: Storefront;
  lines: Line[];
  onBack: () => void;
  onPlaced: (receipt: Receipt) => void;
  onStockShortage: (available: Record<number, number>) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [zoneId, setZoneId] = useState("");
  const [landmark, setLandmark] = useState("");
  const [payment, setPayment] = useState<PaymentMethod>("cash_on_delivery");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Même contenu → même clé : si le réseau coupe et que le client renvoie, Django rend la commande déjà créée.
  const attempt = useRef<{ key: string; signature: string } | null>(null);
  const honeypot = useRef<HTMLInputElement>(null);

  const zone = shop.delivery_zones.find((z) => z.id === zoneId) ?? null;

  // Une erreur disparaît dès que la personne corrige le champ concerné.
  const edit = (field: FieldName, setter: (value: string) => void) => (value: string) => {
    setter(value);
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const subtotal = subtotalOf(lines);
  const fee = zone?.fee ?? 0;
  const total = subtotal + fee;

  function validate() {
    const found: Partial<Record<FieldName, string>> = {};
    if (name.trim().length < 2) found.name = "Indiquez votre nom, pour que le livreur vous trouve.";
    if (!isIvorianPhone(phone)) found.phone = "Numéro ivoirien à 10 chiffres, par exemple 07 07 12 34 56.";
    if (!zone) found.zone = "Choisissez votre commune ou votre ville.";
    return found;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = validate();
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length || !zone || lines.length === 0) return;

    const payload: Omit<CheckoutInput, "idempotencyKey"> = {
      slug: shop.slug,
      items: lines.map((line) => ({ product_id: line.product.id, quantity: line.quantity })),
      customer: { name: name.trim(), phone, city: zone.city, commune: zone.commune, landmark: landmark.trim() },
      payment_method: payment,
      expected_total: total,
      website: honeypot.current?.value ?? "",
    };
    const signature = JSON.stringify(payload);
    if (attempt.current?.signature !== signature) attempt.current = { key: crypto.randomUUID(), signature };
    const idempotencyKey = attempt.current.key;

    startTransition(async () => {
      const result = await placeOrder({ ...payload, idempotencyKey });
      if (result.ok) {
        onPlaced({ order: result.order, name: name.trim(), phone, zone: zone.label, payment });
        return;
      }
      const fieldErrors: Partial<Record<FieldName, string>> = {};
      for (const [key, message] of Object.entries(result.fields ?? {})) {
        const field = API_FIELDS[key];
        if (field) fieldErrors[field] = message;
      }
      setErrors(fieldErrors);
      if (result.code === "out_of_stock" && result.available) onStockShortage(result.available);
      // La boutique a pu changer entre l'affichage et l'envoi (stock, prix, mise en congé) : on recharge ses données.
      if (["out_of_stock", "price_changed", "validation_error", "shop_on_vacation"].includes(result.code)) router.refresh();
      setNotice(
        result.code === "too_many_requests" && result.retryAfter
          ? `Trop de commandes depuis cette connexion. Réessayez dans ${formatWait(result.retryAfter)}.`
          : result.code === "price_changed" && result.total
            ? `${result.message} Nouveau total : ${formatFcfa(result.total)}.`
            : Object.keys(fieldErrors).length && result.code === "validation_error"
              ? "Certains champs sont à corriger."
              : result.message,
      );
    });
  }

  return (
    <section aria-labelledby={`${id}-titre`} className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={`${id}-titre`} className="large text-[clamp(1.5rem,3vw,2rem)] font-bold">
          Votre commande
        </h2>
        <button type="button" onClick={onBack} className="bouton-verre rounded-full px-4 py-2.5 text-sm font-semibold">
          ← Retour à la collection
        </button>
      </header>

      <form noValidate onSubmit={submit} className="grid gap-3 md:grid-cols-[1.2fr_1fr]">
        <fieldset className="verre-clair flex flex-col gap-4 rounded-[22px] p-5">
          <legend className="sr-only">Livraison</legend>
          <h3 className="text-sm font-semibold text-encre-doux">Livraison</h3>
          <Labeled id={`${id}-nom`} label="Nom complet" error={errors.name}>
            <input id={`${id}-nom`} className={INPUT} value={name} onChange={(e) => edit("name", setName)(e.target.value)} autoComplete="name" aria-invalid={!!errors.name || undefined} aria-describedby={errors.name ? `${id}-nom-erreur` : undefined} maxLength={120} />
          </Labeled>
          <Labeled id={`${id}-tel`} label="Téléphone" error={errors.phone} hint="Le livreur vous appelle à ce numéro.">
            <input id={`${id}-tel`} className={INPUT} value={phone} onChange={(e) => edit("phone", setPhone)(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="07 07 12 34 56" aria-invalid={!!errors.phone || undefined} aria-describedby={`${id}-tel-aide${errors.phone ? ` ${id}-tel-erreur` : ""}`} maxLength={24} />
          </Labeled>
          <Labeled id={`${id}-zone`} label="Commune ou ville" error={errors.zone}>
            <select id={`${id}-zone`} className={INPUT} value={zoneId} onChange={(e) => edit("zone", setZoneId)(e.target.value)} aria-invalid={!!errors.zone || undefined} aria-describedby={errors.zone ? `${id}-zone-erreur` : undefined}>
              <option value="">Choisissez…</option>
              {shop.delivery_zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.label} · livraison {formatFcfa(z.fee)}
                </option>
              ))}
            </select>
          </Labeled>
          <Labeled id={`${id}-repere`} label="Adresse ou repère" error={errors.landmark} hint="Facultatif. Par exemple : derrière la pharmacie des Deux-Plateaux.">
            <input id={`${id}-repere`} className={INPUT} value={landmark} onChange={(e) => edit("landmark", setLandmark)(e.target.value)} autoComplete="street-address" aria-invalid={!!errors.landmark || undefined} aria-describedby={`${id}-repere-aide${errors.landmark ? ` ${id}-repere-erreur` : ""}`} maxLength={160} />
          </Labeled>
          {/* Champ piège : caché aux humains (et aux lecteurs d'écran), un robot le remplit. */}
          <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
            <label htmlFor={`${id}-site`}>Site web</label>
            <input ref={honeypot} id={`${id}-site`} name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
        </fieldset>

        <div className="verre-clair flex flex-col gap-4 rounded-[22px] p-5">
          <fieldset className="flex flex-col gap-2.5">
            <legend className="mb-2 text-sm font-semibold text-encre-doux">Paiement</legend>
            <div className="grid grid-cols-2 gap-2">
              {shop.payment_methods.map((method) => (
                <label
                  key={method.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-2xl border px-3 py-2.5 text-[13.5px] font-semibold transition-colors has-focus-visible:ring-2 has-focus-visible:ring-encre",
                    payment === method.id ? "border-encre bg-[rgb(255_244_232/0.55)]" : "border-encre/20 hover:bg-[rgb(255_244_232/0.35)]",
                    method.id === "cash_on_delivery" && "col-span-2",
                  )}
                >
                  <input type="radio" name="paiement" value={method.id} checked={payment === method.id} onChange={() => setPayment(method.id)} className="radio-verre" />
                  {method.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-encre-doux">
              {payment === "cash_on_delivery"
                ? "Vous payez en espèces au livreur, à la réception."
                : `La boutique vous envoie la demande de paiement ${PAYMENT_LABEL[payment]} au numéro indiqué.`}
            </p>
          </fieldset>

          <dl className="flex flex-col gap-2 border-t border-trait-clair pt-3 text-[13.5px]">
            {lines.map(({ product, quantity }) => (
              <div key={product.id} className="flex justify-between gap-3">
                <dt className="truncate text-encre-doux">
                  {quantity} × {product.name}
                </dt>
                <dd className="whitespace-nowrap">{formatFcfa(product.price * quantity)}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3">
              <dt className="text-encre-doux">Livraison{zone ? ` · ${zone.label}` : ""}</dt>
              <dd>{zone ? formatFcfa(fee) : "selon la commune"}</dd>
            </div>
          </dl>
          <div className="flex items-baseline justify-between border-t border-trait-clair pt-3">
            <span className="text-[13px] text-encre-doux">Total à payer</span>
            <Price value={total} className="text-[clamp(30px,4vw,40px)]" />
          </div>

          {notice ? (
            <p role="alert" className="rounded-2xl border border-corail/40 bg-corail/10 px-4 py-3 text-sm text-[#8f2a1a]">
              {notice}
            </p>
          ) : null}

          <button type="submit" disabled={pending || lines.length === 0} aria-busy={pending || undefined} className="bouton-nuit inline-flex items-center justify-center gap-2 rounded-full px-5 py-3.5 font-bold disabled:cursor-not-allowed disabled:opacity-60">
            {pending ? <span aria-hidden className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : null}
            {pending ? "Envoi de la commande…" : "Confirmer la commande"}
          </button>
          <p className="text-xs text-encre-doux">Aucun compte à créer. Le prix et les frais sont vérifiés par la boutique au moment de valider.</p>
        </div>
      </form>
    </section>
  );
}

function Labeled({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </label>
      {children}
      {hint ? (
        <p id={`${id}-aide`} className="text-xs text-encre-doux">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-erreur`} className="text-[13px] text-[#8a2412]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function Confirmation({ receipt, shop, onContinue }: { receipt: Receipt; shop: Storefront; onContinue: () => void }) {
  const firstName = receipt.name.split(/\s+/)[0];
  return (
    <section aria-labelledby="confirmation-titre" className="verre-clair flex flex-col gap-5 rounded-[24px] p-6 md:p-8">
      <span aria-hidden className="grid size-12 place-items-center rounded-full bg-[#e5f5dc] text-2xl text-[#2c6a14]">
        ✓
      </span>
      <div className="flex flex-col gap-2">
        <h2 id="confirmation-titre" className="large text-[clamp(1.6rem,3.4vw,2.4rem)] leading-tight font-bold" tabIndex={-1}>
          Merci {firstName}, votre commande est enregistrée.
        </h2>
        <p className="text-encre-doux">{shop.name} vous appelle au {receipt.phone} pour convenir de la livraison.</p>
      </div>
      <dl className="grid gap-3 rounded-[18px] bg-[rgb(255_244_232/0.45)] p-4 sm:grid-cols-3">
        <div>
          <dt className="text-xs text-encre-doux">Référence à noter</dt>
          <dd className="large font-mono text-2xl font-bold tracking-wide">{receipt.order.reference}</dd>
        </div>
        <div>
          <dt className="text-xs text-encre-doux">Total</dt>
          <dd className="text-2xl">
            <Price value={receipt.order.total} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-encre-doux">Paiement</dt>
          <dd className="text-[15px] font-semibold">{PAYMENT_LABEL[receipt.payment]}</dd>
          <dd className="text-xs text-encre-doux">Livraison : {receipt.zone}</dd>
        </div>
      </dl>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={onContinue} className="bouton-nuit rounded-full px-5 py-3 font-bold">
          Continuer mes achats
        </button>
        <Link href={`/boutique/${shop.slug}/suivi?ref=${encodeURIComponent(receipt.order.reference)}`} className="bouton-verre rounded-full px-5 py-3 font-semibold">
          Suivre ma commande
        </Link>
      </div>
      <p className="text-xs text-encre-doux">Pour la suivre plus tard, il suffit de la référence et des 4 derniers chiffres de votre numéro.</p>
    </section>
  );
}
