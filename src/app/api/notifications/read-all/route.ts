import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import * as notifications from "@/modules/reminders/notification.service";

export const dynamic = "force-dynamic";

/** POST /api/notifications/read-all — marks all your messages as read. */
export const POST = apiRoute(async () =>
  notifications.markAllNotificationsRead(await requireCompany()),
);
