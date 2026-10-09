import { apiRoute } from "@/lib/api";
import { requirePermission } from "@/modules/auth/context";
import * as documents from "@/modules/sales/documents.service";

export const dynamic = "force-dynamic";

/** GET /api/sales/invoices?status=&overdue=&partyId=&search=&from=&to=&cursor=&take= */
export const GET = apiRoute(async (request) =>
  documents.listInvoices(
    await requirePermission("sales.view"),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);
