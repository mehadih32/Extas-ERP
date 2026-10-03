import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as tasks from "@/modules/reminders/task.service";

type Params = { taskId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/tasks/:taskId/status — { status: TODO | IN_PROGRESS | DONE }: start, finish
 * or reopen a task given to you. Whoever gave it hears when it is done.
 */
export const POST = apiRoute<Params>(async (request, { taskId }) =>
  tasks.setMyTaskStatus(
    await requirePermission("portal.self"),
    taskId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
