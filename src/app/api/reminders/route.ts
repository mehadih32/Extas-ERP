import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requireCompany } from "@/modules/auth/context";
import * as reminders from "@/modules/reminders/reminder.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/reminders?status=&type=&automatic=0|1&all=1&projectId=&orderId=&purchaseOrderId=
 * &complianceDocumentId=&taskId=&cursor=&take= — the reminders you set or are on, latest first
 * (everyone's with all=1 and reminders.manage).
 */
export const GET = apiRoute(async (request) =>
  reminders.listReminders(
    await requireCompany(),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/reminders — { title, message?, remindAt (exact time) or day + time? (company time,
 * default 09:00), repeat? { every: DAY | WEEK | MONTH | YEAR, interval?, until? }, userIds?,
 * employeeIds? (nobody = yourself; other people need reminders.manage), projectId?, orderId?,
 * purchaseOrderId?, complianceDocumentId?, taskId?, type? }. In-app for now.
 */
export const POST = apiRoute(
  async (request) =>
    reminders.createReminder(
      await requireAnyPermission("notepad.use", "reminders.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
