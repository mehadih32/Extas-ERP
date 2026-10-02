import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as projects from "@/modules/production/project.service";

export const dynamic = "force-dynamic";

/** GET /api/production/projects?status=&stage=&buyerId=&factoryId=&inHouse=&overdue=&search=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  projects.listProjects(
    await requirePermission("production.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/production/projects — { name, categoryId?, styleId?, factoryId? or factoryName?,
 * buyerId? (empty = In-House), startDate?, targetDate, targetQuantity,
 * status?: "PLANNED" | "ACTIVE" (default), notes? }.
 */
export const POST = apiRoute(
  async (request) =>
    projects.createProject(
      await requirePermission("production.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
