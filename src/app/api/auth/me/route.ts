import { apiRoute } from "@/lib/api";
import { requireSession } from "@/modules/auth/context";
import { getMe } from "@/modules/auth/me.service";

export const dynamic = "force-dynamic";

/** GET /api/auth/me — user, company switcher list, active company and permissions. */
export const GET = apiRoute(async () => getMe(await requireSession()));
