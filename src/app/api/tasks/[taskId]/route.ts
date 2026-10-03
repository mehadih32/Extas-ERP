import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as tasks from "@/modules/reminders/task.service";

type Params = { taskId: string };

export const dynamic = "force-dynamic";

/** GET /api/tasks/:taskId */
export const GET = apiRoute<Params>(async (_request, { taskId }) =>
  tasks.getTask(await requirePermission("reminders.manage"), taskId),
);

/**
 * PATCH /api/tasks/:taskId — { title?, description?, assigneeId?, projectId?, dueAt?, priority? }
 * on an open task. A new assignee hears about it.
 */
export const PATCH = apiRoute<Params>(async (request, { taskId }) =>
  tasks.updateTask(
    await requirePermission("reminders.manage"),
    taskId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/tasks/:taskId — removes the task and its reminders. */
export const DELETE = apiRoute<Params>(async (_request, { taskId }) =>
  tasks.deleteTask(await requirePermission("reminders.manage"), taskId, await getRequestMeta()),
);
