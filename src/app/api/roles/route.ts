import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { createRole, listRoles } from "@/modules/rbac/role.service";

export const dynamic = "force-dynamic";

/** GET /api/roles — roles in the active company. */
export const GET = apiRoute(async () =>
  listRoles(await requirePermission("company.members.manage")),
);

/** POST /api/roles — { name, description?, permissions[] } */
export const POST = apiRoute(
  async (request) => {
    const ctx = await requirePermission("company.roles.manage");
    return createRole(ctx, await readJson(request), await getRequestMeta());
  },
  { successStatus: 201 },
);
