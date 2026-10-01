import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { resetMemberPassword } from "@/modules/rbac/member.service";

/** POST /api/members/:membershipId/reset-password — returns a one-time temporary password. */
export const POST = apiRoute<{ membershipId: string }>(async (_request, { membershipId }) => {
  const ctx = await requirePermission("company.members.manage");
  return resetMemberPassword(ctx, membershipId, await getRequestMeta());
});
