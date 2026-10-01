import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import { listPermissionCatalog } from "@/modules/rbac/role.service";

export const dynamic = "force-dynamic";

/** GET /api/permissions — every grantable permission, for the role editor. */
export const GET = apiRoute(async () => {
  await requirePermission("company.roles.manage");
  return listPermissionCatalog();
});
