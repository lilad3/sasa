"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { describeProblem, type FormError } from "@/lib/messages";
import { confirmIdentity } from "@/lib/server/reauth";
import { authedMutation } from "@/lib/server/session";
import type { ApiKey, Member, PlansOverview, Problem, ShopSettings } from "@/lib/types";

import { GRANTABLE } from "./grants";

// Le slug et les identifiants finissent dans l'adresse de l'API : on n'accepte que leur forme attendue.
const Slug = z.string().regex(/^[a-z0-9-]{1,60}$/);

/** Texte brut, comme côté Django : ni balise ni caractère de contrôle. */
const PLAIN = /^[^<>\x00-\x08\x0b\x0c\x0e-\x1f\x7f]*$/;
const NO_TAGS = "Les caractères < et > ne sont pas acceptés.";

function plain(max: number, tooLong: string) {
  return z.string().trim().max(max, tooLong).regex(PLAIN, NO_TAGS);
}

const INVALID: FormError = { code: "validation_error", message: "Formulaire inattendu. Rechargez la page." };

/** Les erreurs de Django par champ, avec son message (déjà en français). */
function apiFields<K extends string>(problem: Problem, keys: readonly K[]) {
  const fields: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const first = problem.errors?.[key]?.[0];
    if (first) fields[key] = first.message;
  }
  return Object.keys(fields).length ? fields : undefined;
}

/** Les erreurs de zod, au premier message par champ. */
function zodFields<K extends string>(error: z.ZodError, keys: readonly K[]) {
  const flat = z.flattenError(error).fieldErrors as Record<string, string[] | undefined>;
  const fields: Partial<Record<K, string>> = {};
  for (const key of keys) if (flat[key]?.[0]) fields[key] = flat[key][0];
  return fields;
}

/* ---------- Profil de la vitrine ---------- */

const PROFILE_FIELDS = ["name", "description", "city", "accent"] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number];
export type ProfileState = { error?: FormError; fields?: Partial<Record<ProfileField, string>>; done?: string };

const Profile = z.object({
  slug: Slug,
  name: plain(60, "60 caractères au maximum.").min(2, "Au moins 2 caractères."),
  description: plain(280, "280 caractères au maximum."),
  city: plain(60, "60 caractères au maximum."),
  // Absent quand le plan ne permet pas de choisir la couleur (boutons désactivés, rien n'est envoyé).
  accent: z.enum(["orange", "indigo", "ocre", "lagune", "corail"]).optional(),
});

export async function saveProfile(_previous: ProfileState, formData: FormData): Promise<ProfileState> {
  const parsed = Profile.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name") ?? "",
    description: formData.get("description") ?? "",
    city: formData.get("city") ?? "",
    accent: formData.get("accent") ?? undefined,
  });
  if (!parsed.success) return { fields: zodFields(parsed.error, PROFILE_FIELDS) };

  const { slug, ...body } = parsed.data;
  const result = await authedMutation<ShopSettings>(`shops/${slug}/settings`, "PATCH", body);
  if (!result.ok) return { error: describeProblem(result.problem), fields: apiFields(result.problem, PROFILE_FIELDS) };
  refresh();
  return { done: "Vitrine mise à jour. Les clients voient déjà les changements." };
}

/* ---------- Mode congé ---------- */

const VACATION_FIELDS = ["vacation_message", "vacation_until"] as const;
export type VacationState = { error?: FormError; fields?: Partial<Record<(typeof VACATION_FIELDS)[number], string>>; done?: string };

const Vacation = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("start"),
    slug: Slug,
    vacation_message: plain(280, "280 caractères au maximum."),
    vacation_until: z.union([z.literal(""), z.iso.date("Date invalide.")]),
  }),
  z.object({ intent: z.literal("stop"), slug: Slug }),
]);

/**
 * Fermer la vitrine pour un temps : elle reste visible, mais Django refuse les commandes.
 * La date de retour est facultative ; une fois passée, la vitrine rouvre toute seule.
 */
export async function saveVacation(_previous: VacationState, formData: FormData): Promise<VacationState> {
  const parsed = Vacation.safeParse({
    intent: formData.get("intent"),
    slug: formData.get("slug"),
    vacation_message: formData.get("vacation_message") ?? "",
    vacation_until: formData.get("vacation_until") ?? "",
  });
  if (!parsed.success) {
    const fields = zodFields(parsed.error, VACATION_FIELDS);
    return Object.keys(fields).length ? { fields } : { error: INVALID };
  }

  const data = parsed.data;
  const body =
    data.intent === "start"
      ? { vacation_active: true, vacation_message: data.vacation_message, vacation_until: data.vacation_until || null }
      : { vacation_active: false };
  const result = await authedMutation<ShopSettings>(`shops/${data.slug}/settings`, "PATCH", body);
  if (!result.ok) return { error: describeProblem(result.problem), fields: apiFields(result.problem, VACATION_FIELDS) };
  refresh();
  return {
    done: data.intent === "start" ? "La boutique est en congé : la vitrine affiche votre message et ne prend plus de commande." : "La boutique est rouverte : les clients peuvent commander.",
  };
}

