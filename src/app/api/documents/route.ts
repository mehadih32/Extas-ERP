import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as printing from "@/modules/documents/print.service";

export const dynamic = "force-dynamic";

/**
 * GET /api/documents?type=&referenceId=&partyId=&cursor=&take= — printed documents this person
 * may see (by their type's permission), newest first.
 */
export const GET = apiRoute(async (request) =>
  printing.listDocuments(
    await requireAnyPermission(...printing.PRINT_PERMISSIONS),
    Object.fromEntries(new URL(request.url).searchParams),
  ),
);

/**
 * POST /api/documents — prints a PDF on the company letterhead and keeps it:
 * - { type: QUOTATION | PROFORMA_INVOICE | COMMERCIAL_INVOICE | PACKING_LIST | DELIVERY_CHALLAN, id } (sales.view)
 * - { type: PAYMENT_RECEIPT, id: the payment's id } (sales.view)
 * - { type: REFUND_VOUCHER, id: the refund's id } (sales.view)
 * - { type: LEDGER_STATEMENT, partyId, from?, to? } (parties.ledger.view)
 * - { type: STOCK_AVAILABILITY, styleIds? or brandId?, warehouseId?, includeEmpty? } (inventory.view)
 * - { type: LETTERHEAD } (documents.letterhead)
 * When nothing changed since the last print, the kept copy comes back (reused: true).
 * Download the PDF from /api/documents/:documentId/download.
 */
export const POST = apiRoute(
  async (request) =>
    printing.printDocument(
      await requireAnyPermission(...printing.PRINT_PERMISSIONS),
      await readJson(request),
      await getRequestMeta(),
    ),
  { successStatus: 201 },
);
