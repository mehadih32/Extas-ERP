import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { requireCompany } from "@/modules/auth/context";
import { exportLeads } from "@/modules/leads/lead.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/sales/leads/export — the lead list as a spreadsheet (CSV). Only for
 * leads.export (the owner, so the list does not leave with someone); every
 * download is in the activity log.
 */
export async function GET(request: Request) {
  try {
    const file = await exportLeads(await requireCompany(), await getRequestMeta());
    return fileResponse(file, "attachment");
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
