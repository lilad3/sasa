import { Field } from "./field";

/**
 * Champ de confirmation renforcée, posé dans le formulaire de l'action grave quand Django la demande.
 * Le compte avec 2FA donne un code, les autres leur mot de passe (lib/server/reauth.ts).
 */
export function ReauthFields({ mfaEnabled, what, error }: { mfaEnabled: boolean; what: string; error?: string }) {
  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-ocre/30 bg-ocre/[0.07] p-4">
      <p className="text-[14px]">
        <span className="font-semibold">Confirmez que c’est bien vous</span> pour {what}. La confirmation reste valable 10 minutes.
      </p>
      {mfaEnabled ? (
        <Field
          id="reauth-code"
          name="reauth_code"
          label="Code de votre application"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          autoFocus
          error={error}
          className="font-mono text-xl tracking-[0.4em]"
          required
        />
      ) : (
        <Field id="reauth-password" name="reauth_password" type="password" label="Votre mot de passe" autoComplete="current-password" autoFocus error={error} required />
      )}
    </div>
  );
}
