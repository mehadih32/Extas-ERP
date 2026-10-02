import { Prisma } from "@prisma/client";

/** Tables whose rows are locked while money or stock is changed. */
export type LockableTable =
  | "SalesOrder"
  | "ProformaInvoice"
  | "Quotation"
  | "SupplierBill"
  | "ProductionProject"
  | "StockIntake"
  | "ProductVariant"
  | "FixedAsset"
  | "CapitalSource"
  | "CapitalInstallment"
  | "Expense"
  | "Employee"
  | "LeaveRequest"
  | "SalaryAdvance"
  | "PayrollRun"
  | "PayrollPayment"
  | "RawMaterial"
  | "PurchaseOrder"
  | "PurchaseReturn";

/**
 * Locks rows until the transaction ends (`SELECT ... FOR UPDATE`), so two people
 * cannot pay the same due or receive into the same project at once. Several ids
 * are locked in a fixed order to avoid deadlocks.
 */
export async function lockRows(tx: Prisma.TransactionClient, table: LockableTable, ids: string[]) {
  const unique = [...new Set(ids)].sort();
  if (unique.length === 0) return;
  await tx.$queryRaw`SELECT id FROM ${Prisma.raw(`"${table}"`)} WHERE id IN (${Prisma.join(unique)}) ORDER BY id FOR UPDATE`;
}

export async function lockRow(tx: Prisma.TransactionClient, table: LockableTable, id: string) {
  await lockRows(tx, table, [id]);
}
