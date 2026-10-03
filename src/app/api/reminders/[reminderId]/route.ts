import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requireCompany } from "@/modules/auth/context";
import * as reminders from "@/modules/reminders/reminder.service";

type Params = { reminderId: string };

export const dynamic = "force-dynamic";

/** GET /api/reminders/:reminderId — one you set or are on (any with reminders.manage). */
export const GET = apiRoute<Params>(async (_request, { reminderId }) =>
  reminders.getReminder(await requireCompany(), reminderId),
);

/**
 * PATCH /api/reminders/:reminderId — { title?, message?, remindAt? or day + time?, repeat? (null
 * stops it), userIds?, employeeIds?, links? } on a reminder set by hand that has not gone out.
 */
export const PATCH = apiRoute<Params>(async (request, { reminderId }) =>
  reminders.updateReminder(
    await requireAnyPermission("notepad.use", "reminders.manage"),
    reminderId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/reminders/:reminderId — removes a reminder set by hand. */
export const DELETE = apiRoute<Params>(async (_request, { reminderId }) =>
  reminders.deleteReminder(
    await requireAnyPermission("notepad.use", "reminders.manage"),
    reminderId,
    await getRequestMeta(),
  ),
);
