import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import { integrationStatus } from "@/modules/integrations/status";

export const dynamic = "force-dynamic";

/**
 * GET /api/integrations/status — where the outside services stand (SMS, push, payouts, maps):
 * OFF, TEST (written to the server log only) or ON, with the server settings each one reads.
 */
export const GET = apiRoute(async () => {
  await requirePermission("hr.manage");
  return integrationStatus();
});
