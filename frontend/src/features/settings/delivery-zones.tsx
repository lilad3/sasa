"use client";

import { type FormEvent, startTransition, useActionState, useState } from "react";

import { Button } from "@/components/ui/button";
import { FormAlert } from "@/features/auth/form-alert";
import type { DeliverySettings, ShopZone } from "@/lib/types";
import { payoutVoice } from "@/lib/voice";

import { AddZoneForm } from "./add-zone-form";
import { type DeliveryState, deleteZone, reorderZones, saveZones } from "./delivery-actions";
import { type ZoneDraft, ZoneRow } from "./zone-row";

const initial: DeliveryState = {};

type Group = { city: string; zones: ShopZone[] };

/** Les zones groupées par ville, dans l'ordre du serveur ; la zone sans commune porte le nom de la ville. */
function grouped(zones: ShopZone[]): Group[] {
  const groups: Group[] = [];
  for (const zone of zones) {
    const group = groups.find((item) => item.city === zone.city);
    if (group) group.zones.push(zone);
    else groups.push({ city: zone.city, zones: [zone] });
  }
  return groups;
}

const toDraft = (zone: ShopZone): ZoneDraft => ({ fee: String(zone.fee), delay: String(zone.delay_hours), active: zone.is_active });
const draftsOf = (zones: ShopZone[]) => Object.fromEntries(zones.map((zone) => [zone.id, toDraft(zone)]));

/**
 * Les zones de livraison. Un seul bouton enregistre toutes les lignes modifiées (le serveur applique tout ou rien) ;
 * l'ordre, l'ajout et la suppression partent tout de suite, chacun de son côté.
 */
