import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as tasks from "@/modules/reminders/task.service";

type Params = { taskId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/:taskId/status — { status: TODO | IN_PROGRESS | DONE | CANCELLED }. Done tells
 * whoever created it; cancelled tells the assignee.
 */
export const POST = apiRoute<Params>(async (request, { taskId }) =>
  tasks.setTaskStatus(
    await requirePermission("reminders.manage"),
    taskId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
