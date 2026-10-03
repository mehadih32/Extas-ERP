import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import * as notifications from "@/modules/reminders/notification.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/notifications?unread=1&cursor=&take= — your in-app messages (reminders, tasks), newest
 * first, with the unread count.
 */
export const GET = apiRoute(async (request) =>
  notifications.listNotifications(
    await requireCompany(),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
