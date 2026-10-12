import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as notices from "@/modules/hr/notice.service";

export const dynamic = "force-dynamic";

/** GET /api/portal/notices — the notice board: notices up now, pinned first, and which you read. */
export const GET = apiRoute(async () => notices.myNotices(await requirePermission("portal.self")));
