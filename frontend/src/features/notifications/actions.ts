"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { authedMutation } from "@/lib/server/session";

import { getNotifications } from "./data";
import { EVENT_ORDER } from "./text";

const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);
// Liste fermée : aucun autre identifiant ne part vers l'API. Le serveur reste seul juge de ce qui est permis.
const EventId = z.enum(EVENT_ORDER);

export type SwitchState = { done?: boolean; error?: FormError };

/** Un interrupteur : enregistre tout de suite, sans bouton « Enregistrer » à oublier. */
export async function saveEvent(_previous: SwitchState, formData: FormData): Promise<SwitchState> {
  const slug = Slug.safeParse(formData.get("slug"));
  const event = EventId.safeParse(formData.get("event"));
  const enabled = z.enum(["0", "1"]).safeParse(formData.get("enabled"));
  if (!slug.success || !event.success || !enabled.success) return { error: describeProblem(invalid()) };

  const result = await authedMutation(`shops/${slug.data}/notifications`, "PUT", { events: { [event.data]: enabled.data === "1" } });
  if (!result.ok) {
    if (result.problem.code === "invalid_event") refresh();
    return { error: describeProblem(result.problem) };
  }
  refresh();
  return { done: true };
}

/** « Revenir aux réglages d'origine » : on relit les réglages d'origine du serveur, puis on les renvoie tous. */
export async function resetEvents(_previous: SwitchState, formData: FormData): Promise<SwitchState> {
  const slug = Slug.safeParse(formData.get("slug"));
  if (!slug.success) return { error: describeProblem(invalid()) };

  const current = await getNotifications(slug.data);
  if (!current.ok) return { error: describeProblem(current.problem) };
  const events = Object.fromEntries(current.data.events.filter((row) => EventId.safeParse(row.id).success).map((row) => [row.id, row.default]));
  const result = await authedMutation(`shops/${slug.data}/notifications`, "PUT", { events });
  if (!result.ok) return { error: describeProblem(result.problem) };
  refresh();
  return { done: true };
}

export type TestState = { done?: boolean; error?: FormError };

/** L'e-mail de test part vers l'adresse du compte, jamais vers une adresse saisie. */
export async function sendTest(_previous: TestState, formData: FormData): Promise<TestState> {
  const slug = Slug.safeParse(formData.get("slug"));
  if (!slug.success) return { error: describeProblem(invalid()) };
  const result = await authedMutation(`shops/${slug.data}/notifications/test`, "POST");
  if (!result.ok) return { error: describeProblem(result.problem) };
  return { done: true };
}

function invalid() {
  return { status: 400, code: "validation_error", detail: "Demande invalide." };
}
