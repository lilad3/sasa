import type { Metadata } from "next";
import { Suspense } from "react";

import { Logo } from "@/components/ui/logo";
import { ResetForm } from "@/features/auth/reset-form";

export const metadata: Metadata = {
  title: "Nouveau mot de passe",
  // Le lien contient un jeton secret : il ne doit pas être indexé.
  robots: { index: false, follow: false },
};

export default function ResetPasswordPage({ searchParams }: PageProps<"/nouveau-mot-de-passe">) {
  return (
    <section className="auth-panel flex flex-col gap-5 rounded-vitre px-[26px] pt-[30px] pb-[26px] lg:px-8 lg:pt-[34px] lg:pb-7">
      <Logo />
      <div>
        <h1 className="large text-[clamp(26px,2.8vw,36px)] leading-none font-extrabold">Nouveau mot de passe</h1>
        <p className="mt-2 text-texte-2">Choisissez un mot de passe d'au moins 10 caractères. Une phrase courte et inhabituelle fonctionne très bien.</p>
      </div>
      <Suspense fallback={<div aria-hidden className="h-[220px] rounded-champ bg-encre/30" />}>
        <ResetFromLink searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function ResetFromLink({ searchParams }: { searchParams: PageProps<"/nouveau-mot-de-passe">["searchParams"] }) {
  const params = await searchParams;
  const uid = typeof params.uid === "string" ? params.uid : "";
  const token = typeof params.token === "string" ? params.token : "";
  return <ResetForm uid={uid} token={token} />;
}
