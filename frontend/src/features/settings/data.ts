import "server-only";

import { authed } from "@/lib/server/session";
import type { ApiKey, Paginated, PlansOverview, SecurityOverview, ShopActivityEvent, ShopSettings } from "@/lib/types";

// Toutes ces routes sont réservées au propriétaire : Django répond 403 aux autres rôles.

export async function getShopSettings(slug: string) {
  return authed<ShopSettings>(`shops/${encodeURIComponent(slug)}/settings`);
}

export async function getPlans(slug: string) {
  return authed<PlansOverview>(`shops/${encodeURIComponent(slug)}/plans`);
}

export async function getApiKeys(slug: string) {
  return authed<ApiKey[]>(`shops/${encodeURIComponent(slug)}/api-keys`);
}

export type ActivityKind = "sensible" | "tout";

export async function getShopActivity(slug: string, kind: ActivityKind, page: number) {
  return authed<Paginated<ShopActivityEvent>>(`shops/${encodeURIComponent(slug)}/activity?type=${kind}&page=${page}&page_size=25`);
}

export async function getSecurityOverview(slug: string) {
  return authed<SecurityOverview>(`shops/${encodeURIComponent(slug)}/security-overview`);
}
