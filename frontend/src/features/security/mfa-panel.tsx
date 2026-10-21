"use client";

import { useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { FormAlert } from "@/features/auth/form-alert";
import { cn } from "@/lib/cn";
import { formatWait } from "@/lib/messages";

import { mfaAction, type MfaState } from "./actions";

const initial: MfaState = {};

const INTENT_TEXT = {
  disable: "désactiver la double authentification",
  regenerate: "créer de nouveaux codes de secours",
};

/**
 * Le QR code arrive de Django en SVG. On l'affiche comme une image, jamais injecté dans la page :
 * une image SVG ne peut pas exécuter de script.
 */
function qrSource(svg: string) {
  const withNamespace = svg.includes("xmlns=") ? svg : svg.replace("<svg", '<svg xmlns="http://www.w3.org/2000/svg"');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(withNamespace)}`;
}

export function MfaPanel({ enabled, demo }: { enabled: boolean; demo: boolean }) {
  const [state, formAction, pending] = useActionState(mfaAction, initial);

  return (
    <section aria-labelledby="titre-2fa" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="titre-2fa" className="text-sm text-texte-2">
          Double authentification
        </h2>
        <span className={cn("inline-flex items-center gap-1.5 text-[13px] font-semibold", enabled ? "text-vert" : "text-alerte")}>
          <span aria-hidden className="h-3.5 w-1 rounded-sm bg-current" />
          {enabled ? "Active" : "Désactivée"}
        </span>
      </div>

      {state.error ? (
        <FormAlert tone="danger">
          <p>{state.error.message}</p>
          {state.error.retryAfter ? <p className="mt-1 font-semibold">Réessayez dans {formatWait(state.error.retryAfter)}.</p> : null}
        </FormAlert>
      ) : null}
      {state.done ? <FormAlert tone="success">{state.done}</FormAlert> : null}

      <form action={formAction} noValidate className="flex flex-col gap-4">
        {state.step === "scan" && state.setup ? (
          <ScanStep qr={state.setup.qr} secret={state.setup.secret} codeError={state.codeError} pending={pending} />
        ) : state.step === "codes" && state.codes ? (
          <RecoveryCodes codes={state.codes} />
        ) : state.step === "reauth" && state.intent ? (
          <ReauthStep intent={state.intent} codeError={state.codeError} pending={pending} />
        ) : enabled ? (
          <>
            <p className="max-w-[56ch] text-[14.5px] text-texte-2">
              Chaque connexion demande le code de votre application en plus du mot de passe. Un mot de passe volé ne suffit plus pour entrer.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button type="submit" name="intent" value="regenerate" variant="ghost" pending={pending} disabled={demo} className="px-5 py-2.5 text-sm">
                Nouveaux codes de secours
              </Button>
              <button
                type="submit"
                name="intent"
                value="disable"
                disabled={pending || demo}
                className="rounded-full px-4 py-2.5 text-sm text-texte-3 hover:text-danger-clair disabled:cursor-not-allowed disabled:opacity-60"
              >
                Désactiver
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="max-w-[56ch] text-[14.5px] text-texte-2">
              Ajoutez un code à 6 chiffres, donné par une application de votre téléphone, à chaque connexion. Si quelqu’un trouve votre mot de passe, il
              lui manquera encore votre téléphone.
            </p>
            <Button type="submit" name="intent" value="setup" pending={pending} pendingLabel="Préparation…" disabled={demo} className="self-start">
              Activer la double authentification
            </Button>
          </>
        )}
      </form>
    </section>
  );
}

function ScanStep({ qr, secret, codeError, pending }: { qr: string; secret: string; codeError?: string; pending: boolean }) {
  return (
    <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
      {/* Fond crème : un lecteur de QR code a besoin d'un contraste net. */}
      <div className="self-start rounded-[18px] bg-creme p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- image SVG en data URI, rien à optimiser */}
        <img src={qrSource(qr)} alt="QR code à scanner avec votre application d’authentification" width={168} height={168} className="size-[168px]" />
      </div>
      <div className="flex min-w-0 flex-col gap-3.5">
        <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-texte-2 marker:text-texte-3">
          <li>Ouvrez Google Authenticator, Microsoft Authenticator ou Aegis.</li>
          <li>Scannez le QR code, ou saisissez la clé ci-dessous.</li>
          <li>Tapez le code à 6 chiffres qui s’affiche.</li>
        </ol>
        <p className="text-xs text-texte-3">
          Clé à saisir à la main
          <span className="mt-1 block font-mono text-[13px] tracking-wider break-all text-texte select-all">{secret.match(/.{1,4}/g)?.join(" ")}</span>
        </p>
        <Field
          id="code-activation"
          name="code"
          label="Code à 6 chiffres"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          error={codeError}
          className="font-mono text-xl tracking-[0.4em]"
          required
        />
        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="submit" name="intent" value="confirm" pending={pending} pendingLabel="Vérification…">
            Activer
          </Button>
          <button type="submit" name="intent" value="reset" formNoValidate className="rounded-full px-4 py-2.5 text-sm text-texte-3 hover:text-texte">
            Annuler
          </button>
        </div>
      </div>
    </div>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const [stored, setStored] = useState(false);
  const text = `Codes de secours Akwaba — chacun ne sert qu'une fois.\n\n${codes.join("\n")}\n`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(codes.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "akwaba-codes-de-secours.txt";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[60ch] text-[14.5px] text-texte-2">
        Si vous perdez votre téléphone, chacun de ces codes remplace une fois le code de l’application.{" "}
        <strong className="font-semibold text-texte">Ils ne seront plus jamais affichés</strong> : rangez-les ailleurs que sur ce téléphone.
      </p>
      <ul aria-label="Codes de secours" className="carte grid grid-cols-2 gap-x-6 gap-y-2 rounded-carte p-4 font-mono text-[15px] tracking-wider">
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="button" variant="ghost" onClick={copy} className="px-5 py-2.5 text-sm">
          {copied ? "Copiés" : "Copier"}
        </Button>
        <Button type="button" variant="ghost" onClick={download} className="px-5 py-2.5 text-sm">
          Télécharger (.txt)
        </Button>
        <span role="status" className="sr-only">
          {copied ? "Codes copiés dans le presse-papiers." : ""}
        </span>
      </div>
      <label className="flex items-center gap-2.5 text-sm">
        <input type="checkbox" checked={stored} onChange={(event) => setStored(event.target.checked)} className="size-4 accent-orange" />
        J’ai rangé ces codes en lieu sûr.
      </label>
      <Button type="submit" name="intent" value="reset" disabled={!stored} className="self-start">
        Terminer
      </Button>
    </div>
  );
}

function ReauthStep({ intent, codeError, pending }: { intent: "regenerate" | "disable"; codeError?: string; pending: boolean }) {
  return (
    <div className="flex flex-col gap-3.5 rounded-[18px] border border-ocre/30 bg-ocre/[0.07] p-4">
      <p className="text-[14.5px]">
        <span className="font-semibold">Confirmez que c’est bien vous.</span> Pour {INTENT_TEXT[intent]}, saisissez le code actuel de votre
        application. La confirmation reste valable 10 minutes.
      </p>
      <Field
        id="code-confirmation"
        name="proof"
        label="Code à 6 chiffres"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={7}
        autoFocus
        error={codeError}
        className="font-mono text-xl tracking-[0.4em]"
        required
      />
      <div className="flex flex-wrap items-center gap-2.5">
        <Button type="submit" name="intent" value={intent} pending={pending} pendingLabel="Vérification…">
          Confirmer
        </Button>
        <button type="submit" name="intent" value="reset" formNoValidate className="rounded-full px-4 py-2.5 text-sm text-texte-3 hover:text-texte">
          Annuler
        </button>
      </div>
    </div>
  );
}
