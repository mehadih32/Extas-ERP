import { apiRoute, readJson } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import { recordUsage } from "@/modules/bug-guard/usage";

export const dynamic = "force-dynamic";

/**
 * POST /api/usage — the browser counts a screen opened, a form left half done or
 * a Help search that found nothing (only the screen's route, never what was
 * typed), for Bug Guard's product checks.
 */
export const POST = apiRoute(async (request) =>
  recordUsage(await requireCompany(), await readJson(request)),
);
