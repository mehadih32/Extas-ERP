import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import * as notifications from "@/modules/reminders/notification.service";

export const dynamic = "force-dynamic";

/** GET /api/notifications/unread-count — { unread } for the bell. */
export const GET = apiRoute(async () => notifications.unreadCount(await requireCompany()));
