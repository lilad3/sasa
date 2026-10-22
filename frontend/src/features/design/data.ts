import "server-only";

import { authed } from "@/lib/server/session";
import type { DesignOverview, DesignVersion } from "@/lib/types";

export async function getDesign(slug: string) {
  return authed<DesignOverview>(`shops/${encodeURIComponent(slug)}/storefront`);
}

export async function getDesignVersions(slug: string) {
  return authed<DesignVersion[]>(`shops/${encodeURIComponent(slug)}/storefront/versions`);
}
