import { apiRoute, readJson } from "@/lib/api";
import { getRequestMeta } from "@/lib/request-meta";
import { requireAnyPermission } from "@/modules/auth/context";
import * as followUps from "@/modules/reminders/follow-up.service";

export const dynamic = "force-dynamic";

/**
 * PUT /api/sales/invoices/:invoiceId/promise { promisedPayOn: "2026-11-20" | null, note } — the
 * day the buyer promised to pay (sales.order.create, sales.invoice.edit or
 * accounts.receipts.record). No money moves; a reminder comes on that day.
 */
export const PUT = apiRoute<{ invoiceId: string }>(async (request, { invoiceId }) =>
  followUps.setPromisedPayment(
    await requireAnyPermission(
      "sales.order.create",
      "sales.invoice.edit",
      "accounts.receipts.record",
    ),
    invoiceId,
    await readJson(request),
    await getRequestMeta(),
  ),
);
