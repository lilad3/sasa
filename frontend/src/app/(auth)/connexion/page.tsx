import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { Logo } from "@/components/ui/logo";
import { LoginForm } from "@/features/auth/login-form";
import { LOGIN_REASONS } from "@/lib/messages";

export const metadata: Metadata = { title: "Connexion" };

// Comptes créés par `manage.py seed_demo` (voir backend/README.md). Désactivables avec DEMO_ACCOUNTS=0.
const DEMO_ACCOUNTS = [
  { email: "adjoua@akwaba.test", name: "Adjoua Konan", role: "propriétaire" },
  { email: "fatou@akwaba.test", name: "Fatou Diabaté", role: "gérante" },
  { email: "koffi@akwaba.test", name: "Koffi Yao", role: "vendeur" },
];
const DEMO_PASSWORD = "Demo-Vitrine-2026";

export default function LoginPage({ searchParams }: PageProps<"/connexion">) {
  return (
    <section className="auth-panel flex flex-col gap-5 rounded-vitre px-[26px] pt-[30px] pb-[26px] lg:px-8 lg:pt-[34px] lg:pb-7">
      <Logo />
      <div>
        <h1 className="large text-[clamp(30px,3.2vw,40px)] leading-none font-extrabold">Connexion</h1>
        <p className="mt-2 text-texte-2">Retrouvez vos ventes là où vous les avez laissées.</p>
      </div>
      <Suspense fallback={<LoginFormSkeleton />}>
        <LoginFormWithParams searchParams={searchParams} />
      </Suspense>
      <Link href="/inscription" className="text-center text-sm font-semibold text-pistache underline decoration-pistache/40 underline-offset-[3px]">
        Créer une boutique
      </Link>
    </section>
  );
}

async function LoginFormWithParams({ searchParams }: { searchParams: PageProps<"/connexion">["searchParams"] }) {
  const params = await searchParams;
  const reason = typeof params.raison === "string" ? LOGIN_REASONS[params.raison] : undefined;
  const next = typeof params.suite === "string" ? params.suite : "";
  const demo = process.env.DEMO_ACCOUNTS !== "0" ? { accounts: DEMO_ACCOUNTS, password: DEMO_PASSWORD } : null;
  return <LoginForm notice={reason} next={next} demo={demo} />;
}

function LoginFormSkeleton() {
  return (
    <div aria-hidden className="flex flex-col gap-4">
      {[0, 1].map((i) => (
        <div key={i} className="flex flex-col gap-2">
          <div className="h-3 w-28 rounded bg-white/10" />
          <div className="h-[50px] rounded-champ bg-encre/40" />
        </div>
      ))}
      <div className="mt-2 h-[50px] rounded-full bg-lime/40" />
    </div>
  );
}
