import { randomUUID } from "node:crypto";

import type { DocumentType } from "@prisma/client";

import type { Db } from "@/lib/db-types";

/** Default prefixes; a company can change them in its DocumentSequence row. */
export const DEFAULT_PREFIXES: Partial<Record<DocumentType, string>> = {
  QUOTATION: "QT",
  PROFORMA_INVOICE: "PI",
  SALES_ORDER: "SO",
  COMMERCIAL_INVOICE: "INV",
  PACKING_LIST: "PL",
  DELIVERY_CHALLAN: "DC",
  PAYMENT_RECEIPT: "RCPT",
  PAYMENT_VOUCHER: "PV",
  SUPPLIER_BILL: "BILL",
  EXPENSE_VOUCHER: "EXP",
  JOURNAL_VOUCHER: "JV",
  SALES_RETURN: "RET",
  STOCK_INTAKE: "GRN",
  PRODUCTION_PROJECT: "PRD",
  SALARY_ADVANCE: "ADV",
  PURCHASE_ORDER: "PO",
  MATERIAL_ISSUE: "MI",
  MATERIAL_RETURN: "MR",
  PURCHASE_RETURN: "DN",
};

/**
 * Atomically takes the next number for a document type, e.g. "JV-2026-00042".
 * Safe under concurrency (single UPSERT ... RETURNING); restarts at 1 each year
 * when the sequence is set to reset yearly. Pass a transaction client so the
 * number is only consumed if the document is saved.
 */
export async function nextDocumentNumber(
  db: Db,
  companyId: string,
  docType: DocumentType,
  now: Date = new Date(),
): Promise<string> {
  const year = now.getFullYear();
  const prefix = DEFAULT_PREFIXES[docType] ?? docType.slice(0, 4);
  const rows = await db.$queryRaw<
    Array<{ number: number; prefix: string; padding: number; resetYearly: boolean }>
  >`
    INSERT INTO "DocumentSequence" ("id", "companyId", "docType", "prefix", "nextNumber", "padding", "resetYearly", "year")
    VALUES (${randomUUID()}, ${companyId}, ${docType}::"DocumentType", ${prefix}, 2, 5, true, ${year})
    ON CONFLICT ("companyId", "docType") DO UPDATE SET
      "nextNumber" = CASE
        WHEN "DocumentSequence"."resetYearly" AND "DocumentSequence"."year" IS DISTINCT FROM EXCLUDED."year" THEN 2
        ELSE "DocumentSequence"."nextNumber" + 1
      END,
      "year" = EXCLUDED."year"
    RETURNING "nextNumber" - 1 AS "number", "prefix", "padding", "resetYearly"`;
  const row = rows[0]!;
  const serial = String(row.number).padStart(row.padding, "0");
  return row.resetYearly ? `${row.prefix}-${year}-${serial}` : `${row.prefix}-${serial}`;
}
