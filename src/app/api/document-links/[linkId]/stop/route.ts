import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as sending from "@/modules/documents/send.service";

export const dynamic = "force-dynamic";

/** POST /api/document-links/:linkId/stop — stops a WhatsApp document link at once (documents.send). */
export const POST = apiRoute<{ linkId: string }>(async (_request, { linkId }) =>
  sending.stopDocumentLink(
    await requirePermission("documents.send"),
    linkId,
    await getRequestMeta(),
  ),
);
