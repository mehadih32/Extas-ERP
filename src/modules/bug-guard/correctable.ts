/*
 * The only stored figures Bug Guard may ever put right (corrections.ts): each a
 * total kept beside the records it adds up, so the records are the truth and
 * the stored figure is only a copy of their sum. A correction sets the copy back
 * to the sum (the old figure is kept, and undo puts it back). Nothing else is
 * ever changed: not a record, not a price, not a person, not a permission.
 * Accounts are never set: a mistake there gets an adjusting entry instead.
 */

export type Correctable = {
  /** The model's name on the Prisma client ("stockBalance"). */
  client: string;
  /** Each field that is a total, with what it adds up (shown to the owner). */
  fields: Record<string, string>;
  /** Whole numbers (stock) or money with 2 decimals. */
  kind: "int" | "decimal";
  /** Keeps the change inside the company (the model's own companyId, or its parent's). */
  inCompany: (companyId: string) => Record<string, unknown>;
};

export const CORRECTABLE: Record<string, Correctable> = {
  StockBalance: {
    client: "stockBalance",
    fields: { quantity: "the stock movements of this item in this warehouse and grade" },
    kind: "int",
    inCompany: (companyId) => ({ companyId }),
  },
  PurchaseOrder: {
    client: "purchaseOrder",
    fields: { totalAmount: "the purchase order's lines" },
    kind: "decimal",
    inCompany: (companyId) => ({ companyId }),
  },
};

/** The entry for a model's field, or null when Bug Guard may not change it. */
export function correctableField(model: string, field: string) {
  const entry = Object.hasOwn(CORRECTABLE, model) ? CORRECTABLE[model]! : null;
  return entry && Object.hasOwn(entry.fields, field) ? entry : null;
}
