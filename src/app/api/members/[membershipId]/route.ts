import { z } from "zod";

import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { changeMemberRole, setMemberActive } from "@/modules/rbac/member.service";

type Params = { membershipId: string };

const bodySchema = z
  .object({ roleId: z.string().min(1).optional(), isActive: z.boolean().optional() })
  .refine((v) => v.roleId !== undefined || v.isActive !== undefined, {
    message: "Provide roleId and/or isActive",
  });

/** PATCH /api/members/:membershipId — { roleId?, isActive? } */
export const PATCH = apiRoute<Params>(async (request, { membershipId }) => {
  const ctx = await requirePermission("company.members.manage");
  const body = bodySchema.parse(await readJson(request));
  const meta = await getRequestMeta();
  let result;
  if (body.roleId !== undefined)
    result = await changeMemberRole(ctx, membershipId, body.roleId, meta);
  if (body.isActive !== undefined)
    result = await setMemberActive(ctx, membershipId, body.isActive, meta);
  return result;
});
