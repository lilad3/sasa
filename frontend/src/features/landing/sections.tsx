import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

import { PricingSimulator } from "./pricing";

/* ---------- Petits éléments partagés ---------- */

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("font-mono text-xs tracking-[0.1em] uppercase", className)}>{children}</p>;
}

function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h2 className={cn("large max-w-[22ch] text-[clamp(1.7rem,4vw,2.8rem)] leading-[1.05] font-bold text-balance", className)}>
      {children}
    </h2>
  );
}

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  arrow: "M7 17L17 7M9 7h8v8",
  shield: "M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z M9 12l2 2 4-4",
  phone: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M11 18h2",
  bell: "M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z M10 20a2 2 0 0 0 4 0",
  people: "M9 11a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 9 11z M3.5 19c.8-3.2 3-5 5.5-5s4.7 1.8 5.5 5 M16 5.2a3 3 0 0 1 0 5.6 M17.5 14.4c1.6.7 2.6 2.3 3 4.6",
  repeat: "M4 12a8 8 0 0 1 14-5.3L20 9 M20 4v5h-5 M20 12a8 8 0 0 1-14 5.3L4 15 M4 20v-5h5",
  book: "M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h10",
};

/* ---------- 1. Ce que vous obtenez ---------- */

const PAYMENTS = [
  { label: "À la livraison", dot: "bg-sable" },
  { label: "Orange Money", dot: "bg-orange" },
  { label: "MTN MoMo", dot: "bg-ocre" },
  { label: "Moov Money", dot: "bg-indigo-clair" },
  { label: "Wave", dot: "bg-[#6fd3bf]" },
];

const ROLES = [
  { name: "Propriétaire", rights: "tout, dont le plan et les clés API", dot: "bg-orange" },
  { name: "Gérant", rights: "ventes, commandes et catalogue", dot: "bg-indigo" },
  { name: "Vendeur", rights: "commandes, sans le chiffre d’affaires", dot: "bg-lagune" },
];

const ZONES = [
  ["Cocody", "1 500 F"],
  ["Yopougon", "1 500 F"],
  ["Port-Bouët", "2 000 F"],
  ["Grand-Bassam", "2 500 F"],
  ["Bouaké", "3 000 F"],
  ["Korhogo", "3 500 F"],
];

// Courbe d'exemple : douze mois de chiffre d'affaires, en millions de F CFA.
const SAMPLE = [2.9, 3.1, 3.0, 3.4, 3.3, 3.6, 3.5, 3.9, 4.1, 4.0, 4.4, 4.8];

