import type { Metadata } from "next";

import { Logo } from "@/components/ui/logo";
import { SignupRequestForm } from "@/features/auth/registration-forms";

export const metadata: Metadata = { title: "Créer une boutique" };

export default function SignupPage() {
  return (
    <section className="auth-panel flex flex-col gap-5 rounded-vitre px-[26px] pt-[30px] pb-[26px] lg:px-8 lg:pt-[34px] lg:pb-7">
      <Logo />
      <div>
        <h1 className="large text-[clamp(28px,3vw,38px)] leading-none font-extrabold">Créer votre boutique</h1>
        <p className="mt-2 text-texte-2">Nous vous envoyons un lien pour confirmer votre adresse et choisir un mot de passe.</p>
      </div>
      <SignupRequestForm />
    </section>
  );
}
