import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as tasks from "@/modules/reminders/task.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/tasks?status=&open=1&overdue=1&assigneeId=&projectId=&mine=1&from=&to=&search=&cursor=&take=
 * — every task in the company, soonest due first.
 */
export const GET = apiRoute(async (request) =>
  tasks.listTasks(
    await requirePermission("reminders.manage"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/tasks — { title, description?, assigneeId? (employee), projectId?, dueAt? (a day
 * or an exact time), priority? }. The assignee hears about it in the app through their login.
 */
export const POST = apiRoute(
  async (request) =>
    tasks.createTask(
      await requirePermission("reminders.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
