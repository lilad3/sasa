import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { SecurityJournal } from "@/features/security/journal";
import { MfaPanel } from "@/features/security/mfa-panel";
import { PasswordForm } from "@/features/security/password-form";
import { SessionList } from "@/features/security/sessions";
import { getMe, getSecurityEvents, getSessions } from "@/lib/server/session";

export const metadata: Metadata = { title: "Sécurité" };

export default function SecurityPage({ params, searchParams }: PageProps<"/app/[shop]/securite">) {
  return (
    <Suspense fallback={<SecuritySkeleton />}>
      <SecurityFromRoute params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function SecurityFromRoute({ params, searchParams }: Pick<PageProps<"/app/[shop]/securite">, "params" | "searchParams">) {
  const [{ shop }, query] = await Promise.all([params, searchParams]);
  const page = Math.max(1, Number.parseInt(typeof query.journal === "string" ? query.journal : "1", 10) || 1);
  const [me, sessions, events] = await Promise.all([getMe(), getSessions(), getSecurityEvents(page)]);

  // Une page du journal qui n'existe plus (adresse ancienne) : retour à la première.
  if (!events.ok && events.problem.status === 404 && page > 1) redirect(`/app/${shop}/securite`);
  if (!me.ok || !sessions.ok || !events.ok) throw new Error("Impossible de charger la sécurité du compte.");

  return (
    <>
      <header className="col-span-full flex flex-wrap items-end justify-between gap-3 px-1 pt-1.5">
        <div>
          <p className="text-[12.5px] text-texte-2">{me.data.email}</p>
          <h1 className="mt-1.5 text-[clamp(24px,2.6vw,30px)] font-medium tracking-tight">Sécurité du compte</h1>
        </div>
        <p className="max-w-[46ch] text-[13px] text-texte-3">Ces réglages valent pour votre compte, dans toutes vos boutiques.</p>
      </header>

      {me.data.is_demo ? (
        <p role="note" className="col-span-full rounded-[18px] border border-ocre/35 bg-ocre/10 px-4 py-3 text-sm">
          <span className="font-semibold text-ocre">Compte de démonstration.</span> Son mot de passe est public : il ne peut changer ni de mot de passe ni de
          double authentification. Les sessions et le journal fonctionnent normalement.
        </p>
      ) : null}

      <MfaPanel enabled={me.data.mfa_enabled} demo={me.data.is_demo} />
      <PasswordForm demo={me.data.is_demo} />
      <SessionList sessions={sessions.data} />
      <SecurityJournal events={events.data} slug={shop} />
    </>
  );
}

function SecuritySkeleton() {
  return (
    <>
      <div aria-hidden className="col-span-full h-[70px]" />
      <div aria-hidden className="vitre col-span-full h-[260px] animate-pulse rounded-[24px] lg:col-span-6" />
      <div aria-hidden className="vitre col-span-full h-[260px] animate-pulse rounded-[24px] lg:col-span-4" />
      <div aria-hidden className="vitre col-span-full h-[220px] animate-pulse rounded-[24px]" />
    </>
  );
}
