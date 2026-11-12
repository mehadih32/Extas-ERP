import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as followUps from "@/modules/reminders/follow-up.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/follow-ups/done { target: "followUp", id } | { target: "date", kind, recordId, day }
 * — marks a follow-up (or a quotation's or invoice's date) done: it leaves Home and its
 * reminders stop.
 */
export const POST = apiRoute(async (request) =>
  followUps.markFollowUpDone(
    await requireAnyPermission("sales.view", "parties.view"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
