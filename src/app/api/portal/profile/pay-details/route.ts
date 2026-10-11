import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as vault from "@/modules/hr/vault.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/portal/profile/pay-details — { salaryMethod: CASH | BANK_TRANSFER | CHEQUE | BKASH |
 * NAGAD | ROCKET, bankName?, bankBranch?, bankAccountNumber?, walletNumber?, note? }: asks HR to
 * pay you another way or to another account. It waits for HR; a newer ask replaces one waiting.
 */
export const POST = apiRoute(
  async (request) =>
    vault.requestPayDetailsChange(
      await requirePermission("portal.self"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
