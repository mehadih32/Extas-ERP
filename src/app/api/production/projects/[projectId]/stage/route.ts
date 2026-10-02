import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as projects from "@/modules/production/project.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/projects/:projectId/stage — { stage, note? }. Moving back to an
 * earlier stage needs a note.
 */
export const POST = apiRoute<Params>(async (request, { projectId }) =>
  projects.setProjectStage(
    await requirePermission("production.manage"),
    projectId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
