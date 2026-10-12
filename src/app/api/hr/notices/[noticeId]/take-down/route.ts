import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as notices from "@/modules/hr/notice.service";

type Params = { noticeId: string };

export const dynamic = "force-dynamic";

/** POST /api/hr/notices/:noticeId/take-down — staff no longer see it; it is kept for the record. */
export const POST = apiRoute<Params>(async (_request, { noticeId }) =>
  notices.takeDownNotice(await requirePermission("hr.manage"), noticeId, await getRequestMeta()),
);
