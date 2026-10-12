import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as notices from "@/modules/hr/notice.service";

type Params = { noticeId: string };

export const dynamic = "force-dynamic";

/** POST /api/hr/notices/:noticeId/put-back — puts a notice taken down back on the board. */
export const POST = apiRoute<Params>(async (_request, { noticeId }) =>
  notices.putBackNotice(await requirePermission("hr.manage"), noticeId, await getRequestMeta()),
);
