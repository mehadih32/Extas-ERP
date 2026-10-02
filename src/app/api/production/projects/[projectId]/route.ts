import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as projects from "@/modules/production/project.service";

type Params = { projectId: string };

export const dynamic = "force-dynamic";

/** GET /api/production/projects/:projectId — timeline, stage history, deliveries, costs. */
export const GET = apiRoute<Params>(async (_request, { projectId }) =>
  projects.getProject(await requirePermission("production.view"), projectId),
);

/** PATCH /api/production/projects/:projectId — edit details (closed projects: name and notes). */
export const PATCH = apiRoute<Params>(async (request, { projectId }) =>
  projects.updateProject(
    await requirePermission("production.manage"),
    projectId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
