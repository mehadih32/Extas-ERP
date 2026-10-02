import { type BillStatus, Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";
import { lockRows } from "@/lib/row-lock";
import { ZERO } from "@/modules/accounts/balances";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";

/*
 * Which supplier bills are paid. Bills are settled from the supplier's Payable
 * ledger, oldest due first, so the bill figures always agree with the ledger
 * whatever order things happen in: a payment on account, a voided payment or
 * bill, an asset bought on credit, a Due expense, an opening balance or a
 * journal adjustment. Every change to a supplier's Payable lines calls
 * settleSupplierBills in the same transaction.
 */

type Tx = Prisma.TransactionClient;

/** Payments that still count: their journal entry has not been reversed. */
const livePayment = {
  journalEntry: { is: { isReversed: false } },
} satisfies Prisma.PaymentWhereInput;

export type BillSettlement = {
  billId: string;
  number: string;
  paidBefore: Prisma.Decimal;
  paidAfter: Prisma.Decimal;
  dueAfter: Prisma.Decimal;
  status: BillStatus;
};

type PlannedBill = {
  id: string;
  number: string;
  recorded: { paid: Prisma.Decimal; due: Prisma.Decimal; status: BillStatus };
  paid: Prisma.Decimal;
  due: Prisma.Decimal;
  status: BillStatus;
};

/**
 * What a supplier's bills should show, from their Payable ledger. Payments made
 * against a bill count for that bill. Everything else the supplier's ledger was
 * debited with (payments on account, payments left over from void bills,
 * adjustments) settles what they are owed oldest first, bills and other dues
 * (opening balance, assets on credit, Due expenses) alike.
 */
async function planSettlement(db: Db, companyId: string, supplierId: string) {
  const bills = await db.supplierBill.findMany({
    where: { companyId, supplierId, status: { not: "VOID" } },
    select: {
      id: true,
      number: true,
      billDate: true,
      createdAt: true,
      totalAmount: true,
      paidAmount: true,
      dueAmount: true,
      status: true,
    },
  });
  const billIds = new Set(bills.map((b) => b.id));
  const direct = await db.payment.groupBy({
    by: ["supplierBillId"],
    where: { companyId, direction: "PAID", supplierBillId: { in: [...billIds] }, ...livePayment },
    _sum: { amount: true },
  });
  const directByBill = new Map(direct.map((d) => [d.supplierBillId, d._sum.amount ?? ZERO]));
  const paidDirect = [...directByBill.values()].reduce((s, v) => s.plus(v), ZERO);

  // The supplier's Payable lines that still count (an entry and its reversal cancel out).
  const acc = await ensureControlAccounts(companyId, db);
  const lines = await db.$queryRaw<
    Array<{
      sourceType: string;
      sourceId: string | null;
      date: Date;
      createdAt: Date;
      debit: Prisma.Decimal;
      credit: Prisma.Decimal;
    }>
  >`
    SELECT je."sourceType"::text AS "sourceType", je."sourceId", je.date, je."createdAt",
           jl.debit, jl.credit
    FROM "JournalLine" jl
    JOIN "JournalEntry" je ON je.id = jl."entryId"
    WHERE je."companyId" = ${companyId} AND jl."accountId" = ${acc.PAYABLE}
      AND jl."partyId" = ${supplierId}
      AND je."isReversed" = false AND je."reversalOfId" IS NULL`;

  type Due = { at: Date; createdAt: Date; amount: Prisma.Decimal; bill?: (typeof bills)[number] };
  const dues: Due[] = bills.map((bill) => ({
    at: bill.billDate,
    createdAt: bill.createdAt,
    amount: Prisma.Decimal.max(bill.totalAmount.minus(directByBill.get(bill.id) ?? ZERO), ZERO),
    bill,
  }));
  let debits = ZERO;
  for (const line of lines) {
    debits = debits.plus(line.debit);
    const isBill = line.sourceType === "SUPPLIER_BILL" && billIds.has(line.sourceId ?? "");
    if (!isBill && new Prisma.Decimal(line.credit).gt(0)) {
      dues.push({
        at: line.date,
        createdAt: line.createdAt,
        amount: new Prisma.Decimal(line.credit),
      });
    }
  }
  dues.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      a.createdAt.getTime() - b.createdAt.getTime() ||
      (a.bill ? 1 : 0) - (b.bill ? 1 : 0),
  );

  let pool = Prisma.Decimal.max(debits.minus(paidDirect), ZERO);
  const planned: PlannedBill[] = [];
  for (const due of dues) {
    const applied = Prisma.Decimal.min(due.amount, pool);
    pool = pool.minus(applied);
    const bill = due.bill;
    if (!bill) continue;
    const paid = (directByBill.get(bill.id) ?? ZERO).plus(applied);
    const owed = Prisma.Decimal.max(bill.totalAmount.minus(paid), ZERO);
    planned.push({
      id: bill.id,
      number: bill.number,
      recorded: { paid: bill.paidAmount, due: bill.dueAmount, status: bill.status },
      paid,
      due: owed,
      status: owed.lte(0) ? "PAID" : paid.gt(0) ? "PARTIALLY_PAID" : "UNPAID",
    });
  }
  return { bills: planned, advanceLeft: pool };
}

