import { Prisma } from "@prisma/client";

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { lockSupplierAccount, settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import { deleteStoredFile } from "@/modules/files/file.service";
import type { SimulationManifest } from "./five-style-polo";
import { RECORD_NAMES, type SimulationRecords, simulationRecords } from "./records";

/*
 * The wipe: deletes every record a simulation run made, from its batch and the
 * suppliers it added down to the journal entries, stock and PDFs, and puts back
 * what it touched: the real suppliers' bills settle again as they were, their
 * last activity and the number counters go back (each only when nothing else
 * changed it since), and the set-up it had to add goes when nothing else uses
 * it. All in one transaction: it is wiped completely or not at all.
 *
 * It refuses, wiping nothing, when real work has been added to the run's
 * records since (a payment to Demo Embo, a sale of the simulation's stock...):
 * those have to be undone first, so the wipe never takes real work with it.
 */

const fixed = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toFixed(2);

/** The relations of a party that the run never makes for the suppliers it adds. */
const NEVER_MADE = [
  "quotations",
  "proformaInvoices",
  "salesOrders",
  "invoices",
  "refunds",
  "salesReturns",
  "creditAllocations",
  "cheques",
  "purchaseReturns",
  "productionsAsBuyer",
  "productionsAsFactory",
  "batchesAsFactory",
  "cmSettlements",
  "campaignRecipients",
  "projectSettlements",
] as const;

/** Work added to the run's records since it ended: refused, by what it is. */
async function addedSince(
  tx: Prisma.TransactionClient,
  m: SimulationManifest,
  found: SimulationRecords,
): Promise<string[]> {
  const out: string[] = [];
  if (m.made) {
    for (const key of Object.keys(found) as Array<keyof SimulationRecords>) {
      const was = new Set(m.made[key]);
      const added = found[key].filter((id) => !was.has(id)).length;
      if (added > 0) out.push(`${added} ${RECORD_NAMES[key]}`);
    }
  }
  const partyIds = m.created.partyIds;
  if (partyIds.length > 0) {
    const lines = await tx.journalLine.count({
      where: { partyId: { in: partyIds }, entryId: { notIn: found.entryIds } },
    });
    if (lines > 0) out.push(`${lines} journal lines on the suppliers it added`);
    const materials = await tx.rawMaterial.count({
      where: { supplierId: { in: partyIds }, id: { notIn: m.created.materialIds } },
    });
    if (materials > 0) out.push(`${materials} materials from the suppliers it added`);
    const rows = await tx.party.findMany({
      where: { id: { in: partyIds } },
      select: {
        name: true,
        _count: { select: Object.fromEntries(NEVER_MADE.map((k) => [k, true])) },
      },
    });
    for (const p of rows) {
      const counts = p._count as Record<string, number>;
      const used = NEVER_MADE.filter((k) => counts[k]! > 0);
      if (used.length > 0) out.push(`${p.name}'s ${used.join(", ")}`);
    }
  }
  return out;
}

/**
 * Wipes a run (its manifest from runFiveStylePolo). Returns what it removed and
 * put back, line by line.
 */
export async function wipeSimulation(m: SimulationManifest): Promise<string[]> {
  const { companyId } = m;
  const scope = {
    companyId,
    batchId: m.batchId,
    partyIds: m.created.partyIds,
    styleIds: m.created.styleIds,
  };
  const removed: string[] = [];
  const note = (what: string, count: number) => {
    if (count > 0) removed.push(`${what}: ${count}`);
  };
  const touched = m.before.parties.map((p) => p.id);
  const files: Array<{ storagePath: string }> = [];

  try {
    await prisma.$transaction(
      async (tx) => {
        // The real suppliers' accounts first (the lock order rule), in a fixed order.
        for (const supplierId of [...touched, ...m.created.partyIds].sort()) {
          await lockSupplierAccount(tx, companyId, supplierId);
        }
        const found = await simulationRecords(scope, tx);
        const added = await addedSince(tx, m, found);
        if (added.length > 0) {
          throw new AppError(
            "CONFLICT",
            `Real work was added to the simulation's records since it ran (${added.join("; ")}). Undo it first: nothing was wiped.`,
          );
        }

        const allIds = [
          ...(m.batchId ? [m.batchId] : []),
          ...Object.values(found).flat(),
          ...Object.values(m.created).flat(),
        ];
        const del = async (table: string, run: () => Promise<{ count: number }>) =>
          note(table, (await run()).count);

        // PDFs kept of its records (a purchase order printed to look at it...).
        const documents = await tx.generatedDocument.findMany({
          where: {
            companyId,
            OR: [{ referenceId: { in: allIds } }, { partyId: { in: m.created.partyIds } }],
          },
          select: { id: true, file: { select: { id: true, storagePath: true } } },
        });
        allIds.push(...documents.map((d) => d.id));
        await del("NotificationLog", () =>
          tx.notificationLog.deleteMany({ where: { companyId, entityId: { in: allIds } } }),
        );
        await del("AuditLog", () =>
          tx.auditLog.deleteMany({ where: { companyId, entityId: { in: allIds } } }),
        );
        await del("GeneratedDocument", () =>
          tx.generatedDocument.deleteMany({ where: { id: { in: documents.map((d) => d.id) } } }),
        );
        const kept = documents.flatMap((d) => (d.file ? [d.file] : []));
        await del("FileAsset", () =>
          tx.fileAsset.deleteMany({ where: { id: { in: kept.map((f) => f.id) } } }),
        );
        files.push(...kept);

        await del("SupplierFault", () =>
          tx.supplierFault.deleteMany({ where: { id: { in: found.faultIds } } }),
        );
        await del("CmSettlement", () =>
          tx.cmSettlement.deleteMany({ where: { id: { in: found.settlementIds } } }),
        );
        await del("Payment", () =>
          tx.payment.deleteMany({ where: { id: { in: found.paymentIds } } }),
        );
        await del("FinishingReport", () =>
          tx.finishingReport.deleteMany({ where: { id: { in: found.finishingIds } } }),
        );
        await del("CuttingReport", () =>
          tx.cuttingReport.deleteMany({ where: { id: { in: found.cuttingIds } } }),
        );
        await del("EmbroideryJob", () =>
          tx.embroideryJob.deleteMany({ where: { id: { in: found.embroideryIds } } }),
        );
        await del("StockMovement", () =>
          tx.stockMovement.deleteMany({ where: { id: { in: found.movementIds } } }),
        );
        await del("StockLot", () =>
          tx.stockLot.deleteMany({ where: { id: { in: found.lotIds } } }),
        );
        await del("StockBalance", () =>
          tx.stockBalance.deleteMany({ where: { variantId: { in: found.variantIds } } }),
        );
        await del("StockIntake", () =>
          tx.stockIntake.deleteMany({ where: { id: { in: found.intakeIds } } }),
        );
        await del("RawMaterialMovement", () =>
          tx.rawMaterialMovement.deleteMany({
            where: {
              OR: [
                { rawMaterialId: { in: m.created.materialIds } },
                { productionProjectId: { in: found.projectIds } },
                { supplierBillId: { in: found.billIds } },
                { issueId: { in: found.issueIds } },
              ],
            },
          }),
        );
        await del("MaterialIssue", () =>
          tx.materialIssue.deleteMany({ where: { id: { in: found.issueIds } } }),
        );
        await del("Expense", () =>
          tx.expense.deleteMany({ where: { id: { in: found.expenseIds } } }),
        );
        await del("SupplierBill", () =>
          tx.supplierBill.deleteMany({ where: { id: { in: found.billIds } } }),
        );
        await del("PurchaseOrder", () =>
          tx.purchaseOrder.deleteMany({ where: { id: { in: found.orderIds } } }),
        );
        await del("JournalEntry", () =>
          tx.journalEntry.deleteMany({ where: { id: { in: found.entryIds } } }),
        );
        await del("ProductionContract", () =>
          tx.productionContract.deleteMany({ where: { id: { in: found.agreementIds } } }),
        );
        await del("ProductionProject", () =>
          tx.productionProject.deleteMany({ where: { id: { in: found.projectIds } } }),
        );
        if (m.batchId) {
          await del("ProductionBatch", () =>
            tx.productionBatch.deleteMany({ where: { id: m.batchId!, companyId } }),
          );
        }
        await del("RawMaterial", () =>
          tx.rawMaterial.deleteMany({ where: { id: { in: m.created.materialIds } } }),
        );
        await del("Party", () =>
          tx.party.deleteMany({ where: { id: { in: m.created.partyIds }, companyId } }),
        );
        await del("Style", () =>
          tx.style.deleteMany({ where: { id: { in: m.created.styleIds } } }),
        );
        await del("Brand", () =>
          tx.brand.deleteMany({ where: { id: { in: m.created.brandIds } } }),
        );
        await del("Category", () =>
          tx.category.deleteMany({ where: { id: { in: m.created.categoryIds } } }),
        );
        await del("Color", () =>
          tx.color.deleteMany({ where: { id: { in: m.created.colorIds } } }),
        );
        await del("Size", () => tx.size.deleteMany({ where: { id: { in: m.created.sizeIds } } }));
        // Set-up added on the way, when nothing else uses it.
        await del("ExpenseHead", () =>
          tx.expenseHead.deleteMany({
            where: {
              id: { in: m.created.expenseHeadIds },
              expenses: { none: {} },
              billAllocations: { none: {} },
            },
          }),
        );
        await del("LedgerAccount", () =>
          tx.ledgerAccount.deleteMany({
            where: { id: { in: m.created.ledgerAccountIds }, lines: { none: {} } },
          }),
        );
        const unused = { none: {} };
        await del("Warehouse", () =>
          tx.warehouse.deleteMany({
            where: {
              id: { in: m.created.warehouseIds },
              stockBalances: unused,
              stockMovements: unused,
              rawMaterialMovements: unused,
              rawMaterialStocks: unused,
              salesOrders: unused,
              stockIntakes: unused,
              stockLots: unused,
              supplierBills: unused,
              materialIssues: unused,
              purchaseReturns: unused,
              salesReturns: unused,
            },
          }),
        );

        // The real suppliers' bills settle again from the ledger as it now is; a bill
        // back where it was gets its date back too (one other work changed stays as is).
        for (const supplierId of touched) await settleSupplierBills(tx, companyId, supplierId);
        let restored = 0;
        let moved = 0;
        for (const b of m.before.bills) {
          const now = await tx.supplierBill.findUnique({ where: { id: b.id } });
          if (!now) continue;
          if (
            fixed(now.paidAmount) === b.paidAmount &&
            fixed(now.dueAmount) === b.dueAmount &&
            now.status === b.status
          ) {
            await tx.$executeRaw`UPDATE "SupplierBill" SET "updatedAt" = ${new Date(b.updatedAt)} WHERE "id" = ${b.id}`;
            restored += 1;
          } else {
            moved += 1;
          }
        }
        note("SupplierBill (put back as it was)", restored);
        note("SupplierBill (changed by other work since, left as it now stands)", moved);

        // The real suppliers' last activity, unless other work moved it since.
        let parties = 0;
        for (const p of m.before.parties) {
          const after = m.after?.parties.find((a) => a.id === p.id);
          const now = await tx.party.findUnique({
            where: { id: p.id },
            select: { lastTransactionAt: true, updatedAt: true },
          });
          if (
            !after ||
            !now ||
            (now.lastTransactionAt?.toISOString() ?? null) !== after.lastTransactionAt ||
            now.updatedAt.toISOString() !== after.updatedAt
          ) {
            continue;
          }
          await tx.$executeRaw`UPDATE "Party" SET "lastTransactionAt" = ${p.lastTransactionAt ? new Date(p.lastTransactionAt) : null}, "updatedAt" = ${new Date(p.updatedAt)} WHERE "id" = ${p.id}`;
          parties += 1;
        }
        note("Party (last activity put back)", parties);

        // The number counters: back to where they were, unless something else was numbered since.
        let counters = 0;
        for (const s of m.after?.sequences ?? []) {
          const now = await tx.documentSequence.findUnique({ where: { id: s.id } });
          if (!now || now.nextNumber !== s.nextNumber) continue;
          const was = m.before.sequences.find((b) => b.id === s.id);
          if (was && was.nextNumber === now.nextNumber && was.year === now.year) continue;
          if (was) {
            await tx.documentSequence.update({
              where: { id: s.id },
              data: { nextNumber: was.nextNumber, year: was.year },
            });
          } else {
            await tx.documentSequence.delete({ where: { id: s.id } });
          }
          counters += 1;
        }
        note("DocumentSequence (put back)", counters);
      },
      { timeout: 180_000, maxWait: 20_000 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      throw new AppError(
        "CONFLICT",
        "Something outside the simulation still uses its records (a sale of its stock, a document made from them...). Undo it first: nothing was wiped.",
      );
    }
    throw error;
  }
  // The kept PDFs' files, once their rows are gone for good.
  for (const f of files) await deleteStoredFile(f);
  return removed;
}
