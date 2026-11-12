import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as sending from "@/modules/documents/send.service";

export const dynamic = "force-dynamic";

/**
 * POST /api/document-sends/whatsapp { request, phone, message } — makes a secure link to the
 * document's PDF for WhatsApp (documents.send and seeing that document). The link's path with
 * its token comes back only now; only the token's hash is kept. Logged.
 */
export const POST = apiRoute(
  async (request) =>
    sending.createWhatsAppLink(
      await requirePermission("documents.send"),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