/* ---------- Plan ---------- */

export type PlanState = { reauth?: boolean; reauthError?: string; error?: FormError; done?: string; target?: string };

const PLAN_NAMES = { free: "Gratuit", pro: "Pro", business: "Business" } as const;
const PlanChange = z.object({ slug: Slug, plan: z.enum(["free", "pro", "business"]) });

/** Changer de plan engage la boutique : Django exige une confirmation renforcée de moins de 10 min. */
export async function changePlan(_previous: PlanState, formData: FormData): Promise<PlanState> {
  const parsed = PlanChange.safeParse({ slug: formData.get("slug"), plan: formData.get("plan") });
  if (!parsed.success) return { error: INVALID };
  const { slug, plan } = parsed.data;

  const identity = await confirmIdentity(formData);
  if (!identity.ok) return { reauth: true, target: plan, reauthError: identity.fieldError, error: identity.error };

  const result = await authedMutation<PlansOverview>(`shops/${slug}/plan`, "POST", { plan });
  if (!result.ok) {
    if (result.problem.code === "reauth_required") return { reauth: true, target: plan };
    // Le détail de Django dit précisément ce qui dépasse (« 30 produits pour 25 autorisés »).
    if (result.problem.code === "plan_too_small") return { target: plan, error: { code: "plan_too_small", message: result.problem.detail } };
    return { target: plan, error: describeProblem(result.problem) };
  }
  refresh();
  return { done: `Vous êtes maintenant sur le plan ${PLAN_NAMES[plan]}.` };
}

/* ---------- Équipe ---------- */

const MEMBER_FIELDS = ["email", "first_name", "last_name", "role"] as const;
export type MemberField = (typeof MEMBER_FIELDS)[number];

/** Le mot de passe provisoire n'existe qu'ici, une seule fois : Django n'en garde que l'empreinte. */
export type TemporaryAccess = { name: string; email: string; password: string; expiresAt: string | null };

export type AddMemberState = {
  reauth?: boolean;
  reauthError?: string;
  error?: FormError;
  fields?: Partial<Record<MemberField, string>>;
  created?: TemporaryAccess;
};

const NewMember = z.object({
  slug: Slug,
  email: z.email("Adresse e-mail invalide.").max(254),
  first_name: plain(80, "80 caractères au maximum.").min(1, "Indiquez le prénom."),
  last_name: plain(80, "80 caractères au maximum.").min(1, "Indiquez le nom."),
  // Un seul propriétaire par boutique : on ajoute des gérants et des vendeurs.
  role: z.enum(["manager", "seller"], "Choisissez un rôle."),
});

export async function addMember(_previous: AddMemberState, formData: FormData): Promise<AddMemberState> {
  const parsed = NewMember.safeParse({
    slug: formData.get("slug"),
    email: String(formData.get("email") ?? "").trim().toLowerCase(),
    first_name: formData.get("first_name") ?? "",
    last_name: formData.get("last_name") ?? "",
    role: formData.get("role"),
  });
  if (!parsed.success) return { fields: zodFields(parsed.error, MEMBER_FIELDS) };

  const identity = await confirmIdentity(formData);
  if (!identity.ok) return { reauth: true, reauthError: identity.fieldError, error: identity.error };

  const { slug, ...body } = parsed.data;
  const result = await authedMutation<{ member: Member; temporary_password: string }>(`shops/${slug}/members`, "POST", body);
  if (!result.ok) {
    const { problem } = result;
    if (problem.code === "reauth_required") return { reauth: true };
    if (problem.code === "account_exists") return { fields: { email: describeProblem(problem).message } };
    return { error: describeProblem(problem), fields: apiFields(problem, MEMBER_FIELDS) };
  }
  refresh();
  const { member, temporary_password } = result.data;
  return { created: { name: member.name, email: member.email ?? body.email, password: temporary_password, expiresAt: member.temporary_password_expires_at } };
}

export type MemberActionState = {
  /** L'action qui attend la confirmation renforcée. */
  reauth?: "role" | "password" | "grants";
  reauthError?: string;
  error?: FormError;
  done?: string;
  access?: TemporaryAccess;
};

const MemberAction = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("role"), slug: Slug, member: z.uuid(), role: z.enum(["manager", "seller"]) }),
  z.object({ intent: z.literal("password"), slug: Slug, member: z.uuid() }),
  z.object({ intent: z.literal("remove"), slug: Slug, member: z.uuid() }),
  z.object({ intent: z.literal("grants"), slug: Slug, member: z.uuid(), grants: z.array(z.enum(GRANTABLE)) }),
]);

