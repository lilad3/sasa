import "server-only";

import { authed } from "@/lib/server/session";
import type { ApiKey, PlansOverview, ShopSettings } from "@/lib/types";

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
