import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as sending from "@/modules/documents/send.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/document-sends/email { request, to, subject, message } — sends the document's PDF
 * by email from the company's mailbox (documents.send and seeing that document). Logged.
 */
export const POST = apiRoute(
  async (request) =>
    sending.sendDocumentByEmail(
      await requirePermission("documents.send"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
