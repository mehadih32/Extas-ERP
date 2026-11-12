import { apiRoute } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import { helpSearchEntries } from "@/modules/help";

export const dynamic = "force-dynamic";

/**
 * GET /api/help/search — the Help Center's search index (each guide's title, summary, keywords
 * and words) for the guides this person may read. The search box loads it once, when someone
 * starts to search, so the Help Center itself opens at once.
 */
export const GET = apiRoute(async () => {
  const ctx = await requireCompany();
  return helpSearchEntries([...ctx.permissions], ctx.user.isSuperAdmin);
});
