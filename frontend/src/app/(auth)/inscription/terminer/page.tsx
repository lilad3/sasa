import type { Metadata } from "next";
import { Suspense } from "react";

import { Logo } from "@/components/ui/logo";
import { SignupCompletionForm } from "@/features/auth/registration-forms";

export const metadata: Metadata = {
  title: "Terminer l'inscription",
  robots: { index: false, follow: false },
};

export default function CompleteSignupPage({ searchParams }: PageProps<"/inscription/terminer">) {
  return (
    <section className="auth-panel flex flex-col gap-5 rounded-vitre px-[26px] pt-[30px] pb-[26px] lg:px-8 lg:pt-[34px] lg:pb-7">
      <Logo />
      <div>
        <h1 className="large text-[clamp(28px,3vw,38px)] leading-none font-extrabold">Choisir un mot de passe</h1>
        <p className="mt-2 text-texte-2">Votre adresse e-mail confirmée, créez votre compte et votre boutique.</p>
      </div>
      <Suspense fallback={<div aria-hidden className="h-[120px] rounded-champ bg-encre/30" />}>
        <SignupFormFromLink searchParams={searchParams} />
      </Suspense>
    </section>
  );
}

async function SignupFormFromLink({ searchParams }: { searchParams: PageProps<"/inscription/terminer">["searchParams"] }) {
  const params = await searchParams;
  return <SignupCompletionForm token={typeof params.token === "string" ? params.token : ""} />;
}
