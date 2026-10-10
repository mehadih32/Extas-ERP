import { Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { ZERO } from "@/modules/accounts/balances";
import { billProjectShares, projectPart } from "@/modules/accounts/supplier-settlement";

/*
 * A supplier's balance project by project: what their bills charge each
 * production project, what has been paid on that and what is still due. A bill
 * for one project counts for it in full; a bill split between projects counts
 * for each by its share, paid and due alike. A raw material purchase made on a
 * purchase order for a project counts for that project. Void bills are left out.
 * Read from the bills' paid / due figures, which settleSupplierBills keeps in
 * step with the supplier's ledger.
 */

export type ProjectBill = {
  id: string;
  number: string;
  billDate: Date;
  /** What the bill charges the project. */
  charged: Prisma.Decimal;
  paid: Prisma.Decimal;
  due: Prisma.Decimal;
};

export type SupplierProjectBalance = {
  supplierId: string;
  projectId: string;
  billed: Prisma.Decimal;
  paid: Prisma.Decimal;
  due: Prisma.Decimal;
  /** Oldest first. */
  bills: ProjectBill[];
};

const billSelect = {
  id: true,
  number: true,
  supplierId: true,
  billDate: true,
  createdAt: true,
  totalAmount: true,
  paidAmount: true,
  dueAmount: true,
  purchaseOrderId: true,
} satisfies Prisma.SupplierBillSelect;

type BillRow = Prisma.SupplierBillGetPayload<{ select: typeof billSelect }>;

async function balancesOf(db: Db, bills: BillRow[], onlyProject?: string) {
  const shares = await billProjectShares(db, bills);
  const balances = new Map<string, SupplierProjectBalance>();
  const sorted = [...bills].sort(
    (a, b) =>
      a.billDate.getTime() - b.billDate.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );
  for (const bill of sorted) {
    for (const [projectId, share] of shares.get(bill.id) ?? []) {
      if (onlyProject && projectId !== onlyProject) continue;
      const key = `${bill.supplierId}:${projectId}`;
      const balance = balances.get(key) ?? {
        supplierId: bill.supplierId,
        projectId,
        billed: ZERO,
        paid: ZERO,
        due: ZERO,
        bills: [],
      };
      const paid = projectPart(bill.paidAmount, share, bill.totalAmount);
      const due = Prisma.Decimal.max(share.minus(paid), ZERO);
      balance.billed = balance.billed.plus(share);
      balance.paid = balance.paid.plus(paid);
      balance.due = balance.due.plus(due);
      balance.bills.push({
        id: bill.id,
        number: bill.number,
        billDate: bill.billDate,
        charged: share,
        paid,
        due,
      });
      balances.set(key, balance);
    }
  }
  return [...balances.values()];
}

/** One supplier's balance with each project their bills charge, by project id. */
export async function supplierProjectBalances(
  db: Db,
  companyId: string,
  supplierId: string,
): Promise<Map<string, SupplierProjectBalance>> {
  const bills = await db.supplierBill.findMany({
    where: { companyId, supplierId, status: { not: "VOID" } },
    select: billSelect,
  });
  return new Map((await balancesOf(db, bills)).map((b) => [b.projectId, b]));
}

/** Each supplier's balance with one project, by supplier id. */
export async function projectSupplierBalances(
  db: Db,
  companyId: string,
  projectId: string,
): Promise<Map<string, SupplierProjectBalance>> {
  const bills = await db.supplierBill.findMany({
    where: {
      companyId,
      status: { not: "VOID" },
      OR: [{ allocations: { some: { projectId } } }, { purchaseOrder: { projectId } }],
    },
    select: billSelect,
  });
  return new Map((await balancesOf(db, bills, projectId)).map((b) => [b.supplierId, b]));
}
