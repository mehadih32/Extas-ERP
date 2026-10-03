import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as rules from "@/modules/reminders/rules";

export const dynamic = "force-dynamic";

/**
 * GET /api/reminders/rules — the automatic reminder settings for each kind of date (production
 * deadlines, goods in-house, shipments, licence expiry, task due dates): the days before, the
 * send time, the overdue repeat and who is told.
 */
export const GET = apiRoute(async () =>
  rules.listRules(await requireAnyPermission("reminders.manage", "company.settings")),
);
