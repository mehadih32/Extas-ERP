import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompanyForTerms } from "@/modules/auth/context";
import * as terms from "@/modules/hr/terms.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/terms/agree — { versionId, method: "SIGNATURE", signature: "data:image/png;base64,..." }
 * or { versionId, method: "SMS_CODE", code: "123456" }: agrees to that version (the one in
 * force). Records the IP address and device; the signed PDF follows in the background.
 */
export const POST = apiRoute(
  async (request) =>
    terms.agreeToTerms(
      await requireCompanyForTerms(),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
