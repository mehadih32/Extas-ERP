import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany } from "@/modules/auth/context";
import * as reminders from "@/modules/reminders/reminder.service";

type Params = { reminderId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/reminders/:reminderId/acknowledge — marks a reminder that went out to you as dealt
 * with, and your messages about it as read.
 */
export const POST = apiRoute<Params>(async (_request, { reminderId }) =>
  reminders.acknowledgeReminder(await requireCompany(), reminderId, await getRequestMeta()),
);
