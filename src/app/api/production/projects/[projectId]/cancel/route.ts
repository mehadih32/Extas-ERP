import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as projects from "@/modules/production/project.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/projects/:projectId/cancel — { reason }. Open deliveries are cancelled;
 * cost that never reached stock is written off, which needs Accounts (accounts.manage).
 */
export const POST = apiRoute<Params>(async (request, { projectId }) =>
  projects.cancelProject(
    await requireAnyPermission("production.manage", "accounts.manage"),
    projectId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
