import type { Prisma } from "@prisma/client";

import type { Db } from "@/lib/db-types";
import { prisma } from "@/lib/prisma";

/*
 * Everything a simulation run left in the books, found from its batch, the
 * suppliers it added and the styles it made: the run keeps this list when it
 * ends (records.made in its manifest), and the wipe finds it again to delete it
 * and to tell whether anyone has added to it since.
 */

export type SimulationScope = {
  companyId: string;
  batchId: string | null;
  /** The suppliers the run added (Demo Embo and the accessories suppliers). */
  partyIds: string[];
  /** The styles the run added (their sizes and stock go with them). */
  styleIds: string[];
};

export type SimulationRecords = Awaited<ReturnType<typeof simulationRecords>>;

const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);

/** The records of a run, by table. */
export async function simulationRecords(scope: SimulationScope, db: Db = prisma) {
  const { companyId, batchId, partyIds, styleIds } = scope;
  const projectIds = batchId
    ? ids(
        await db.productionProject.findMany({
          where: { companyId, batchId },
          select: { id: true },
        }),
      )
    : [];
  const byBatch = batchId ? [{ batchId }] : [];
  const byProject = { projectId: { in: projectIds } };
  const orders = await db.purchaseOrder.findMany({
    where: { companyId, OR: [...byBatch, byProject, { supplierId: { in: partyIds } }] },
    select: { id: true },
  });
  const bills = await db.supplierBill.findMany({
    where: {
      companyId,
      OR: [
        { purchaseOrderId: { in: ids(orders) } },
        { allocations: { some: byProject } },
        { supplierId: { in: partyIds } },
      ],
    },
    select: { id: true, journalEntryId: true },
  });
  const payments = await db.payment.findMany({
    where: {
      companyId,
      OR: [
        ...byBatch,
        byProject,
        { supplierBillId: { in: ids(bills) } },
        { partyId: { in: partyIds } },
      ],
    },
    select: { id: true, journalEntryId: true },
  });
  const issues = await db.materialIssue.findMany({
    where: { companyId, ...byProject },
    select: { id: true, journalEntryId: true },
  });
  const expenses = await db.expense.findMany({
    where: { companyId, OR: [byProject, { supplierId: { in: partyIds } }] },
    select: { id: true, journalEntryId: true },
  });
  const intakes = await db.stockIntake.findMany({
    where: { companyId, ...byProject },
    select: { id: true },
  });
  const settlements = batchId
    ? await db.cmSettlement.findMany({
        where: { companyId, batchId },
        select: { id: true, journalEntryId: true },
      })
    : [];
  const faults = await db.supplierFault.findMany({
    where: {
      companyId,
      OR: [...byBatch, byProject, { billId: { in: ids(bills) } }, { supplierId: { in: partyIds } }],
    },
    select: { id: true, journalEntryId: true },
  });
  const cutting = await db.cuttingReport.findMany({
    where: { companyId, ...byProject },
    select: { id: true },
  });
  const embroidery = await db.embroideryJob.findMany({
    where: { companyId, OR: [byProject, { partyId: { in: partyIds } }] },
    select: { id: true },
  });
  const finishing = await db.finishingReport.findMany({
    where: { companyId, ...byProject },
    select: { id: true },
  });
  const agreements = await db.productionContract.findMany({
    where: { companyId, OR: [...byBatch, { partyId: { in: partyIds } }] },
    select: { id: true },
  });
  const sources: Array<{ sourceType: Prisma.JournalEntryWhereInput["sourceType"]; ids: string[] }> =
    [
      { sourceType: "SUPPLIER_BILL", ids: ids(bills) },
      { sourceType: "PAYMENT", ids: ids(payments) },
      { sourceType: "MATERIAL_ISSUE", ids: ids(issues) },
      { sourceType: "EXPENSE", ids: ids(expenses) },
      { sourceType: "STOCK_INTAKE", ids: ids(intakes) },
      { sourceType: "PRODUCTION", ids: projectIds },
      { sourceType: "CM_SETTLEMENT", ids: ids(settlements) },
      { sourceType: "SUPPLIER_FAULT", ids: ids(faults) },
    ];
  const direct = [...bills, ...payments, ...issues, ...expenses, ...settlements, ...faults]
    .map((r) => r.journalEntryId)
    .filter((id): id is string => id !== null);
  const entries = await db.journalEntry.findMany({
    where: {
      companyId,
      OR: [
        { id: { in: direct } },
        ...sources.map((s) => ({ sourceType: s.sourceType, sourceId: { in: s.ids } })),
      ],
    },
    select: { id: true },
  });
  // Reversals of those entries (an undone settlement, a reopened fault, a voided bill...).
  const reversals = await db.journalEntry.findMany({
    where: { companyId, reversalOfId: { in: ids(entries) } },
    select: { id: true },
  });
  const variantIds = ids(
    await db.productVariant.findMany({
      where: { styleId: { in: styleIds } },
      select: { id: true },
    }),
  );
  const movements = await db.stockMovement.findMany({
    where: {
      OR: [
        { variantId: { in: variantIds } },
        { referenceType: "StockIntake", referenceId: { in: ids(intakes) } },
      ],
    },
    select: { id: true },
  });
  const lots = await db.stockLot.findMany({
    where: { OR: [{ styleId: { in: styleIds } }, { intakeId: { in: ids(intakes) } }] },
    select: { id: true },
  });
  return {
    projectIds,
    orderIds: ids(orders),
    billIds: ids(bills),
    paymentIds: ids(payments),
    issueIds: ids(issues),
    expenseIds: ids(expenses),
    intakeIds: ids(intakes),
    settlementIds: ids(settlements),
    faultIds: ids(faults),
    cuttingIds: ids(cutting),
    embroideryIds: ids(embroidery),
    finishingIds: ids(finishing),
    agreementIds: ids(agreements),
    entryIds: [...new Set([...ids(entries), ...ids(reversals)])],
    variantIds,
    movementIds: ids(movements),
    lotIds: ids(lots),
  };
}

/** What the records are called, for the wipe's messages. */
export const RECORD_NAMES: Record<keyof SimulationRecords, string> = {
  projectIds: "styles",
  orderIds: "purchase orders",
  billIds: "supplier bills",
  paymentIds: "payments",
  issueIds: "material issues",
  expenseIds: "expenses",
  intakeIds: "deliveries to stock",
  settlementIds: "CM settlements",
  faultIds: "faults",
  cuttingIds: "cutting reports",
  embroideryIds: "embroidery and print jobs",
  finishingIds: "finishing counts",
  agreementIds: "agreements",
  entryIds: "journal entries",
  variantIds: "SKUs",
  movementIds: "stock movements",
  lotIds: "stock lots",
};
