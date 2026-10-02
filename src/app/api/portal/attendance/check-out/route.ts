import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as attendance from "@/modules/hr/attendance.service";

export const dynamic = "force-dynamic";

/** POST /api/portal/attendance/check-out — { note? }. */
export const POST = apiRoute(async (request) =>
  attendance.checkOut(
    await requirePermission("portal.self"),
    await readJson(request),
    await getRequestMeta(),
  ),
);
