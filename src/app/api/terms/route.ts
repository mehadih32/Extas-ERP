import { apiRoute } from "@/lib/api";
import { requireCompanyForTerms } from "@/modules/auth/context";
import * as terms from "@/modules/hr/terms.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/terms — the terms of employment for the signed-in employee: the
 * version in force, whether they must agree now (`due`; everything else answers
 * 403 TERMS_REQUIRED until they do), when they last agreed, and whether they can
 * agree by SMS code. null before the company publishes any terms.
 */
export const GET = apiRoute(async () => terms.getTermsGate(await requireCompanyForTerms()));
