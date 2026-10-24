import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getNotifications } from "@/features/notifications/data";
import { EventRow } from "@/features/notifications/event-row";
import { ResetEvents, SendTest } from "@/features/notifications/footer-actions";
import { EVENT_TEXT } from "@/features/notifications/text";
import { getMyShops } from "@/lib/server/session";
import { voice } from "@/lib/voice";

export const metadata: Metadata = { title: "Notifications" };

// Ouverte à tous les rôles : chacun règle ses propres e-mails. Page autonome tant que le cadre des Paramètres (P04) n'est pas intégré.
export default function NotificationsPage({ params }: PageProps<"/app/[shop]/parametres/notifications">) {
  return (
    <Suspense fallback={<NotificationsSkeleton />}>
      <NotificationsFromRoute params={params} />
    </Suspense>
  );
}

async function NotificationsFromRoute({ params }: Pick<PageProps<"/app/[shop]/parametres/notifications">, "params">) {
  const { shop } = await params;
  const [shops, settings] = await Promise.all([getMyShops(), getNotifications(shop)]);
  if (!shops.ok) throw new Error("Impossible de charger vos boutiques.");
  const membership = shops.data.find((item) => item.slug === shop);
  if (!membership) notFound();
  if (!settings.ok) {
    if (settings.problem.status === 404) notFound();
    throw new Error("Impossible de charger les notifications.");
  }

  const words = voice(membership.role, membership.name);
  // Un identifiant que ce front ne connaît pas est ignoré : un serveur plus récent ne casse pas un front plus ancien.
  const rows = settings.data.events.filter((event) => EVENT_TEXT[event.id]);
  const anyCustom = rows.some((event) => event.custom);

  return (
    <>
      <header className="col-span-full px-1 pt-1.5">
        <h1 className="text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Notifications</h1>
        <p className="mt-1.5 max-w-[60ch] text-[14px] text-texte-2">{words.notificationsIntro}</p>
      </header>

      {settings.data.sending ? (
        <p role="status" className="col-span-full rounded-[18px] border border-indigo-clair/30 bg-indigo/10 px-4 py-3 text-sm lg:col-span-10">
          Les e-mails partent à <strong className="font-semibold">{settings.data.email}</strong>.
        </p>
      ) : (
        <p role="note" className="col-span-full rounded-[18px] border border-ocre/35 bg-ocre/10 px-4 py-3 text-sm lg:col-span-10">
          <span className="font-semibold text-ocre">L’envoi d’e-mails n’est pas encore activé sur ce serveur.</span> Vos choix sont gardés.
        </p>
      )}

      <section aria-labelledby="titre-emails" className="vitre col-span-full flex flex-col gap-2 rounded-[24px] p-[18px] lg:col-span-6">
        <h2 id="titre-emails" className="text-sm text-texte-2">
          E-mails
        </h2>
        {rows.length ? (
          <ul className="divide-y divide-trait-doux">
            {rows.map((event) => (
              <EventRow key={event.id} slug={shop} event={event} text={EVENT_TEXT[event.id]} />
            ))}
          </ul>
        ) : (
          <p className="text-[13.5px] text-texte-3">Aucun e-mail à régler pour votre rôle dans cette boutique.</p>
        )}
        <ResetEvents slug={shop} anyCustom={anyCustom} />
      </section>

      <aside className="col-span-full flex flex-col gap-2.5 lg:col-span-4 md:gap-3">
        <section aria-labelledby="titre-canaux" className="vitre flex flex-col gap-2 rounded-[24px] p-[18px]">
          <h2 id="titre-canaux" className="text-sm text-texte-2">
            Canaux
          </h2>
          <p className="text-[14px]">
            E-mail · <span className="text-texte-3">WhatsApp : bientôt</span>
          </p>
          <p className="text-[13px] text-texte-3">
            Quand l’espace est ouvert, les nouvelles commandes s’affichent aussi en direct, avec un son si vous l’avez demandé.
          </p>
        </section>
        <section aria-labelledby="titre-test" className="vitre flex flex-col gap-3 rounded-[24px] p-[18px]">
          <h2 id="titre-test" className="text-sm text-texte-2">
            Vérifier la réception
          </h2>
          <p className="text-[13px] text-texte-3">Un e-mail de test part vers l’adresse de votre compte, jamais ailleurs.</p>
          <SendTest slug={shop} sending={settings.data.sending} />
        </section>
      </aside>
    </>
  );
}

function NotificationsSkeleton() {
  return (
    <>
      <div aria-hidden className="col-span-full h-[70px]" />
      <div aria-hidden className="vitre col-span-full h-[360px] animate-pulse rounded-[24px] lg:col-span-6" />
      <div aria-hidden className="vitre col-span-full h-[200px] animate-pulse rounded-[24px] lg:col-span-4" />
    </>
  );
}
