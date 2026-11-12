import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as followUps from "@/modules/reminders/follow-up.service";

export const dynamic = "force-dynamic";

/** POST /api/follow-ups/snooze { mark, until } — the follow-up comes back on that day. */
export const POST = apiRoute(async (request) =>
  followUps.snoozeFollowUp(
    await requireAnyPermission("sales.view", "parties.view"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
