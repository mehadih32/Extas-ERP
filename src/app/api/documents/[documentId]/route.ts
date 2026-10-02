import { apiRoute } from "@/lib/api";
import { requireAnyPermission } from "@/modules/auth/context";
import * as printing from "@/modules/documents/print.service";

type Params = { documentId: string };

export const dynamic = "force-dynamic";

/** GET /api/documents/:documentId — a printed document's details. */
export const GET = apiRoute<Params>(async (_request, { documentId }) =>
  printing.getDocument(await requireAnyPermission(...printing.PRINT_PERMISSIONS), documentId),
);
