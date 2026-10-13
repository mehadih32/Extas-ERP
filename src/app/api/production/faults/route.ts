import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as faults from "@/modules/production/fault.service";

export const dynamic = "force-dynamic";

const readFaults = () => requireAnyPermission("production.view", "materials.view", "accounts.view");

/**
 * GET /api/production/faults — the supplier fault log, newest first (status, supplierId,
 * batchId, cursor), with what is still open per supplier. Values follow the material-cost rule.
 */
export const GET = apiRoute(async (request) =>
  faults.listFaults(await readFaults(), Object.fromEntries(new URL(request.url).searchParams)),
);

/**
 * POST /api/production/faults — { supplierId, kind, note, batchId?, projectId?, materialId?,
 * quantity?, amount?, occurredOn? }: logs a fault by hand (production.manage or
 * materials.purchase).
 */
export const POST = apiRoute(
  async (request) =>
    faults.createFault(await readFaults(), await readJson(request), await getRequestMeta()),
  { successStatus: 201 },
);
