import type { Metadata } from "next";
import { Suspense } from "react";

import { Logo } from "@/components/ui/logo";
import { SignupRequestForm } from "@/features/auth/registration-forms";
import { getSignupEmailVerification } from "@/lib/server/signup";

export const metadata: Metadata = { title: "Créer une boutique" };

export default function SignupPage() {
  return (
    <section className="auth-panel flex flex-col gap-5 rounded-vitre px-[26px] pt-[30px] pb-[26px] lg:px-8 lg:pt-[34px] lg:pb-7">
      <Logo />
      <Suspense fallback={<SignupSkeleton />}>
        <SignupForMode />
      </Suspense>
    </section>
  );
}

/** Django dit s'il envoie un lien de confirmation (SIGNUP_EMAIL_VERIFICATION) : le formulaire suit. */
async function SignupForMode() {
  const emailVerification = await getSignupEmailVerification();
  return (
    <>
      <div>
        <h1 className="large text-[clamp(28px,3vw,38px)] leading-none font-extrabold">Créer votre boutique</h1>
        <p className="mt-2 text-texte-2">
          {emailVerification
            ? "Nous vous envoyons un lien pour confirmer votre adresse et choisir un mot de passe."
            : "Votre compte et votre boutique sont prêts dès l’envoi du formulaire."}
        </p>
      </div>
      <SignupRequestForm emailVerification={emailVerification} />
    </>
  );
}

function SignupSkeleton() {
  return (
    <>
      <div aria-hidden className="h-[70px]" />
      <div aria-hidden className="h-[380px] animate-pulse rounded-champ bg-encre/30" />
    </>
  );
}
