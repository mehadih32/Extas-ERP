import { apiErrorResponse, apiRoute } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission, requirePermission } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";
import { fileFromRequest } from "@/modules/files/file.service";

type Params = { recordId: string };

export const dynamic = "force-dynamic";

/** GET /api/compliance/:recordId/scan — the scan, shown in the browser (?download=1 saves it). */
export async function GET(request: Request, context: { params: Promise<Params> }) {
  try {
    const { recordId } = await context.params;
    const download = ["1", "true"].includes(
      new URL(request.url).searchParams.get("download") ?? "",
    );
    const file = await compliance.getScan(
      await requireAnyPermission("compliance.view", "compliance.manage"),
      recordId,
    );
    return fileResponse(file, download ? "attachment" : "inline");
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * POST /api/compliance/:recordId/scan — multipart/form-data with a `file` field: the licence
 * scan, a JPG, PNG, WebP or PDF of up to 10 MB. Replaces the current scan.
 */
export const POST = apiRoute<Params>(
  async (request, { recordId }) => {
    const ctx = await requirePermission("compliance.manage");
    return compliance.attachScan(
      ctx,
      recordId,
      await fileFromRequest(request),
      await getRequestMeta(),
    );
  },
  { successStatus: 201 },
);

/** DELETE /api/compliance/:recordId/scan — removes the scan. */
export const DELETE = apiRoute<Params>(async (_request, { recordId }) =>
  compliance.removeScan(
    await requirePermission("compliance.manage"),
    recordId,
    await getRequestMeta(),
  ),
);
