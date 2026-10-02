import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as files from "@/modules/files/file.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/production/files — multipart/form-data with a `file` field: a packing-list photo
 * or PDF for Move to Stock, or a supplier bill scan. JPG, PNG, WebP or PDF, 10 MB at most.
 * Returns { id, fileName, mimeType, sizeBytes } to use as sourceFileId / attachmentId.
 */
export const POST = apiRoute(
  async (request) => {
    const ctx = await requireAnyPermission(
      "production.manage",
      "production.stock_intake",
      "accounts.payments.record",
    );
    return files.storeUpload(ctx, await files.fileFromRequest(request), await getRequestMeta());
  },
  { successStatus: 201 },
);
