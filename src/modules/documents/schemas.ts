import { z } from "zod";

import { PRINT_TYPES } from "@/modules/documents/model";

const id = z.string().trim().min(1).max(64);
const day = z.iso.date();

/**
 * What to print: a sales document by id (a money receipt by its payment's id, a
 * refund voucher by its refund's id), a statement, a stock sheet or the blank
 * letterhead.
 */
export const printRequestSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("QUOTATION"), id }),
  z.object({ type: z.literal("PROFORMA_INVOICE"), id }),
  z.object({ type: z.literal("COMMERCIAL_INVOICE"), id }),
  z.object({ type: z.literal("PACKING_LIST"), id }),
  z.object({ type: z.literal("DELIVERY_CHALLAN"), id }),
  z.object({ type: z.literal("PAYMENT_RECEIPT"), id }),
  z.object({ type: z.literal("REFUND_VOUCHER"), id }),
  z.object({
    type: z.literal("LEDGER_STATEMENT"),
    partyId: id,
    /** Calendar days in company time; without them the statement covers the whole account. */
    from: day.optional(),
    to: day.optional(),
  }),
  z.object({
    type: z.literal("STOCK_AVAILABILITY"),
    /** The styles to show, or every active style of a brand. */
    styleIds: z.array(id).min(1).max(100).optional(),
    brandId: id.optional(),
    /** One warehouse, or all of them added up. */
    warehouseId: id.optional(),
    /** With a brand: also list styles that have nothing to sell right now. */
    includeEmpty: z.boolean().optional(),
  }),
  z.object({ type: z.literal("LETTERHEAD") }),
]);

export type PrintRequest = z.output<typeof printRequestSchema>;

export const listDocumentsSchema = z.object({
  type: z.enum(PRINT_TYPES).optional(),
  /** The quotation, invoice, packing list, challan, payment, refund, buyer, brand or style it was printed for. */
  referenceId: id.optional(),
  partyId: id.optional(),
  take: z.coerce.number().int().min(1).max(100).default(20),
  /** Id of the last document on the previous page. */
  cursor: z.string().min(1).optional(),
});
