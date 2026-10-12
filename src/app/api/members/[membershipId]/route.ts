import { z } from "zod";

import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { changeMemberRole, setMemberAccess, setMemberActive } from "@/modules/rbac/member.service";

type Params = { membershipId: string };

const bodySchema = z
  .object({
    roleId: z.string().min(1).optional(),
    isActive: z.boolean().optional(),
    permissions: z.array(z.string()).optional(),
  })
  .refine((v) => v.roleId !== undefined || v.isActive !== undefined || v.permissions, {
    message: "Provide roleId, isActive and/or permissions",
  });

/**
 * PATCH /api/members/:membershipId — { roleId?, isActive?, permissions? }.
 * `permissions` is everything the member may do (the permission matrix), kept
 * as changes to the role's; it needs company.roles.manage too.
 */
export const PATCH = apiRoute<Params>(async (request, { membershipId }) => {
  const ctx = await requirePermission("company.members.manage");
  const body = bodySchema.parse(await readJson(request));
  const meta = await getRequestMeta();
  let result;
  if (body.permissions !== undefined)
    result = await setMemberAccess(
      ctx,
      membershipId,
      { roleId: body.roleId, permissions: body.permissions },
      meta,
    );
  else if (body.roleId !== undefined)
    result = await changeMemberRole(ctx, membershipId, body.roleId, meta);
  if (body.isActive !== undefined)
    result = await setMemberActive(ctx, membershipId, body.isActive, meta);
  return result;
});
