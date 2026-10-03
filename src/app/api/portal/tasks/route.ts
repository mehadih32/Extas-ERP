import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as tasks from "@/modules/reminders/task.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/portal/tasks?status=&overdue=1&from=&to=&search=&cursor=&take= — the tasks given to
 * you (open ones unless a status is asked for), soonest due first.
 */
export const GET = apiRoute(async (request) =>
  tasks.myTasks(
    await requirePermission("portal.self"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
