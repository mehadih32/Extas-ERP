import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as notices from "@/modules/hr/notice.service";

type Params = { noticeId: string };

export const dynamic = "force-dynamic";

/** PATCH /api/hr/notices/:noticeId — { title?, body?, pinned?, showUntil? }: changes a notice. */
export const PATCH = apiRoute<Params>(async (request, { noticeId }) =>
  notices.updateNotice(
    await requirePermission("hr.manage"),
    noticeId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
