import Link from "next/link";

import { formatDateTime } from "@/lib/format";
import { getMyShops } from "@/lib/server/session";

import { getPaymentSettings } from "./data";

/**
 * En haut des pages du propriétaire : un nouveau numéro de réception attend ses 24 h. Si ce changement n'est pas le sien,
 * c'est le moment de l'annuler. Rien tant qu'il n'y a pas d'attente, et rien pour les autres rôles.
 */
export async function PayoutPendingBanner({ slug }: { slug: string }) {
  const shops = await getMyShops();
  if (!shops.ok) return null;
  const membership = shops.data.find((item) => item.slug === slug);
  if (!membership?.permissions.includes("shop.manage")) return null;

  const settings = await getPaymentSettings(slug);
  if (!settings.ok) return null;
  const waiting = settings.data.methods.filter((method) => method.pending);
  if (waiting.length === 0) return null;

  return (
    <section aria-label="Changement de numéro en attente" className="col-span-full flex flex-wrap items-center justify-between gap-3 rounded-[18px] bg-ocre px-4 py-3 text-encre">
      <p className="max-w-[70ch] text-[14px]">
        <span className="font-bold">Numéro de réception en attente.</span>{" "}
        {waiting.map((method) => `${method.short} : le nouveau numéro servira dès le ${formatDateTime(method.pending!.activates_at)}`).join(" ; ")}. D’ici là, vos clients voient l’ancien. Ce changement n’est pas de vous ?
        Annulez-le.
      </p>
      <Link href={`/app/${slug}/parametres/paiements`} className="shrink-0 rounded-full border border-encre/60 px-4 py-2 text-[13.5px] font-bold hover:bg-encre/10">
        Voir et annuler
      </Link>
    </section>
  );
}

export async function PayoutPendingBannerFromRoute({ params }: { params: Promise<{ shop: string }> }) {
  const { shop } = await params;
  return <PayoutPendingBanner slug={shop} />;
}
