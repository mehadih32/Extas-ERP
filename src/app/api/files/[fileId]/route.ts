import { apiErrorResponse } from "@/lib/api";
import { fileResponse } from "@/lib/download";
import { requireCompany } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";

type Params = { fileId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/files/:fileId — the stored file itself (photos and PDFs shown in the browser, other
 * files saved). Open to its uploader and to roles that can see the record it belongs to: a
 * delivery, a supplier bill, a licence or a document template.
 */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  try {
    const { fileId } = await context.params;
    const { asset, bytes } = await files.getFileForDownload(await requireCompany(), fileId);
    return fileResponse({ fileName: asset.fileName, mimeType: asset.mimeType, bytes }, "inline");
  } catch (error) {
    return apiErrorResponse(error);
  }
}
