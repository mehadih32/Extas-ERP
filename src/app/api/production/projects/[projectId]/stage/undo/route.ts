import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as projects from "@/modules/production/project.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/**
 * POST /api/production/projects/:projectId/stage/undo — { stage }. Takes back the move
 * to `stage` made by mistake, within 10 minutes of it and while nothing changed since.
 */
export const POST = apiRoute<Params>(async (request, { projectId }) =>
  projects.undoStageMove(
    await requirePermission("production.manage"),
    projectId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