export function DeliveryZones({ slug, delivery }: { slug: string; delivery: DeliverySettings }) {
  const [saved, saveAction, saving] = useActionState(saveZones, initial);
  const [moved, moveAction, moving] = useActionState(reorderZones, initial);
  const [removed, removeAction, removing] = useActionState(deleteZone, initial);
  const [unreadable, setUnreadable] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, ZoneDraft>>(() => draftsOf(delivery.zones));
  // Les valeurs du serveur changent après un enregistrement (pas après un simple changement d'ordre) : la saisie repart d'elles.
  const serverKey = [...delivery.zones].sort((a, b) => a.id.localeCompare(b.id)).map((zone) => `${zone.id}:${zone.fee}:${zone.delay_hours}:${zone.is_active}`).join("|");
  const [seen, setSeen] = useState(serverKey);
  if (seen !== serverKey) {
    setSeen(serverKey);
    setDrafts(draftsOf(delivery.zones));
    setUnreadable({});
  }

  const changes = delivery.zones.filter((zone) => {
    const draft = drafts[zone.id];
    return draft && (draft.fee.trim() !== String(zone.fee) || draft.delay.trim() !== String(zone.delay_hours) || draft.active !== zone.is_active);
  });
  const activeLeft = delivery.zones.filter((zone) => (drafts[zone.id] ?? toDraft(zone)).active).length;
  const blocked = changes.length > 0 && activeLeft === 0 && !delivery.pickup.enabled;
  const busy = saving || moving || removing;
  const fields = { ...removed.fields, ...moved.fields, ...saved.fields, ...unreadable };
  const problem = saved.error ?? moved.error ?? removed.error;
  const status = saved.done && !saving ? saved.done : (moved.done && !moving ? moved.done : removed.done && !removing ? removed.done : "");

  function patch(id: string, change: Partial<ZoneDraft>) {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...change } }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (changes.length === 0 || blocked) return;
    // Un champ vidé ou qui n'est pas un entier est signalé sur sa ligne, sans appeler le serveur.
    const problems: Record<string, string> = {};
    const body = changes.map((zone) => {
      const draft = drafts[zone.id];
      const fee = draft.fee.replace(/[\s\u00a0\u202f]/g, "");
      const delay = draft.delay.trim();
      if (!/^\d{1,7}$/.test(fee)) problems[`zone.${zone.id}.fee`] = "Entrez un nombre entier de francs.";
      if (!/^\d{1,3}$/.test(delay)) problems[`zone.${zone.id}.delay_hours`] = "Entrez un nombre entier d’heures.";
      return { id: zone.id, fee: Number(fee), delay_hours: Number(delay), is_active: draft.active };
    });
    setUnreadable(problems);
    if (Object.keys(problems).length) return;
    const data = new FormData();
    data.set("slug", slug);
    data.set("zones", JSON.stringify(body));
    startTransition(() => saveAction(data));
  }

  function move(zone: ShopZone, direction: -1 | 1) {
    // On échange la zone avec sa voisine de la même ville : l'ordre complet part au serveur.
    const group = grouped(delivery.zones).find((item) => item.city === zone.city);
    const index = group?.zones.findIndex((item) => item.id === zone.id) ?? -1;
    const neighbour = group?.zones[index + direction];
    if (!neighbour) return;
    const ids = delivery.zones.map((item) => item.id);
    const a = ids.indexOf(zone.id);
    const b = ids.indexOf(neighbour.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    const data = new FormData();
    data.set("slug", slug);
    data.set("ids", JSON.stringify(ids));
    startTransition(() => moveAction(data));
  }

  function remove(zone: ShopZone) {
    const data = new FormData();
    data.set("slug", slug);
    data.set("id", zone.id);
    startTransition(() => removeAction(data));
  }

  return (
    <section aria-labelledby="titre-zones" className="vitre col-span-full flex flex-col gap-4 self-start rounded-[24px] p-[18px] lg:col-span-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="titre-zones" className="text-sm text-texte-2">
          Zones de livraison
        </h2>
        <p className="text-[12.5px] text-texte-3">
          {delivery.limits.count} sur {delivery.limits.zones}
        </p>
      </div>
      {problem ? <FormAlert tone="danger">{problem.message}</FormAlert> : null}

      {delivery.zones.length === 0 ? (
        <p className="text-sm text-texte-2">Aucune zone pour l’instant. {payoutVoice.deliveryNone}.</p>
      ) : (
        <form onSubmit={submit} noValidate className="flex flex-col gap-4">
          {grouped(delivery.zones).map((group) => (
            <section key={group.city} aria-label={group.city}>
              <h3 className="text-[13px] font-semibold tracking-wide text-ocre uppercase">{group.city}</h3>
              <ul>
                {group.zones.map((zone, index) => (
                  <ZoneRow
                    key={zone.id}
                    zone={zone}
                    draft={drafts[zone.id] ?? toDraft(zone)}
                    onDraft={(change) => patch(zone.id, change)}
                    name={zone.commune || zone.city}
                    feeError={fields[`zone.${zone.id}.fee`]}
                    delayError={fields[`zone.${zone.id}.delay_hours`]}
                    busy={busy}
                    onMove={(direction) => move(zone, direction)}
                    canUp={index > 0}
                    canDown={index < group.zones.length - 1}
                    onDelete={() => remove(zone)}
                    limits={delivery.limits}
                  />
                ))}
              </ul>
            </section>
          ))}

          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[13.5px] text-texte-2" aria-live="polite">
              {changes.length > 0 ? `${changes.length} zone${changes.length > 1 ? "s" : ""} modifiée${changes.length > 1 ? "s" : ""}` : ""}
            </p>
            <Button type="submit" disabled={changes.length === 0 || blocked} pending={saving} pendingLabel="Enregistrement…">
              {blocked ? payoutVoice.keepOneOption : "Enregistrer les zones"}
            </Button>
            <p role="status" className="text-[13.5px] text-texte-2">
              {status}
            </p>
          </div>
        </form>
      )}

      <AddZoneForm slug={slug} limits={delivery.limits} />
    </section>
  );
}
