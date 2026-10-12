import { apiRoute, readJson } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import * as tasks from "@/modules/reminders/task.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/tasks/seen — { taskIds }: the tasks given to you that you have opened; the
 * first time is the read receipt ("Seen") management sees. Others' tasks are left alone.
 */
export const POST = apiRoute(async (request) =>
  tasks.markTasksSeen(await requireCompany(), await readJson(request)),
);
