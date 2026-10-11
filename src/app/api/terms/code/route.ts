import { apiRoute } from "@/lib/api";
import { requireCompanyForTerms } from "@/modules/auth/context";
import * as terms from "@/modules/hr/terms.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/terms/code — sends a 6-digit code by SMS to the employee's mobile on
 * record, to agree with instead of a drawn signature. Works for 10 minutes; one
 * a minute, five an hour. 503 while SMS is not connected.
 */
export const POST = apiRoute(async () => terms.sendTermsCode(await requireCompanyForTerms()), {
  successStatus: 201,
});
