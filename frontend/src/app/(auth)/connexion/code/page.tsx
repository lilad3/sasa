import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Logo } from "@/components/ui/logo";
import { MfaForm } from "@/features/auth/mfa-form";
import { readMfaCookie } from "@/lib/server/cookies";

export const metadata: Metadata = { title: "Code de vérification" };

export default function MfaPage({ searchParams }: PageProps<"/connexion/code">) {
  return (
    <section className="auth-panel flex flex-col gap-5 rounded-vitre px-[26px] pt-[30px] pb-[26px] lg:px-8 lg:pt-[34px] lg:pb-7">
      <Logo />
      <div>
        <h1 className="large text-[clamp(28px,3vw,38px)] leading-none font-extrabold">Vérification</h1>
        <p className="mt-2 text-texte-2">
          Saisissez le code à 6 chiffres affiché par votre application d’authentification (Google Authenticator, Authy…).
        </p>
      </div>
      <Suspense fallback={<div aria-hidden className="h-[180px] rounded-champ bg-encre/30" />}>
        <PendingChallenge searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function PendingChallenge({ searchParams }: { searchParams: PageProps<"/connexion/code">["searchParams"] }) {
  // Sans étape 1 réussie (mot de passe), cette page n'a pas lieu d'être.
  if (!readMfaCookie(await cookies())) redirect("/connexion?raison=code_expire");
  const params = await searchParams;
  return <MfaForm next={typeof params.suite === "string" ? params.suite : ""} />;
}
