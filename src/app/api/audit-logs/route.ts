import { AuditAction } from "@prisma/client";
import { z } from "zod";

import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import { listAuditLogs } from "@/modules/audit/audit.service";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  action: z.enum(AuditAction).optional(),
  entityType: z.string().max(60).optional(),
  userId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  cursor: z.string().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

/** GET /api/audit-logs?action=&entityType=&userId=&from=&to=&cursor=&take= */
export const GET = apiRoute(async (request) => {
  const ctx = await requirePermission("audit.view");
  const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
  return listAuditLogs({ ...query, companyId: ctx.company.id });
});