/** Changer le rôle ou les pouvoirs, refaire un mot de passe provisoire, ou retirer quelqu'un de l'équipe. */
export async function memberAction(_previous: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const parsed = MemberAction.safeParse({
    intent: formData.get("intent"),
    slug: formData.get("slug"),
    member: formData.get("member"),
    role: formData.get("role") ?? undefined,
    grants: formData.getAll("grants"),
  });
  if (!parsed.success) return { error: INVALID };
  const action = parsed.data;
  const path = `shops/${action.slug}/members/${action.member}`;

  // Retirer quelqu'un coupe son accès tout de suite ; Django ne demande pas de confirmation renforcée.
  if (action.intent === "remove") {
    const result = await authedMutation(path, "DELETE");
    if (!result.ok) return { error: describeProblem(result.problem) };
    refresh();
    return { done: "Retiré de l’équipe. Ses sessions sur cette boutique sont coupées." };
  }

  const identity = await confirmIdentity(formData);
  if (!identity.ok) return { reauth: action.intent, reauthError: identity.fieldError, error: identity.error };

  if (action.intent === "role") {
    const result = await authedMutation<Member>(path, "PATCH", { role: action.role });
    if (!result.ok) {
      if (result.problem.code === "reauth_required") return { reauth: "role" };
      return { error: describeProblem(result.problem) };
    }
    refresh();
    return { done: "Rôle changé. Ses droits changent dès sa prochaine page." };
  }

  if (action.intent === "grants") {
    const result = await authedMutation<Member>(path, "PATCH", { grants: action.grants });
    if (!result.ok) {
      if (result.problem.code === "reauth_required") return { reauth: "grants" };
      return { error: describeProblem(result.problem) };
    }
    refresh();
    return { done: "Pouvoirs enregistrés. Ils s’appliquent dès sa prochaine page." };
  }

  const result = await authedMutation<{ member: Member; temporary_password: string }>(`${path}/temporary-password`, "POST");
  if (!result.ok) {
    if (result.problem.code === "reauth_required") return { reauth: "password" };
    if (result.problem.code === "password_already_chosen") refresh();
    return { error: describeProblem(result.problem) };
  }
  refresh();
  const { member, temporary_password } = result.data;
  return {
    access: { name: member.name, email: member.email ?? "", password: temporary_password, expiresAt: member.temporary_password_expires_at },
  };
}

/* ---------- Clés API ---------- */

const KEY_FIELDS = ["name", "scopes", "expires_in_days"] as const;
export type ApiKeyState = {
  reauth?: boolean;
  reauthError?: string;
  error?: FormError;
  fields?: Partial<Record<(typeof KEY_FIELDS)[number], string>>;
  /** La clé complète : affichée une seule fois, Django n'en garde que l'empreinte. */
  created?: { name: string; key: string };
};

const NewKey = z.object({
  slug: Slug,
  name: plain(60, "60 caractères au maximum.").min(2, "Donnez-lui un nom, par exemple « Comptabilité »."),
  scopes: z.array(z.enum(["catalog:read", "orders:read"])).min(1, "Cochez au moins un droit."),
  expires_in_days: z.enum(["30", "90", "365", "never"]).transform((value) => (value === "never" ? null : Number(value))),
});

export async function createApiKey(_previous: ApiKeyState, formData: FormData): Promise<ApiKeyState> {
  const parsed = NewKey.safeParse({
    slug: formData.get("slug"),
    name: formData.get("name") ?? "",
    scopes: formData.getAll("scopes"),
    expires_in_days: formData.get("expires_in_days") ?? "90",
  });
  if (!parsed.success) return { fields: zodFields(parsed.error, KEY_FIELDS) };

  const identity = await confirmIdentity(formData);
  if (!identity.ok) return { reauth: true, reauthError: identity.fieldError, error: identity.error };

  const { slug, ...body } = parsed.data;
  const result = await authedMutation<ApiKey & { key: string }>(`shops/${slug}/api-keys`, "POST", body);
  if (!result.ok) {
    if (result.problem.code === "reauth_required") return { reauth: true };
    return { error: describeProblem(result.problem), fields: apiFields(result.problem, KEY_FIELDS) };
  }
  refresh();
  return { created: { name: result.data.name, key: result.data.key } };
}

const KeyRevoke = z.object({ slug: Slug, key: z.uuid() });

/** Révoquer est immédiat et définitif : le logiciel qui utilisait la clé reçoit 401 dès son prochain appel. */
export async function revokeApiKey(formData: FormData) {
  const parsed = KeyRevoke.safeParse({ slug: formData.get("slug"), key: formData.get("key") });
  if (!parsed.success) return;
  await authedMutation(`shops/${parsed.data.slug}/api-keys/${parsed.data.key}`, "DELETE");
  refresh();
}
