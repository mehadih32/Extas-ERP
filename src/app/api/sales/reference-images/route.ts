import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import { fileFromRequest } from "@/modules/files/file.service";
import * as pictures from "@/modules/sales/reference-image.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/sales/reference-images — multipart `file`: a reference picture for a
 * quotation item (JPG or PNG, 512 KB and 2400 pixels a side at most; the app makes
 * pictures about 150 KB before sending). Returns the file to pass as an item's
 * imageId. A picture no item uses is deleted the next night.
 */
export const POST = apiRoute(
  async (request) =>
    pictures.storeReferenceImage(
      await requirePermission("sales.quotation.manage"),
      await fileFromRequest(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
