import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as projects from "@/modules/production/project.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/projects/:projectId/complete — { writeOffReason?, note? }. Production
 * completes a project once its cost has moved to stock; cost left over is written off, with a
 * reason, by Accounts (accounts.manage).
 */
export const POST = apiRoute<Params>(async (request, { projectId }) =>
  projects.completeProject(
    await requireAnyPermission("production.manage", "accounts.manage"),
    projectId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
