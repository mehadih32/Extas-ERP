import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as vault from "@/modules/hr/vault.service";

type Params = { documentId: string };

export const dynamic = "force-dynamic";

/** DELETE /api/portal/profile/documents/:documentId — removes a paper you added yourself. */
export const DELETE = apiRoute<Params>(async (_request, { documentId }) =>
  vault.removeMyDocument(
    await requirePermission("portal.self"),
    documentId,
    await getRequestMeta(),
  ),
);
