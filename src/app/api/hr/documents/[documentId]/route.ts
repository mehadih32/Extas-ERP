import { apiRoute } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requirePermission } from "@/modules/auth/context";
import * as vault from "@/modules/hr/vault.service";

type Params = { documentId: string };

export const dynamic = "force-dynamic";

/** DELETE /api/hr/documents/:documentId — removes a paper and its file from a data vault. */
export const DELETE = apiRoute<Params>(async (_request, { documentId }) =>
  vault.removeEmployeeDocument(
    await requirePermission("hr.manage"),
    documentId,
    await getRequestMeta(),
  ),
);
