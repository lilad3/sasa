/** Jauge indicative : la vraie règle est vérifiée par Django (liste noire, similarité, motifs locaux). */
function strength(password: string) {
  if (password.length < 10) return { level: password ? 1 : 0, label: password ? "Trop court : au moins 10 caractères" : "" };
  let score = 2;
  if (password.length >= 14) score++;
  if (/[^A-Za-z0-9]/.test(password) || (/[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) score++;
  return { level: Math.min(score, 4), label: ["", "", "Correct", "Solide", "Très solide"][Math.min(score, 4)] };
}

export function PasswordMeter({ password }: { password: string }) {
  const meter = strength(password);
  return (
    <>
      <div aria-hidden className="grid grid-cols-4 gap-1.5">
        {[1, 2, 3, 4].map((step) => (
          <span key={step} className={`h-1 rounded-full ${meter.level >= step ? (meter.level >= 3 ? "bg-indigo-clair" : "bg-alerte") : "bg-white/10"}`} />
        ))}
      </div>
      {meter.label ? <p className="text-[13px] text-texte-3">{meter.label}</p> : null}
    </>
  );
}
