import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as actionLog from "@/modules/production/action-log.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/projects/:projectId/action-log?userId=&kind=&before= — the style's
 * Employee Action Log: every input on it, newest first, with when, who and what
 * (production.view, and production.manage or accounts.view).
 */
export const GET = apiRoute<Params>(async (request, { projectId }) =>
  actionLog.getActionLog(
    await requirePermission("production.view"),
    { projectId },
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
