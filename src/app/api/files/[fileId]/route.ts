import { apiErrorResponse } from "@/lib/api";
import { requireCompany } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";

type Params = { fileId: string };

export const dynamic = "force-dynamic";

/**
 * GET /api/files/:fileId — the stored file itself (shown inline in the browser). Open to its
 * uploader and to roles that can see the delivery or supplier bill it belongs to.
 */
export async function GET(_request: Request, context: { params: Promise<Params> }) {
  try {
    const { fileId } = await context.params;
    const { asset, bytes } = await files.getFileForDownload(await requireCompany(), fileId);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": asset.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(asset.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
