import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { Logo } from "@/components/ui/logo";
import { logout } from "@/features/auth/actions";
import { FirstPasswordForm } from "@/features/auth/first-password-form";
import { getMe } from "@/lib/server/session";

export const metadata: Metadata = {
  title: "Première connexion",
  robots: { index: false, follow: false },
};

export default function FirstLoginPage() {
  return (
    <section className="auth-panel flex flex-col gap-5 rounded-vitre px-[26px] pt-[30px] pb-[26px] lg:px-8 lg:pt-[34px] lg:pb-7">
      <Logo />
      <Suspense fallback={<div aria-hidden className="h-[320px] rounded-champ bg-encre/30" />}>
        <FirstLogin />
      </Suspense>
    </section>
  );
}

async function FirstLogin() {
  const me = await getMe();
  if (!me.ok) throw new Error(me.problem.detail);
  // Mot de passe déjà choisi : rien à faire ici.
  if (!me.data.must_change_password) redirect("/app");

  return (
    <>
      <div>
        <h1 className="large text-[clamp(28px,3vw,38px)] leading-none font-extrabold">Bienvenue, {me.data.first_name}</h1>
        <p className="mt-2 text-texte-2">
          Votre compte a été créé par votre responsable avec un mot de passe provisoire. Remplacez-le par le vôtre pour entrer dans la boutique.
        </p>
      </div>
      <FirstPasswordForm />
      <form action={logout}>
        <button type="submit" className="text-sm text-texte-3 hover:text-texte">
          Ce n’est pas mon compte
        </button>
      </form>
    </>
  );
}
