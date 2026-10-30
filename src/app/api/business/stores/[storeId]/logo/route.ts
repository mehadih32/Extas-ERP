import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { requireCompany } from "@/modules/auth/context";
import { storeLogoImage } from "@/modules/retail/pad.service";

export const dynamic = "force-dynamic";

/** GET /api/business/stores/{id}/logo — the logo on the store's pad (404 when there is none). */
export async function GET(request: Request, { params }: { params: Promise<{ storeId: string }> }) {
  try {
    const { storeId } = await params;
    return fileResponse(await storeLogoImage(await requireCompany(), storeId), "inline");
  } catch (error) {
    return apiErrorResponse(error, request);
  }
}
