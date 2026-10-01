import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { addMember, listMembers } from "@/modules/rbac/member.service";

export const dynamic = "force-dynamic";

/** GET /api/members — users of the active company with their roles. */
export const GET = apiRoute(async () =>
  listMembers(await requirePermission("company.members.manage")),
);

/** POST /api/members — { email, name, phone?, roleId } */
export const POST = apiRoute(
  async (request) => {
    const ctx = await requirePermission("company.members.manage");
    return addMember(ctx, await readJson(request), await getRequestMeta());
  },
  { successStatus: 201 },
);
