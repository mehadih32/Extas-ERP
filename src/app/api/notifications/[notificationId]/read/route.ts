import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import * as notifications from "@/modules/reminders/notification.service";

type Params = { notificationId: string };

export const dynamic = "force-dynamic";

/** POST /api/notifications/:notificationId/read — marks one of your messages as read. */
export const POST = apiRoute<Params>(async (_request, { notificationId }) =>
  notifications.markNotificationRead(await requireCompany(), notificationId),
);
