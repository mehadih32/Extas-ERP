import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import * as reminders from "@/modules/reminders/reminder.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/reminders/upcoming?days=7 — the planner's agenda: production deadlines, goods due
 * in-house, shipments and licence renewals your role can see, your tasks and your reminders,
 * day by day from today, plus everything overdue.
 */
export const GET = apiRoute(async (request) =>
  reminders.upcoming(await requireCompany(), Object.fromEntries(new URL(request.url).searchParams)),
);
