import { apiRoute, readJson } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as notices from "@/modules/hr/notice.service";

export const dynamic = "force-dynamic";

/** POST /api/portal/notices/read — { noticeIds }: the notices you have read (HR sees when). */
export const POST = apiRoute(async (request) =>
  notices.markNoticesRead(await requirePermission("portal.self"), await readJson(request)),
);
