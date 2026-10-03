import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/compliance?type=&status=VALID|EXPIRING|EXPIRED|NO_EXPIRY|SUPERSEDED|ARCHIVED&history=1
 * &search= — licences and registrations in force (with history=1 also renewed and archived
 * ones), soonest expiry first, each with its status and days left.
 */
export const GET = apiRoute(async (request) =>
  compliance.listCompliance(
    await requireAnyPermission("compliance.view", "compliance.manage"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/compliance — { type: TRADE_LICENSE | VAT_BIN | TIN | IRC | ERC | BGMEA_BKMEA |
 * FIRE_LICENSE | ENVIRONMENT | OTHER, title?, number?, issuingAuthority?, issueDate?, expiryDate?
 * (none = never expires), alertDaysBefore? (default 30), notes? }. Attach the scan afterwards.
 */
export const POST = apiRoute(
  async (request) =>
    compliance.createCompliance(
      await requirePermission("compliance.manage"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
