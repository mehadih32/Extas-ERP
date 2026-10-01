import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { deleteRole, updateRole } from "@/modules/rbac/role.service";

type Params = { roleId: string };

/** PATCH /api/roles/:roleId — { name?, description?, permissions? } */
export const PATCH = apiRoute<Params>(async (request, { roleId }) => {
  const ctx = await requirePermission("company.roles.manage");
  await updateRole(ctx, roleId, await readJson(request), await getRequestMeta());
  return null;
});

/** DELETE /api/roles/:roleId — custom roles with no users only. */
export const DELETE = apiRoute<Params>(async (_request, { roleId }) => {
  const ctx = await requirePermission("company.roles.manage");
  await deleteRole(ctx, roleId, await getRequestMeta());
  return null;
});
