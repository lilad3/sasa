import "server-only";

import { authed } from "@/lib/server/session";
import type { NotificationsSettings } from "@/lib/types";

export async function getNotifications(slug: string) {
  return authed<NotificationsSettings>(`shops/${encodeURIComponent(slug)}/notifications`);
}
