import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as followUps from "@/modules/reminders/follow-up.service";

export const dynamic = "force-dynamic";

const follower = () => requireAnyPermission("sales.view", "parties.view");

/**
 * GET /api/follow-ups — today's follow-ups (quotations ending, invoices due, promised payments,
 * "Follow up on" dates), due today or overdue, as far as this person sees them.
 * GET /api/follow-ups?partyId= | quotationId= | orderId= — the open follow-ups set on one record.
 */
export const GET = apiRoute(async (request) => {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const ctx = await follower();
  return Object.keys(query).length > 0
    ? followUps.listFollowUps(ctx, query)
    : followUps.todaysFollowUps(ctx);
});

/**
 * POST /api/follow-ups { partyId | quotationId | orderId, dueOn, note } — a "Follow up on" date
 * (buyers: parties.view; quotations and orders: sales.view). Never sent to a buyer.
 */
export const POST = apiRoute(
  async (request) =>
    followUps.createFollowUp(await follower(), await readJson(request), await getRequestMeta()),
  { successStatus: 201 },
);
