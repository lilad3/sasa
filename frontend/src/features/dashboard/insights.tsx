/* ---------- Quand vos clients commandent : jour × heure ---------- */

const DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const DAY_NAMES = ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"];

/** Une seule teinte, de plus en plus lumineuse avec le nombre de commandes. */
function heat(count: number, max: number) {
  if (count === 0) return "color-mix(in oklab, var(--color-texte) 6%, transparent)";
  return `rgb(255 122 31 / ${(0.18 + 0.82 * (count / max)).toFixed(2)})`;
}

export function HoursPanel({ grid }: { grid: number[][] }) {
  const max = Math.max(...grid.flat(), 0);
  const dayTotals = grid.map((hours) => hours.reduce((sum, n) => sum + n, 0));
  const busiestDay = dayTotals.indexOf(Math.max(...dayTotals));
  let peak = { day: 0, hour: 0, count: 0 };
  for (const [day, hours] of grid.entries()) {
    for (const [hour, count] of hours.entries()) {
      if (count > peak.count) peak = { day, hour, count };
    }
  }

  return (
    <section aria-labelledby="titre-heures" className="vitre col-span-full flex flex-col gap-4 rounded-[24px] p-[18px] lg:col-span-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="titre-heures" className="text-sm text-texte-2">
            Quand vos clients commandent
          </h2>
          {max > 0 ? (
            <p className="mt-2 text-[15px]">
              Pic le <span className="font-semibold">{DAY_NAMES[peak.day]}</span> entre {peak.hour} h et {peak.hour + 1} h.{" "}
              <span className="text-texte-2">Jour le plus chargé : {DAY_NAMES[busiestDay]}.</span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-texte-3">Pas encore assez de commandes sur cette période.</p>
          )}
        </div>
        <p className="text-xs text-texte-3">Publiez vos nouveautés juste avant le pic.</p>
      </div>

      <div aria-hidden className="grid grid-cols-[30px_repeat(24,minmax(0,1fr))] gap-[2px]">
        {grid.map((hours, day) => (
          <div key={DAYS[day]} className="contents">
            <span className="self-center text-[11px] text-texte-3">{DAYS[day]}</span>
            {hours.map((count, hour) => (
              <span
                key={hour}
                title={`${DAY_NAMES[day]}, ${hour} h : ${count} commande${count > 1 ? "s" : ""}`}
                className="aspect-square rounded-[3px]"
                style={{ backgroundColor: heat(count, max) }}
              />
            ))}
          </div>
        ))}
        <span />
        {[0, 6, 12, 18].map((hour) => (
          <span key={hour} className="col-span-6 pt-1 font-mono text-[10.5px] text-texte-3">
            {hour} h
          </span>
        ))}
      </div>

      <div className="mt-auto flex items-center gap-2 text-[11px] text-texte-3" aria-hidden>
        Moins
        {[0, 0.25, 0.5, 0.75, 1].map((share) => (
          <span key={share} className="size-3 rounded-[3px]" style={{ backgroundColor: heat(share === 0 ? 0 : share * 4, 4) }} />
        ))}
        Plus
      </div>
      <p className="sr-only">
        Commandes par jour : {DAY_NAMES.map((name, day) => `${name} ${dayTotals[day]}`).join(", ")}.
      </p>
    </section>
  );
}