const isCurrent = (b: PlannedBill) =>
  b.paid.equals(b.recorded.paid) && b.due.equals(b.recorded.due) && b.status === b.recorded.status;

/**
 * Locks a supplier's account until the transaction ends: one settlement per
 * supplier at a time, so a bill saved meanwhile is never missed, and all of
 * their open bills. settleSupplierBills takes it last; a transaction that also
 * locks one of the supplier's bills (to pay, void or return goods on it) takes
 * it first, so two such transactions queue up instead of each holding a bill
 * the other's settlement needs. Taking it again in the same transaction is free.
 */
export async function lockSupplierAccount(tx: Tx, companyId: string, supplierId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier-settle:${supplierId}`}))`;
  const ids = (
    await tx.supplierBill.findMany({
      where: { companyId, supplierId, status: { not: "VOID" } },
      select: { id: true },
    })
  ).map((b) => b.id);
  await lockRows(tx, "SupplierBill", ids);
}

/**
 * Brings a supplier's bills in line with their Payable ledger (see planSettlement).
 * Returns the bills that changed and what is left over as an advance.
 */
export async function settleSupplierBills(tx: Tx, companyId: string, supplierId: string) {
  await lockSupplierAccount(tx, companyId, supplierId);
  const plan = await planSettlement(tx, companyId, supplierId);
  const changed: BillSettlement[] = [];
  for (const bill of plan.bills) {
    if (isCurrent(bill)) continue;
    await tx.supplierBill.update({
      where: { id: bill.id },
      data: { paidAmount: bill.paid, dueAmount: bill.due, status: bill.status },
    });
    changed.push({
      billId: bill.id,
      number: bill.number,
      paidBefore: bill.recorded.paid,
      paidAfter: bill.paid,
      dueAfter: bill.due,
      status: bill.status,
    });
  }
  return { changed, advanceLeft: plan.advanceLeft };
}

/** settleSupplierBills for each supplier named on the given Payable lines. */
export async function settleSuppliersOnLines(
  tx: Tx,
  companyId: string,
  lines: Array<{ accountId: string; partyId?: string | null }>,
) {
  const acc = await ensureControlAccounts(companyId, tx);
  const suppliers = new Set(
    lines.flatMap((l) => (l.accountId === acc.PAYABLE && l.partyId ? [l.partyId] : [])),
  );
  for (const supplierId of suppliers) await settleSupplierBills(tx, companyId, supplierId);
}

/** Bills whose paid / due figures no longer agree with their supplier's ledger (books check). */
export async function billsOutOfStep(companyId: string) {
  const suppliers = await prisma.supplierBill.findMany({
    where: { companyId, status: { not: "VOID" } },
    distinct: ["supplierId"],
    select: { supplierId: true },
  });
  const outOfStep: Array<{ number: string; due: string; ledgerDue: string }> = [];
  for (const { supplierId } of suppliers) {
    const plan = await planSettlement(prisma, companyId, supplierId);
    for (const bill of plan.bills) {
      if (isCurrent(bill)) continue;
      outOfStep.push({
        number: bill.number,
        due: bill.recorded.due.toFixed(2),
        ledgerDue: bill.due.toFixed(2),
      });
    }
  }
  return outOfStep;
}
