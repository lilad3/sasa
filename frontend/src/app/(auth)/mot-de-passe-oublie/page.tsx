import type { Metadata } from "next";

import { Logo } from "@/components/ui/logo";
import { ForgotForm } from "@/features/auth/forgot-form";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <section className="auth-panel flex flex-col gap-5 rounded-vitre px-[26px] pt-[30px] pb-[26px] lg:px-8 lg:pt-[34px] lg:pb-7">
      <Logo />
      <div>
        <h1 className="large text-[clamp(26px,2.8vw,36px)] leading-none font-extrabold">Mot de passe oublié</h1>
        <p className="mt-2 text-texte-2">Indiquez l’adresse de votre compte : nous vous envoyons un lien pour en choisir un nouveau.</p>
      </div>
      <ForgotForm />
    </section>
  );
}
