import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as sending from "@/modules/documents/send.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/document-sends/share { request } — logs a share from the phone (its own Share
 * sheet sends the PDF) and returns the kept PDF's id to download (documents.send).
 */
export const POST = apiRoute(
  async (request) =>
    sending.recordShare(
      await requirePermission("documents.send"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