function Sparkline() {
  const W = 320;
  const H = 90;
  const points = SAMPLE.map((v, i) => [(i / (SAMPLE.length - 1)) * W, H - ((v - 2.6) / 2.4) * H] as const);
  const line = points.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-[90px] w-full" preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id="landing-spark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#4a57d6" stopOpacity="0.3" />
          <stop offset="1" stopColor="#4a57d6" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${line} L${W} ${H} L0 ${H} Z`} fill="url(#landing-spark)" />
      <path d={line} fill="none" stroke="#3b45b8" strokeWidth="2.5" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function Features() {
  return (
    <section id="fonctionnalites" className="surface-orange scroll-mt-24 px-4 py-24 scheme-light md:py-28">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-10">
        <header className="flex flex-col gap-3">
          <Eyebrow className="text-encre">Ce que vous obtenez</Eyebrow>
          <SectionTitle>
            Une vitrine qui donne envie, <span className="font-light">des ventes que vous suivez en direct.</span>
          </SectionTitle>
        </header>

        <div className="grid gap-3 md:grid-cols-6">
          <Link
            href="/boutique/maison-adjoua"
            className="group relative flex min-h-[380px] flex-col justify-between overflow-hidden rounded-[28px] bg-nuit p-6 text-creme md:col-span-4 md:row-span-2"
          >
            <div aria-hidden className="absolute inset-0 bg-[url('/decor.jpg')] bg-cover bg-center opacity-80 transition-transform duration-700 group-hover:scale-[1.03]" />
            <div aria-hidden className="absolute inset-0 bg-gradient-to-b from-nuit/60 via-transparent to-nuit/90" />
            <div className="relative flex flex-col gap-2">
              <Eyebrow className="text-sable">Votre boutique, en couverture</Eyebrow>
              <p className="large text-[clamp(2.4rem,6vw,4.4rem)] leading-[0.86] font-extrabold">
                MAISON
                <br />
                ADJOUA
              </p>
            </div>
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <p className="max-w-[34ch] text-sm text-texte-2">
                Votre article phare fait la une, comme la couverture d’un magazine. Vos clients commandent sans créer de compte.
              </p>
              <span className="bouton-nuit inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold">
                Pousser la porte <Icon path={ICONS.arrow} className="size-4" />
              </span>
            </div>
          </Link>

          <article className="verre-clair flex flex-col gap-3 overflow-hidden rounded-[24px] p-5 md:col-span-2">
            <h3 className="text-lg font-semibold">Vos ventes, en direct</h3>
            <p className="flex items-baseline gap-2">
              <span className="chiffres text-[clamp(2rem,3.6vw,2.6rem)]">4 812 500</span>
              <span className="text-encre-doux">F</span>
              <span className="ml-auto rounded-full bg-[#e5f5dc] px-2 py-0.5 text-xs font-semibold text-[#2c6a14]">+12,4 %</span>
            </p>
            <p className="text-sm text-encre-doux">Chiffre d’affaires du mois, mis à jour à chaque commande.</p>
            <div className="-mx-5 -mb-5 mt-auto">
              <Sparkline />
            </div>
          </article>

          <article className="verre-clair flex flex-col gap-3 rounded-[24px] p-5 md:col-span-2">
            <h3 className="text-lg font-semibold">Payé comme vos clients préfèrent</h3>
            <ul className="flex flex-wrap gap-1.5" aria-label="Moyens de paiement">
              {PAYMENTS.map((p) => (
                <li key={p.label} className="inline-flex items-center gap-1.5 rounded-full bg-encre px-3 py-1.5 text-[13px] font-semibold text-creme">
                  <span aria-hidden className={cn("size-2 rounded-full", p.dot)} />
                  {p.label}
                </li>
              ))}
            </ul>
            <p className="text-sm text-encre-doux">Espèces au livreur ou Mobile Money : le client choisit au moment de commander.</p>
          </article>

          <article className="verre-clair flex flex-col gap-3 rounded-[24px] p-5 md:col-span-3">
            <h3 className="text-lg font-semibold">Votre équipe, vos règles</h3>
            <ul className="flex flex-col gap-2">
              {ROLES.map((role) => (
                <li key={role.name} className="flex items-center gap-3 rounded-xl bg-[rgb(255_244_232/0.4)] px-3 py-2.5 text-sm">
                  <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", role.dot)} />
                  <span className="font-semibold">{role.name}</span>
                  <span className="ml-auto text-right text-[13px] text-encre-doux">{role.rights}</span>
                </li>
              ))}
            </ul>
          </article>

          <article className="verre-clair flex flex-col gap-3 rounded-[24px] p-5 md:col-span-3">
            <h3 className="text-lg font-semibold">Livraison calculée pour vous</h3>
            <p className="text-sm text-encre-doux">15 zones, du Plateau à Korhogo. Les frais s’ajoutent tout seuls au panier.</p>
            <ul className="mt-auto flex flex-wrap gap-1.5">
              {ZONES.map(([zone, fee]) => (
                <li key={zone} className="rounded-full border border-trait-clair px-3 py-1.5 text-[13px]">
                  {zone} <span className="font-mono text-encre-doux">· {fee}</span>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </div>
    </section>
  );
}

/* ---------- 2. Comment ça marche ---------- */

const STEPS = [
  { title: "Créez votre boutique", text: "Votre e-mail, le nom de la boutique, un mot de passe, et c’est parti : la boutique est prête en une minute.", tone: "bg-encre text-creme" },
  { title: "Partagez le lien", text: "Sur WhatsApp, Instagram ou TikTok : vos clients ouvrent la vitrine et commandent directement.", tone: "bg-indigo text-creme" },
  { title: "Suivez chaque franc", text: "Commandes, chiffre d’affaires et meilleurs produits, sur ordinateur comme sur téléphone.", tone: "bg-[#237264] text-creme" },
];

export function Steps() {
  return (
    <section className="surface-orange px-4 pt-8 pb-24 scheme-light">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-10">
        <header className="flex flex-col gap-3">
          <Eyebrow className="text-encre">Comment ça marche</Eyebrow>
          <SectionTitle>
            Trois étapes, <span className="font-light">aucune compétence technique.</span>
          </SectionTitle>
        </header>
        <ol className="grid gap-3 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="verre-clair flex flex-col gap-4 rounded-[24px] p-6">
              <span aria-hidden className={cn("large grid size-12 place-items-center rounded-full text-xl font-extrabold", step.tone)}>
                {i + 1}
              </span>
              <h3 className="text-xl font-semibold">{step.title}</h3>
              <p className="text-encre-doux">{step.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------- 3. Sécurité ---------- */

const SECURITY = [
  { icon: ICONS.shield, title: "Double authentification", text: "Un code à 6 chiffres en plus du mot de passe, et des codes de secours si vous perdez votre téléphone.", tone: "text-orange-clair" },
  { icon: ICONS.phone, title: "Mode appareil partagé", text: "Au cybercafé ou sur un téléphone prêté : déconnexion automatique après 15 minutes sans activité.", tone: "text-indigo-clair" },
  { icon: ICONS.bell, title: "Alerte nouvel appareil", text: "Un e-mail dès qu’une connexion arrive d’un appareil inconnu, avec un lien pour tout couper.", tone: "text-ocre" },
  { icon: ICONS.people, title: "Des rôles par boutique", text: "Le vendeur traite les commandes sans voir votre chiffre d’affaires. Le serveur vérifie à chaque action.", tone: "text-[#6fd3bf]" },
  { icon: ICONS.repeat, title: "Jamais de commande en double", text: "Même quand le réseau coupe au moment de valider, la commande n’est enregistrée qu’une fois.", tone: "text-orange-clair" },
  { icon: ICONS.book, title: "Un journal qu’on ne peut pas effacer", text: "Chaque action sensible est enregistrée et chaînée : une trace retouchée se voit tout de suite.", tone: "text-indigo-clair" },
];

export function Security() {
  return (
    <section className="relative overflow-hidden bg-nuit px-4 py-24 text-texte">
      <div aria-hidden className="absolute inset-0 bg-[url('/decor.jpg')] bg-cover bg-center opacity-25" />
      <div className="relative mx-auto flex max-w-[1120px] flex-col gap-10">
        <header className="flex flex-col gap-3">
          <Eyebrow className="text-sable">Sécurité</Eyebrow>
          <SectionTitle>
            Pensée pour la vraie vie, <span className="font-light">pas pour une démo.</span>
          </SectionTitle>
          <p className="max-w-[60ch] text-texte-2">
            Téléphone prêté, réseau qui coupe, mot de passe réutilisé : Akwaba part du principe que ça arrivera, et vous protège quand même.
          </p>
        </header>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {SECURITY.map((item) => (
            <li key={item.title} className="vitre flex flex-col gap-3 rounded-[24px] p-5">
              <Icon path={item.icon} className={cn("size-6", item.tone)} />
              <h3 className="text-lg font-semibold">{item.title}</h3>
              <p className="text-sm text-texte-2">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------- 4. Partenaires et intégrations (les tiers) ---------- */

export function Partners() {
  return (
    <section id="partenaires" className="scroll-mt-24 bg-[#141838] px-4 py-24 text-texte">
      <div className="mx-auto grid max-w-[1120px] items-center gap-10 md:grid-cols-2">
        <div className="flex flex-col gap-4">
          <Eyebrow className="text-indigo-clair">Partenaires et développeurs</Eyebrow>
          <SectionTitle>
            Livreur, comptable, agence ? <span className="font-light">Branchez-vous sur Akwaba.</span>
          </SectionTitle>
          <p className="text-texte-2">
            Le marchand crée une clé API depuis son espace, avec des droits limités (lire le catalogue, lire les commandes) et une date
            d’expiration. Il peut la couper à tout moment, et voit quand elle a servi pour la dernière fois.
          </p>
          <ul className="flex flex-wrap gap-2 text-[13px]">
            <li className="rounded-full border border-indigo-clair/30 px-3 py-1.5">Clé révocable à tout moment</li>
            <li className="rounded-full border border-indigo-clair/30 px-3 py-1.5">Droits par clé</li>
            <li className="rounded-full border border-indigo-clair/30 px-3 py-1.5">120 requêtes par minute</li>
          </ul>
          <p className="inline-flex items-center gap-2 self-start rounded-full bg-ocre px-3 py-1 text-xs font-semibold text-encre">
            Bientôt · inclus dans le plan Pro
          </p>
        </div>
        <figure className="overflow-hidden rounded-[24px] border border-white/10 bg-[#0b0e24]">
          <figcaption className="flex items-center gap-1.5 border-b border-white/10 px-4 py-3 font-mono text-xs text-texte-3">
            <span aria-hidden className="size-2.5 rounded-full bg-corail" />
            <span aria-hidden className="size-2.5 rounded-full bg-ocre" />
            <span aria-hidden className="size-2.5 rounded-full bg-lagune" />
            <span className="ml-2">Exemple : les commandes du jour</span>
          </figcaption>
          <pre className="overflow-x-auto p-5 font-mono text-[13px] leading-relaxed text-texte-2">
            <code>
              <span className="text-indigo-clair">curl</span> https://api.akwaba.ci/api/public/v1/orders \{"\n"}
              {"  "}-H <span className="text-ocre">&quot;Authorization: Bearer akw_live_…&quot;</span>
              {"\n\n"}
              <span className="text-texte-3">{"// 200"}</span>
              {"\n"}
              {"{ "}
              <span className="text-orange-clair">&quot;reference&quot;</span>: <span className="text-ocre">&quot;K7F-92Q&quot;</span>,{" "}
              <span className="text-orange-clair">&quot;total&quot;</span>: <span className="text-[#6fd3bf]">27000</span>, …{" }"}
            </code>
          </pre>
        </figure>
      </div>
    </section>
  );
}

/* ---------- 5. Tarifs ---------- */

export function Pricing() {
  return (
    <section id="tarifs" className="surface-orange scroll-mt-24 px-4 py-24 scheme-light">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-10">
        <header className="flex flex-col gap-3">
          <Eyebrow className="text-encre">Tarifs</Eyebrow>
          <SectionTitle>
            Un seul critère : <span className="font-light">le nombre de commandes que vous recevez.</span>
          </SectionTitle>
        </header>
        <PricingSimulator />
      </div>
    </section>
  );
}

/* ---------- 6. Questions fréquentes ---------- */

const FAQ = [
  ["Faut-il savoir créer un site ?", "Non. Vous remplissez le nom de la boutique et vos produits, Akwaba s’occupe de la vitrine, du panier et des commandes."],
  ["Mes clients doivent-ils créer un compte ?", "Non. Ils ouvrent votre lien, choisissent leurs articles, indiquent leur numéro et leur quartier, et c’est tout."],
  ["Comment sont calculés les frais de livraison ?", "Selon la commune ou la ville choisie par le client. Le montant est recalculé par le serveur : personne ne peut le modifier dans le navigateur."],
  ["Que se passe-t-il si le réseau coupe pendant une commande ?", "Le téléphone renvoie la même commande avec la même clé : elle n’est enregistrée qu’une seule fois, jamais en double."],
  ["Mon vendeur peut-il voir mon chiffre d’affaires ?", "Non, sauf si vous lui donnez le rôle de gérant. Le vendeur voit et traite les commandes, rien de plus."],
];

export function Faq() {
  return (
    <section className="surface-orange px-4 pb-24 scheme-light">
      <div className="mx-auto grid max-w-[1120px] gap-8 md:grid-cols-[1fr_1.6fr]">
        <header className="flex flex-col gap-3">
          <Eyebrow className="text-encre">Questions fréquentes</Eyebrow>
          <SectionTitle className="text-[clamp(1.5rem,3vw,2.2rem)] leading-[1.1]">Ce qu’on nous demande le plus.</SectionTitle>
        </header>
        <div className="flex flex-col border-t border-trait-clair">
          {FAQ.map(([question, answer]) => (
            <details key={question} className="group border-b border-trait-clair py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                {question}
                <span aria-hidden className="verre-clair grid size-8 shrink-0 place-items-center rounded-full transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-[62ch] text-encre">{answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------- 7. Appel final et pied de page ---------- */

export function Footer() {
  return (
    <footer className="bg-nuit px-4 pt-20 pb-8 text-texte">
      <div className="mx-auto flex max-w-[1120px] flex-col gap-12">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <SectionTitle className="max-w-[18ch]">
            Votre boutique peut être en ligne <span className="font-light">avant ce soir.</span>
          </SectionTitle>
          <div className="flex flex-wrap gap-2">
            <Link href="/inscription" className="bouton-nuit rounded-full px-6 py-3.5 font-semibold">
              Créer ma boutique
            </Link>
            <Link href="/connexion" className="rounded-full border border-white/20 px-6 py-3.5 font-semibold hover:bg-white/10">
              Se connecter
            </Link>
          </div>
        </div>
        <p
          aria-hidden
          className="large bg-gradient-to-r from-indigo via-orange to-ocre bg-clip-text text-[16vw] leading-[0.82] font-extrabold whitespace-nowrap text-transparent lg:text-[180px]"
        >
          AKWABA
        </p>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm text-texte-2">
          <Link href="/boutique/maison-adjoua" className="underline decoration-white/30 underline-offset-[3px] hover:decoration-white">
            Visiter Maison Adjoua
          </Link>
          <a href="#tarifs" className="underline decoration-white/30 underline-offset-[3px] hover:decoration-white">
            Tarifs
          </a>
          <a href="#partenaires" className="underline decoration-white/30 underline-offset-[3px] hover:decoration-white">
            Partenaires
          </a>
          <span>contact@akwaba.ci</span>
          <span className="ml-auto font-mono text-xs text-texte-3">© 2026 Akwaba · Abidjan</span>
        </div>
      </div>
    </footer>
  );
}
