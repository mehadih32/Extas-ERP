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
  // Written only by refreshOrderPayments (sales/posting.ts), and on edit and cancel by the
  // same rule: paid = money held on the order (received - refunds + credit used), due =
  // total - paid (0 once cancelled).
  SalesOrder: {
    client: "salesOrder",
    fields: {
      paidAmount: "the payments and credit on the order, less its refunds",
      dueAmount: "the order's total less what is paid on it",
    },
    kind: "decimal",
    inCompany: (companyId) => ({ companyId }),
  },
  // refreshOrderPayments again (a void invoice keeps what was paid and owes nothing).
  Invoice: {
    client: "invoice",
    fields: {
      paidAmount: "the payments and credit on its order, less its refunds",
      dueAmount: "the invoice's total less what is paid on it",
    },
    kind: "decimal",
    inCompany: (companyId) => ({ companyId }),
  },
  // refreshProformaPayments: received on the proforma less its refunds.
  ProformaInvoice: {
    client: "proformaInvoice",
    fields: { advancePaid: "the payments on the proforma, less its refunds" },
    kind: "decimal",
    inCompany: (companyId) => ({ companyId }),
  },
  // settleSupplierBills (accounts/supplier-settlement.ts) after every change to the
  // supplier's Payable lines; a void bill has 0 and 0.
  SupplierBill: {
    client: "supplierBill",
    fields: {
      paidAmount: "what the supplier's Payable ledger has settled on the bill",
      dueAmount: "the bill's total less what is settled on it",
    },
    kind: "decimal",
    inCompany: (companyId) => ({ companyId }),
  },
  // saveFigures (hr/payroll.service.ts) only.
  PayrollRun: {
    client: "payrollRun",
    fields: {
      totalGross: "the month's salary lines (gross)",
      totalNet: "the month's salary lines (net pay)",
    },
    kind: "decimal",
    inCompany: (companyId) => ({ companyId }),
  },
  // Paying and voiding salary payments only, by the line's amount.
  PayrollItem: {
    client: "payrollItem",
    fields: { paidAmount: "the salary payments of the line that are not void" },
    kind: "decimal",
    inCompany: (companyId) => ({ run: { companyId } }),
  },
  // applySettlementTx / its undo and void (hr/advance.service.ts): amount - settlements not
  // reversed (0 once void).
  SalaryAdvance: {
    client: "salaryAdvance",
    fields: { outstanding: "the advance less what was recovered or paid back" },
    kind: "decimal",
    inCompany: (companyId) => ({ companyId }),
  },
  // refreshProjectCosts (production/project-costs.ts) only: a cached roll-up.
  ProductionProject: {
    client: "productionProject",
    fields: { totalCost: "the project's bills, direct costs and materials issued" },
    kind: "decimal",
    inCompany: (companyId) => ({ companyId }),
  },
};

/** The entry for a model's field, or null when Bug Guard may not change it. */
export function correctableField(model: string, field: string) {
  const entry = Object.hasOwn(CORRECTABLE, model) ? CORRECTABLE[model]! : null;
  return entry && Object.hasOwn(entry.fields, field) ? entry : null;
}
