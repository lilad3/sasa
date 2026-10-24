import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { getPaymentSettings } from "@/features/settings/data";
import { OwnerOnly } from "@/features/settings/owner-only";
import { PaymentsForm } from "@/features/settings/payments-form";
import { getMe } from "@/lib/server/session";

export const metadata: Metadata = { title: "Paiements" };

export default function PaymentsPage({ params }: PageProps<"/app/[shop]/parametres/paiements">) {
  return (
    <Suspense fallback={<PaymentsSkeleton />}>
      <PaymentsFromRoute params={params} />
    </Suspense>
  );
}

async function PaymentsFromRoute({ params }: Pick<PageProps<"/app/[shop]/parametres/paiements">, "params">) {
  const { shop } = await params;
  return (
    <OwnerOnly slug={shop} what="Les paiements">
      {(name) => <PaymentsContent slug={shop} shopName={name} />}
    </OwnerOnly>
  );
}

async function PaymentsContent({ slug, shopName }: { slug: string; shopName: string }) {
  const [settings, me] = await Promise.all([getPaymentSettings(slug), getMe()]);
  if (!settings.ok) throw new Error(settings.problem.detail);
  if (!me.ok) throw new Error("Impossible de charger votre compte.");

  return (
    <>
      <header className="col-span-full flex flex-col gap-1.5 px-1 pt-1.5">
        <p className="text-[12.5px] text-texte-2">
          <Link href={`/app/${slug}/parametres`} className="hover:underline">
            Paramètres
          </Link>{" "}
          · {shopName}
        </p>
        <h1 className="text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Paiements</h1>
        <p className="max-w-[64ch] text-[14px] text-texte-2">
          Choisissez comment vos clients peuvent payer. Pour un Mobile Money, donnez le numéro qui reçoit l’argent : il s’affiche au client après sa commande.
        </p>
        <p className="text-[13px] text-texte-3">{settings.data.summary}</p>
      </header>
      {/* key : après un enregistrement, le formulaire repart des valeurs du serveur. */}
      <PaymentsForm key={JSON.stringify(settings.data.methods)} slug={slug} settings={settings.data} mfaEnabled={me.data.mfa_enabled} />
    </>
  );
}

function PaymentsSkeleton() {
  return (
    <>
      <div aria-hidden className="col-span-full h-[110px]" />
      <div aria-hidden className="vitre col-span-full h-[460px] animate-pulse rounded-[24px] lg:col-span-8" />
    </>
  );
}
