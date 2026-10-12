import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as notices from "@/modules/hr/notice.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/hr/notices?show=current|ended|all — the notice board with who has read each notice and
 * who has not yet (hr.manage).
 */
export const GET = apiRoute(async (request) =>
  notices.listNotices(
    await requirePermission("hr.manage"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/hr/notices — { title, body, pinned?, showUntil? }: posts a notice for every employee;
 * staff with a login are told in the app (and by push once it is connected).
 */
export const POST = apiRoute(
  async (request) =>
    notices.postNotice(
      await requirePermission("hr.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
