import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as reminders from "@/modules/reminders/reminder.service";

type Params = { reminderId: string };

export const dynamic = "force-dynamic";

/** POST /api/reminders/:reminderId/cancel — stops a reminder set by hand before it goes out. */
export const POST = apiRoute<Params>(async (_request, { reminderId }) =>
  reminders.cancelReminder(
    await requireAnyPermission("notepad.use", "reminders.manage"),
    reminderId,
    await getRequestMeta(),
  ),
);
