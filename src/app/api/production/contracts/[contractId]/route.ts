import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as contracts from "@/modules/production/contract.service";

type Params = { contractId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/production/contracts/:contractId — the agreement: its clauses, signed day and
 * what it covers now (the supplier's goods for the batch, or the factory's styles with
 * their CM per piece).
 */
export const GET = apiRoute<Params>(async (_request, { contractId }) =>
  contracts.getContractScreen(
    await requireAnyPermission("production.manage", "accounts.view"),
    contractId,
  ),
);

/**
 * PATCH /api/production/contracts/:contractId — { clauses: [{ title, text }], signedOn?,
 * cmRates?: [{ projectId, cmRate, cmPer?: "PIECE" | "DOZEN" }] } (cmRate is the CM as agreed,
 * per piece or per dozen as cmPer says; left out, the way the style has it now). A signed
 * agreement keeps its terms until its signed day is cleared; a style's CM stays while a saved
 * CM settlement is worked from it (undo that first).
 */
export const PATCH = apiRoute<Params>(async (request, { contractId }) =>
  contracts.updateContract(
    await requirePermission("production.manage"),
    contractId,
    await readJson(request),
    await getRequestMeta(),
  ),
);

/** DELETE /api/production/contracts/:contractId — deletes a draft (not a signed one). */
export const DELETE = apiRoute<Params>(async (_request, { contractId }) =>
  contracts.deleteContract(
    await requirePermission("production.manage"),
    contractId,
    await getRequestMeta(),
  ),
);
