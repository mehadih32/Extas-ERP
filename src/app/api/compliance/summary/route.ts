import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/compliance/summary — counts of valid, expiring and expired records, what needs
 * renewing (soonest first), which of the trade licence, BIN and TIN are missing, and the
 * numbers templates print ({CompanyBIN}, {CompanyTradeLicense}...).
 */
export const GET = apiRoute(async () =>
  compliance.complianceSummary(await requireAnyPermission("compliance.view", "compliance.manage")),
);
