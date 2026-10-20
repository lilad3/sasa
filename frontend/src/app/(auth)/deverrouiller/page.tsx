import type { Metadata } from "next";
import { Suspense } from "react";

import { Logo } from "@/components/ui/logo";
import { UnlockForm } from "@/features/auth/registration-forms";

export const metadata: Metadata = {
  title: "Déverrouiller le compte",
  robots: { index: false, follow: false },
};

export default function UnlockPage({ searchParams }: PageProps<"/deverrouiller">) {
  return (
    <section className="auth-panel flex flex-col gap-5 rounded-vitre px-[26px] pt-[30px] pb-[26px] lg:px-8 lg:pt-[34px] lg:pb-7">
      <Logo />
      <div>
        <h1 className="large text-[clamp(28px,3vw,38px)] leading-none font-extrabold">Déverrouiller votre compte</h1>
        <p className="mt-2 text-texte-2">Utilisez le lien de sécurité reçu par e-mail pour rétablir l&apos;accès à votre compte.</p>
      </div>
      <Suspense fallback={<div aria-hidden className="h-[100px] rounded-champ bg-encre/30" />}>
        <UnlockFormFromLink searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function UnlockFormFromLink({ searchParams }: { searchParams: PageProps<"/deverrouiller">["searchParams"] }) {
  const params = await searchParams;
  return <UnlockForm token={typeof params.token === "string" ? params.token : ""} />;
}
