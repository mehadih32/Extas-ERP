import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as rules from "@/modules/reminders/rules";

type Params = { type: string };

export const dynamic = "force-dynamic";

/**
 * PATCH /api/reminders/rules/:type — { isActive?, daysBefore? ([7, 3, 1, 0]), overdueEveryDays?,
 * sendTime? ("09:00"), notifyManagers?, notifyOwner?, userIds?, employeeIds? } for
 * PRODUCTION_DEADLINE, GOODS_IN_HOUSE, SHIPMENT, COMPLIANCE_EXPIRY or TASK_DUE.
 */
export const PATCH = apiRoute<Params>(async (request, { type }) =>
  rules.updateRule(
    await requirePermission("company.settings"),
    type,
    await readJson(request),
    await getRequestMeta(),
  ),
);
