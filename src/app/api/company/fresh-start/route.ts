import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany } from "@/modules/auth/context";
import { getFreshStart, startFreshStart } from "@/modules/fresh-start/fresh-start.service";

export const dynamic = "force-dynamic";

/** GET /api/company/fresh-start — the Fresh start card: used (when, by whom), running, or ready. */
export const GET = apiRoute(async () => getFreshStart(await requireCompany()));

/**
 * POST /api/company/fresh-start — the owner starts the one fresh start of this
 * company ({ keepParties, keepProducts, keepEmployees, companyName, pin }).
 * Answers at once while the backup and the wipe run; poll GET for the result.
 * 409 once used or while one runs. Never the AI or the bot (the service checks).
 */
export const POST = apiRoute(
  async (request) => {
    const ctx = await requireCompany();
    return startFreshStart(ctx, await readJson(request), await getRequestMeta());
  },
  { successStatus: 202 },
);
