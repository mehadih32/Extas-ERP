import { Prisma } from "@prisma/client";

import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatAmount } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import { settleSupplierBills } from "@/modules/accounts/supplier-settlement";
import type { CompanyContext } from "@/modules/auth/context";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import * as batchIssue from "@/modules/production/batch-issue.service";
import * as batchMoney from "@/modules/production/batch-money.service";
import * as bookings from "@/modules/production/booking.service";
import * as batches from "@/modules/production/batch.service";
import * as contracts from "@/modules/production/contract.service";
import * as costs from "@/modules/production/cost.service";
import * as cutting from "@/modules/production/cutting.service";
import * as faults from "@/modules/production/fault.service";
import * as finishing from "@/modules/production/finishing.service";
import * as needs from "@/modules/production/material-need.service";
import * as projects from "@/modules/production/project.service";
import * as receive from "@/modules/production/receive.service";

/*
 * The zero-touch production simulation. runSimulation() takes one master batch,
 * "Premium Polo Export Q3", through every step of production with the app's own
 * services, exactly as the staff would on the screens:
 *   1,00,000 advance CM to the factory -> fabric received 25 kg short of the
 *   challan (logged as the mill's fault) -> 5,100 pieces cut -> embroidery with
 *   spoiled pieces (the factory's fault) -> finishing graded A/B/C with rejects ->
 *   the CM bills -> the full packing list with missing pieces (the factory's
 *   fault, at the final unit cost) -> the final CM settlement with the C-grade CM
 *   taken off, which posts its journal entry.
 * It uses the company's own active factory, fabric supplier and bank account.
 * readFootprint() reads what it left in the books, and teardownSimulation()
 * wipes every record it made and puts back what it touched, so the database is
 * as it was before. It runs on the test database only
 * (tests/integration/production-simulation.test.ts), never on the live site.
 */

export const SIMULATION_BATCH = "Premium Polo Export Q3";
export const SIMULATION_FABRIC = "95% Cotton, 5% Spandex";

/** The five brands, one style each, with the CM a piece agreed with the factory. */
export const SIMULATION_BRANDS = [
  { brand: "Ralph Lauren", code: "RL", cmRate: 95 },
  { brand: "Tommy", code: "TH", cmRate: 90 },
  { brand: "CK", code: "CK", cmRate: 88 },
  { brand: "Boss", code: "BS", cmRate: 92 },
  { brand: "Lacoste", code: "LC", cmRate: 95 },
] as const;

/**
 * Each style, by size: 1,000 pieces to make, 1,020 cut (2% over), spoiled at
 * embroidery, then graded at finishing; what is left is missing at the packing list.
 */
export const SIMULATION_SIZES = [
  { size: "S", target: 200, cut: 204, spoiled: 1, a: 198, b: 2, c: 1, reject: 1, missing: 1 },
  { size: "M", target: 300, cut: 306, spoiled: 2, a: 296, b: 4, c: 2, reject: 1, missing: 1 },
  { size: "L", target: 300, cut: 306, spoiled: 2, a: 295, b: 4, c: 3, reject: 1, missing: 1 },
  { size: "XL", target: 200, cut: 204, spoiled: 1, a: 197, b: 2, c: 2, reject: 1, missing: 1 },
] as const;

const COLOUR = { name: "Navy", hexCode: "#1F2A44" };
const CATEGORY = "Polo Shirts";
/** The fabric: kg a piece in the tech pack, cutting loss, the order and what came. */
const FABRIC_PER_PIECE = 0.22;
const FABRIC_WASTAGE = 2;
const FABRIC_ORDERED_KG = 1150;
const FABRIC_PRICE = 640;
const FABRIC_SHORT_KG = 25;
const FABRIC_ISSUED_KG = 225;
const FABRIC_USED_KG = 224.4;
export const SIMULATION_ADVANCE = 100_000;

export type SimulationOptions = {
  /** Seeds the random target price (450-500 BDT a piece); random when left out. */
  seed?: number;
};

type RowStamp = { id: string; updatedAt: Date };

/** What a run made, and what it found before it started (to put back on the wipe). */
export type SimulationRun = {
  companyId: string;
  batchId: string;
  batchCode: string;
  factory: { id: string; name: string };
  mill: { id: string; name: string };
  bankAccount: { id: string; code: string; name: string };
  styles: Array<{ projectId: string; code: string; brand: string; targetUnitCost: string }>;
  /** Master data the run had to add (reused when the company has it already). */
  created: {
    brandIds: string[];
    categoryIds: string[];
    colorIds: string[];
    sizeIds: string[];
    styleIds: string[];
    materialIds: string[];
    ledgerAccountIds: string[];
    expenseHeadIds: string[];
    warehouseIds: string[];
  };
  before: {
    /** Supplier Due of the factory and the mill. */
    due: Record<string, string>;
    sequences: Array<{ id: string; nextNumber: number; year: number | null }>;
    parties: Array<{ id: string; lastTransactionAt: Date | null; updatedAt: Date }>;
    bills: Array<RowStamp & { paidAmount: string; dueAmount: string; status: string }>;
  };
  /** The number counters when the run ended: put back only if nobody numbered since. */
  sequencesAfter: Array<{ id: string; nextNumber: number }>;
  steps: string[];
};

/** A small seeded random number generator (mulberry32), for a repeatable run. */
function seeded(seed: number) {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const money = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toDecimalPlaces(2);
const fixed = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value).toFixed(2);
const bdt = (value: Prisma.Decimal.Value) => `BDT ${formatAmount(value, 2, "BDT")}`;
const pcs = (n: number) => formatAmount(n, 0, "BDT");

async function supplierDue(ctx: CompanyContext, partyId: string) {
  return (await getPartyBalance(ctx, partyId)).neg().toFixed(2);
}

/** The company's active supplier for a category: the one with the most bills, then the oldest. */
async function activeSupplier(companyId: string, category: "CM" | "FABRIC", not?: string) {
  const found = await prisma.party.findMany({
    where: {
      companyId,
      kind: "SUPPLIER",
      status: "ACTIVE",
      supplierCategories: { has: category },
      ...(not ? { id: { not } } : {}),
    },
    select: { id: true, name: true, _count: { select: { supplierBills: true } } },
    orderBy: { createdAt: "asc" },
  });
  found.sort((a, b) => b._count.supplierBills - a._count.supplierBills);
  return found[0] ?? null;
}

/** The bank account the advance is paid from: a real bank account first, else the main Bank. */
async function bankLedger(companyId: string) {
  const bank = await prisma.bankAccount.findFirst({
    where: { companyId, isActive: true },
    select: { ledgerAccount: { select: { id: true, code: true, name: true, isActive: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (bank?.ledgerAccount?.isActive) return bank.ledgerAccount;
  return prisma.ledgerAccount.findFirst({
    where: { companyId, subType: "BANK", isActive: true },
    select: { id: true, code: true, name: true },
    orderBy: { code: "asc" },
  });
}

/**
 * Runs the whole scenario as `ctx` (a Super Admin, who may do every step). Refuses
 * when the batch is there already: wipe the earlier run first.
 */
export async function runSimulation(
  ctx: CompanyContext,
  options: SimulationOptions = {},
): Promise<SimulationRun> {
  const companyId = ctx.company.id;
  const random = seeded(options.seed ?? Date.now());
  const today = localDay(new Date(), ctx.company.timezone);
  const steps: string[] = [];
  const step = (text: string) => steps.push(text);

  if (await prisma.productionBatch.findFirst({ where: { companyId, name: SIMULATION_BATCH } })) {
    throw new AppError(
      "CONFLICT",
      `"${SIMULATION_BATCH}" is there already. Wipe the earlier simulation first.`,
    );
  }

  // 0. The real suppliers and accounts, and what they stand at now.
  const factory = await activeSupplier(companyId, "CM");
  if (!factory) throw new AppError("VALIDATION", "Add an active CM factory (a supplier) first.");
  const mill = await activeSupplier(companyId, "FABRIC", factory.id);
  if (!mill) throw new AppError("VALIDATION", "Add an active fabric supplier first.");
  const bank = await bankLedger(companyId);
  if (!bank) throw new AppError("VALIDATION", "Add a bank account first.");
  const partyIds = [factory.id, mill.id];
  const before: SimulationRun["before"] = {
    due: {
      [factory.id]: await supplierDue(ctx, factory.id),
      [mill.id]: await supplierDue(ctx, mill.id),
    },
    sequences: await prisma.documentSequence.findMany({
      where: { companyId },
      select: { id: true, nextNumber: true, year: true },
    }),
    parties: await prisma.party.findMany({
      where: { id: { in: partyIds } },
      select: { id: true, lastTransactionAt: true, updatedAt: true },
    }),
    bills: (
      await prisma.supplierBill.findMany({
        where: { companyId, supplierId: { in: partyIds } },
        select: {
          id: true,
          paidAmount: true,
          dueAmount: true,
          status: true,
          updatedAt: true,
        },
      })
    ).map((b) => ({
      id: b.id,
      paidAmount: fixed(b.paidAmount),
      dueAmount: fixed(b.dueAmount),
      status: b.status,
      updatedAt: b.updatedAt,
    })),
  };
  const known = {
    ledgerAccountIds: new Set(
      (await prisma.ledgerAccount.findMany({ where: { companyId }, select: { id: true } })).map(
        (a) => a.id,
      ),
    ),
    expenseHeadIds: new Set(
      (await prisma.expenseHead.findMany({ where: { companyId }, select: { id: true } })).map(
        (h) => h.id,
      ),
    ),
    warehouseIds: new Set(
      (await prisma.warehouse.findMany({ where: { companyId }, select: { id: true } })).map(
        (w) => w.id,
      ),
    ),
  };
  step(
    `Found the factory ${factory.name}, the fabric supplier ${mill.name} and the bank account ${bank.code} ${bank.name}.`,
  );

  // 1. The catalogue: reused when the company has it, added otherwise.
  const created: SimulationRun["created"] = {
    brandIds: [],
    categoryIds: [],
    colorIds: [],
    sizeIds: [],
    styleIds: [],
    materialIds: [],
    ledgerAccountIds: [],
    expenseHeadIds: [],
    warehouseIds: [],
  };
  const insensitive = (name: string) => ({ equals: name, mode: "insensitive" as const });
  const sizeIds: string[] = [];
  for (const { size } of SIMULATION_SIZES) {
    const found = await prisma.size.findFirst({ where: { companyId, name: insensitive(size) } });
    if (found) sizeIds.push(found.id);
    else {
      const made = await catalog.createSize(ctx, { name: size });
      created.sizeIds.push(made.id);
      sizeIds.push(made.id);
    }
  }
  const sizeNames = new Map(
    (await prisma.size.findMany({ where: { id: { in: sizeIds } } })).map((s) => [s.id, s.name]),
  );
  let colour = await prisma.color.findFirst({
    where: { companyId, name: insensitive(COLOUR.name) },
  });
  if (!colour) {
    colour = await catalog.createColor(ctx, COLOUR);
    created.colorIds.push(colour.id);
  }
  let category = await prisma.category.findFirst({
    where: { companyId, name: insensitive(CATEGORY) },
  });
  if (!category) {
    category = await catalog.createCategory(ctx, { name: CATEGORY });
    created.categoryIds.push(category.id);
  }

  // 2. The fabric: 95% Cotton, 5% Spandex, from the mill.
  const fabric = await materials.createMaterial(ctx, {
    name: "Premium Pique (Simulation)",
    kind: "FABRIC",
    unit: "KG",
    color: COLOUR.name,
    specification: SIMULATION_FABRIC,
    supplierId: mill.id,
  });
  created.materialIds.push(fabric.id);

  // 3. The master batch and its five brand styles of 1,000 pieces, each with a random target price.
  const targetDate = addDays(today, 45);
  const batch = await batches.createBatch(ctx, {
    name: SIMULATION_BATCH,
    factoryId: factory.id,
    targetDate,
    notes: "Made by the production simulation. Wiped by teardownSimulation().",
  });
  const made: SimulationRun["styles"] = [];
  for (const b of SIMULATION_BRANDS) {
    let brand = await prisma.brand.findFirst({ where: { companyId, name: insensitive(b.brand) } });
    if (!brand) {
      brand = await catalog.createBrand(ctx, { name: b.brand });
      created.brandIds.push(brand.id);
    }
    const style = await styles.createStyle(ctx, {
      code: `SIM-Q3-${b.code}`,
      name: `${b.brand} Premium Polo`,
      categoryId: category.id,
      brandId: brand.id,
      fabric: SIMULATION_FABRIC,
      retailPrice: 2450,
      wholesalePrice: 1450,
    });
    created.styleIds.push(style.id);
    await matrix.generateMatrix(ctx, style.id, { colorIds: [colour.id], sizeIds });
    const variants = await prisma.productVariant.findMany({
      where: { styleId: style.id },
      select: { id: true, sizeId: true },
    });
    const sku = (size: string) =>
      variants.find((v) => sizeNames.get(v.sizeId)?.toUpperCase() === size)!.id;
    const targetUnitCost = Math.round((450 + random() * 50) * 100) / 100;
    const project = await projects.createProject(ctx, {
      name: `${b.brand} premium polo`,
      batchId: batch.id,
      styleId: style.id,
      categoryId: category.id,
      factoryId: factory.id,
      targetDate,
      targetUnitCost,
      targets: SIMULATION_SIZES.map((s) => ({ variantId: sku(s.size), quantity: s.target })),
    });
    made.push({
      projectId: project.id,
      code: project.code,
      brand: b.brand,
      targetUnitCost: fixed(targetUnitCost),
    });
    await needs.setMaterialNeeds(ctx, project.id, {
      needs: [
        {
          materialId: fabric.id,
          perPiece: FABRIC_PER_PIECE,
          wastagePercent: FABRIC_WASTAGE,
          placement: "Main body",
        },
      ],
    });
  }
  const batchCode = (await prisma.productionBatch.findUniqueOrThrow({ where: { id: batch.id } }))
    .code;
  step(
    `Made ${batchCode} "${SIMULATION_BATCH}" at ${factory.name}: ${made
      .map((s) => `${s.code} ${s.brand} (target ${bdt(s.targetUnitCost)} a piece)`)
      .join(", ")}, 1,000 pieces each.`,
  );

  // 4. The factory agreement with each style's CM a piece, signed today.
  const agreement = await contracts.createContract(ctx, batch.id, {
    kind: "FACTORY_CM",
    partyId: factory.id,
  });
  const drafted = await contracts.getContractScreen(ctx, agreement.id);
  await contracts.updateContract(ctx, agreement.id, {
    clauses: drafted.contract.clauses,
    signedOn: today,
    cmRates: made.map((s, i) => ({ projectId: s.projectId, cmRate: SIMULATION_BRANDS[i]!.cmRate })),
  });
  step(
    `Signed the factory CM agreement: ${SIMULATION_BRANDS.map((b) => `${b.brand} ${bdt(b.cmRate)}`).join(", ")} a piece.`,
  );

  // 5. The fabric booking: 1,150 kg at 640 a kg (a batch's fabric is always booked).
  const booked = await bookings.createBooking(ctx, {
    source: "SUPPLIER_PO",
    category: "KNITWEAR",
    supplierId: mill.id,
    batchId: batch.id,
    expectedDate: addDays(today, 10),
    lines: [{ materialId: fabric.id, quantity: FABRIC_ORDERED_KG, unitPrice: FABRIC_PRICE }],
  });
  const orderId = (
    await prisma.purchaseOrder.findFirstOrThrow({
      where: { companyId, batchId: batch.id },
      select: { id: true },
    })
  ).id;
  step(
    `Booked ${pcs(FABRIC_ORDERED_KG)} kg of fabric from ${mill.name} at ${bdt(FABRIC_PRICE)} a kg (booking ${booked.number}).`,
  );
  // A booking is a draft until it is approved; then it goes to the mill.
  await bookings.approveBooking(ctx, booked.id);
  await bookings.markBookingSent(ctx, booked.id);
  step(`Approved booking ${booked.number} (R0) and marked it as sent to ${mill.name}.`);

  // 6. The advance: 1,00,000 to the factory for the batch, from the bank.
  const advance = await batchMoney.payForBatch(ctx, batch.id, {
    amount: SIMULATION_ADVANCE,
    method: "BANK_TRANSFER",
    accountId: bank.id,
    reference: "SIM-ADVANCE",
  });
  step(`Paid the advance CM ${advance.number}: ${bdt(SIMULATION_ADVANCE)} to ${factory.name}.`);

  // 7. The fabric comes 25 kg short of its challan: the mill's fault, logged on its own.
  const screen = await receive.getBatchReceive(ctx, batch.id, orderId);
  const line = screen.order!.lines.find((l) => l.material.id === fabric.id)!;
  const received = await receive.receiveBatchDelivery(ctx, batch.id, {
    orderId,
    supplierRef: "SIM-CHALLAN-01",
    lines: [
      {
        lineId: line.id,
        challanQuantity: FABRIC_ORDERED_KG,
        quantity: FABRIC_ORDERED_KG - FABRIC_SHORT_KG,
      },
    ],
  });
  step(
    `Received the fabric: challan ${pcs(FABRIC_ORDERED_KG)} kg, actual ${pcs(FABRIC_ORDERED_KG - FABRIC_SHORT_KG)} kg; ${received.shorts.length} short logged as ${mill.name}'s fault.`,
  );

  // 8. The store issues 225 kg to each style.
  await batchIssue.issueToStyles(ctx, batch.id, {
    receivedBy: "Cutting master (simulation)",
    lines: made.map((s) => ({
      projectId: s.projectId,
      materialId: fabric.id,
      quantity: FABRIC_ISSUED_KG,
    })),
  });
  step(`Issued ${FABRIC_ISSUED_KG} kg of fabric to each style.`);

  // 9. Cutting: 1,020 pieces a style, 5,100 in all.
  const cell = (size: string, quantity: number) => ({
    colorName: colour.name,
    sizeName: sizeNames.get(sizeIds[SIMULATION_SIZES.findIndex((s) => s.size === size)]!)!,
    quantity,
  });
  for (const s of made) {
    await cutting.createCuttingReport(ctx, s.projectId, {
      lines: SIMULATION_SIZES.map((z) => cell(z.size, z.cut)),
      fabricUsed: [{ materialId: fabric.id, quantity: FABRIC_USED_KG }],
      note: "Simulation cutting",
    });
  }
  step(`Cut ${pcs(5100)} pieces: 1,020 a style.`);

  // 10. Embroidery at the factory: all of it sent, some spoiled, logged as the factory's
  //     fault at the fabric value of the spoiled pieces.
  for (const s of made) {
    const job = await cutting.sendToEmbroidery(ctx, s.projectId, {
      kind: "EMBROIDERY",
      partyId: factory.id,
      dueOn: addDays(today, 7),
      lines: SIMULATION_SIZES.map((z) => cell(z.size, z.cut)),
      note: "Chest logo",
    });
    await cutting.receiveFromEmbroidery(ctx, job.id, {
      lines: SIMULATION_SIZES.map((z) => {
        const c = cell(z.size, 0);
        return {
          colorName: c.colorName,
          sizeName: c.sizeName,
          received: z.cut - z.spoiled,
          spoiled: z.spoiled,
        };
      }),
    });
    const issued = await prisma.materialIssue.aggregate({
      where: { projectId: s.projectId },
      _sum: { totalValue: true },
    });
    const spoiled = SIMULATION_SIZES.reduce((t, z) => t + z.spoiled, 0);
    const cut = SIMULATION_SIZES.reduce((t, z) => t + z.cut, 0);
    await faults.createFault(ctx, {
      supplierId: factory.id,
      kind: "QUALITY",
      projectId: s.projectId,
      quantity: spoiled,
      amount: money(issued._sum.totalValue!.times(spoiled).dividedBy(cut)).toNumber(),
      note: `${spoiled} pieces spoiled at embroidery on ${job.number}, at the fabric value of the pieces`,
    });
  }
  step(`Embroidered: 6 pieces a style spoiled (30 in all), logged as ${factory.name}'s faults.`);

  // 11. Finishing: graded A, B and C with rejects apart.
  for (const s of made) {
    await finishing.createFinishingCount(ctx, s.projectId, {
      lines: SIMULATION_SIZES.map((z) => {
        const c = cell(z.size, 0);
        return {
          colorName: c.colorName,
          sizeName: c.sizeName,
          a: z.a,
          b: z.b,
          c: z.c,
          reject: z.reject,
        };
      }),
    });
  }
  step("Graded at finishing: 986 A, 12 B, 8 C and 4 rejects a style.");

  // 12. The factory's CM bills: the CM a piece times the pieces it handed over (A+B+C+rejects).
  await costs.ensureProductionCostHeads(companyId);
  const sewing = await prisma.expenseHead.findFirstOrThrow({
    where: { companyId, name: "Sewing (CM)" },
  });
  const cmPieces = SIMULATION_SIZES.reduce((t, z) => t + z.a + z.b + z.c + z.reject, 0);
  for (const [i, s] of made.entries()) {
    const rate = SIMULATION_BRANDS[i]!.cmRate;
    await costs.addProjectCost(ctx, s.projectId, {
      expenseHeadId: sewing.id,
      amount: rate * cmPieces,
      paymentType: "DUE",
      supplierId: factory.id,
      supplierRef: `SIM-CM-${SIMULATION_BRANDS[i]!.code}`,
      description: `CM: ${pcs(cmPieces)} pieces at ${fixed(rate)}`,
    });
  }
  step(`Entered the factory's CM bills: ${pcs(cmPieces)} pieces a style at its CM.`);

  // 13. The full packing list: A and B to stock, the missing pieces into the factory's fault log.
  for (const s of made) {
    await finishing.receivePackingList(ctx, s.projectId, {
      missing: SIMULATION_SIZES.map((z) => cell(z.size, z.missing)),
      note: "Simulation packing list",
    });
  }
  step("Received the full packing lists: 998 pieces a style to stock, 4 missing.");

  // 14. The final CM settlement, the C-grade CM taken off: it posts its journal entry.
  const settled = await batchMoney.settleCm(ctx, batch.id, {
    deductCGrade: true,
    note: "Simulation settlement",
  });
  step(
    `Saved the final CM settlement ${settled.number}: ${bdt(settled.deducted)} of deductions on ${settled.entry}, final payable ${bdt(settled.payable)}.`,
  );

  // What it added to the company's set-up along the way.
  created.ledgerAccountIds = (
    await prisma.ledgerAccount.findMany({ where: { companyId }, select: { id: true } })
  )
    .map((a) => a.id)
    .filter((id) => !known.ledgerAccountIds.has(id));
  created.expenseHeadIds = (
    await prisma.expenseHead.findMany({ where: { companyId }, select: { id: true } })
  )
    .map((h) => h.id)
    .filter((id) => !known.expenseHeadIds.has(id));
  created.warehouseIds = (
    await prisma.warehouse.findMany({ where: { companyId }, select: { id: true } })
  )
    .map((w) => w.id)
    .filter((id) => !known.warehouseIds.has(id));
  const sequencesAfter = await prisma.documentSequence.findMany({
    where: { companyId },
    select: { id: true, nextNumber: true },
  });

  return {
    companyId,
    batchId: batch.id,
    batchCode,
    factory: { id: factory.id, name: factory.name },
    mill: { id: mill.id, name: mill.name },
    bankAccount: bank,
    styles: made,
    created,
    before,
    sequencesAfter,
    steps,
  };
}

// =============================================================================
// Everything a run made, found from its batch
// =============================================================================

/** The records linked to the batch: its styles and everything done for them. */
async function linked(companyId: string, batchId: string) {
  const projectIds = (
    await prisma.productionProject.findMany({
      where: { companyId, batchId },
      select: { id: true },
    })
  ).map((p) => p.id);
  const ids = <T extends { id: string }>(rows: T[]) => rows.map((r) => r.id);
  const byProject = { projectId: { in: projectIds } };
  const orders = await prisma.purchaseOrder.findMany({
    where: { companyId, OR: [{ batchId }, byProject] },
    select: { id: true },
  });
  const bookings = await prisma.booking.findMany({
    where: { companyId, orderId: { in: ids(orders) } },
    select: { id: true },
  });
  const bills = await prisma.supplierBill.findMany({
    where: {
      companyId,
      OR: [{ purchaseOrderId: { in: ids(orders) } }, { allocations: { some: byProject } }],
    },
    select: { id: true, journalEntryId: true },
  });
  const payments = await prisma.payment.findMany({
    where: {
      companyId,
      OR: [{ batchId }, byProject, { supplierBillId: { in: ids(bills) } }],
    },
    select: { id: true, journalEntryId: true },
  });
  const issues = await prisma.materialIssue.findMany({
    where: { companyId, ...byProject },
    select: { id: true, journalEntryId: true },
  });
  const expenses = await prisma.expense.findMany({
    where: { companyId, ...byProject },
    select: { id: true, journalEntryId: true },
  });
  const intakes = await prisma.stockIntake.findMany({
    where: { companyId, ...byProject },
    select: { id: true },
  });
  const settlements = await prisma.cmSettlement.findMany({
    where: { companyId, batchId },
    select: { id: true, journalEntryId: true },
  });
  const faultRows = await prisma.supplierFault.findMany({
    where: {
      companyId,
      OR: [{ batchId }, byProject, { billId: { in: ids(bills) } }],
    },
    select: { id: true },
  });
  const cuttingReports = await prisma.cuttingReport.findMany({
    where: { companyId, ...byProject },
    select: { id: true },
  });
  const embroideryJobs = await prisma.embroideryJob.findMany({
    where: { companyId, ...byProject },
    select: { id: true },
  });
  const finishingReports = await prisma.finishingReport.findMany({
    where: { companyId, ...byProject },
    select: { id: true },
  });
  const agreements = await prisma.productionContract.findMany({
    where: { companyId, batchId },
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
    ];
  const direct = [...bills, ...payments, ...issues, ...expenses, ...settlements]
    .map((r) => r.journalEntryId)
    .filter((id): id is string => id !== null);
  const entries = await prisma.journalEntry.findMany({
    where: {
      companyId,
      OR: [
        { id: { in: direct } },
        ...sources.map((s) => ({ sourceType: s.sourceType, sourceId: { in: s.ids } })),
      ],
    },
    select: { id: true },
  });
  // Reversals of those entries (an undone settlement, a reversed delivery...).
  const reversals = await prisma.journalEntry.findMany({
    where: { companyId, reversalOfId: { in: ids(entries) } },
    select: { id: true },
  });
  return {
    projectIds,
    orderIds: ids(orders),
    bookingIds: ids(bookings),
    billIds: ids(bills),
    paymentIds: ids(payments),
    issueIds: ids(issues),
    expenseIds: ids(expenses),
    intakeIds: ids(intakes),
    settlementIds: ids(settlements),
    faultIds: ids(faultRows),
    cuttingIds: ids(cuttingReports),
    embroideryIds: ids(embroideryJobs),
    finishingIds: ids(finishingReports),
    agreementIds: ids(agreements),
    entryIds: [...new Set([...ids(entries), ...ids(reversals)])],
  };
}

// =============================================================================
// The financial footprint
// =============================================================================

/** What the run left in the books, for the Simulation Report. */
export async function readFootprint(ctx: CompanyContext, run: SimulationRun) {
  const { companyId } = run;
  const found = await linked(companyId, run.batchId);
  const entries = await prisma.journalEntry.findMany({
    where: { id: { in: found.entryIds } },
    select: {
      number: true,
      sourceType: true,
      description: true,
      lines: {
        select: {
          debit: true,
          credit: true,
          memo: true,
          party: { select: { name: true } },
          account: { select: { code: true, name: true } },
        },
        orderBy: [{ debit: "desc" }, { credit: "desc" }],
      },
    },
    orderBy: [{ createdAt: "asc" }, { number: "asc" }],
  });
  const accounts = new Map<
    string,
    { name: string; debit: Prisma.Decimal; credit: Prisma.Decimal }
  >();
  for (const e of entries) {
    for (const l of e.lines) {
      const row = accounts.get(l.account.code) ?? {
        name: l.account.name,
        debit: new Prisma.Decimal(0),
        credit: new Prisma.Decimal(0),
      };
      row.debit = row.debit.plus(l.debit);
      row.credit = row.credit.plus(l.credit);
      accounts.set(l.account.code, row);
    }
  }
  const bills = await prisma.supplierBill.findMany({
    where: { id: { in: found.billIds } },
    select: {
      number: true,
      supplierRef: true,
      totalAmount: true,
      paidAmount: true,
      dueAmount: true,
      status: true,
      supplier: { select: { name: true } },
    },
    orderBy: { number: "asc" },
  });
  const faultRows = await prisma.supplierFault.findMany({
    where: { id: { in: found.faultIds } },
    select: {
      number: true,
      kind: true,
      status: true,
      quantity: true,
      amount: true,
      note: true,
      supplier: { select: { name: true } },
      project: { select: { code: true } },
    },
    orderBy: { number: "asc" },
  });
  const settlement = await prisma.cmSettlement.findFirstOrThrow({
    where: { companyId, batchId: run.batchId, undoneAt: null },
    include: { journalEntry: { select: { number: true } } },
  });
  const finishingScreens = [];
  for (const s of run.styles) {
    const screen = await finishing.getFinishingScreen(ctx, s.projectId);
    const project = await prisma.productionProject.findUniqueOrThrow({
      where: { id: s.projectId },
      select: { totalCost: true, cmRate: true },
    });
    finishingScreens.push({
      ...s,
      totals: screen.totals,
      totalCost: fixed(project.totalCost),
      cmRate: project.cmRate ? fixed(project.cmRate) : null,
      unitCost: fixed(project.totalCost.dividedBy(screen.totals.a + screen.totals.b)),
    });
  }
  const stock = await prisma.stockBalance.aggregate({
    where: { companyId, variant: { styleId: { in: run.created.styleIds } } },
    _sum: { quantity: true },
  });
  return {
    entries: entries.map((e) => ({
      number: e.number,
      sourceType: e.sourceType,
      description: e.description,
      lines: e.lines.map((l) => ({
        account: `${l.account.code} ${l.account.name}`,
        party: l.party?.name ?? null,
        debit: fixed(l.debit),
        credit: fixed(l.credit),
        memo: l.memo,
      })),
    })),
    accounts: [...accounts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, a]) => ({
        account: `${code} ${a.name}`,
        debit: fixed(a.debit),
        credit: fixed(a.credit),
        net: fixed(a.debit.minus(a.credit)),
      })),
    due: {
      factory: {
        before: run.before.due[run.factory.id]!,
        after: await supplierDue(ctx, run.factory.id),
      },
      mill: { before: run.before.due[run.mill.id]!, after: await supplierDue(ctx, run.mill.id) },
    },
    bills: bills.map((b) => ({
      number: b.number,
      supplier: b.supplier.name,
      ref: b.supplierRef,
      total: fixed(b.totalAmount),
      paid: fixed(b.paidAmount),
      due: fixed(b.dueAmount),
      status: b.status,
    })),
    faults: faultRows.map((f) => ({
      number: f.number,
      supplier: f.supplier.name,
      kind: f.kind,
      style: f.project?.code ?? null,
      quantity: f.quantity ? f.quantity.toFixed(3).replace(/\.?0+$/, "") : null,
      amount: f.amount ? fixed(f.amount) : null,
      status: f.status,
      note: f.note,
    })),
    settlement: {
      number: settlement.number,
      entry: settlement.journalEntry?.number ?? null,
      totalCm: fixed(settlement.totalCm),
      deductions: fixed(settlement.deductions),
      paid: fixed(settlement.paid),
      payable: fixed(settlement.payable),
      snapshot: settlement.snapshot as unknown as {
        totals: { faults: string; cGradeCm: string };
      },
    },
    styles: finishingScreens,
    stockPieces: stock._sum.quantity ?? 0,
  };
}

export type Footprint = Awaited<ReturnType<typeof readFootprint>>;

const SOURCE_NAMES: Record<string, string> = {
  SUPPLIER_BILL: "Supplier bill",
  PAYMENT: "Payment",
  MATERIAL_ISSUE: "Material issue",
  STOCK_INTAKE: "Delivery to stock",
  PRODUCTION: "Production",
  CM_SETTLEMENT: "CM settlement",
  EXPENSE: "Expense",
};

/** The Simulation Report, in Markdown (the GitHub job summary and the PR). */
export function simulationReport(run: SimulationRun, f: Footprint, wiped?: string[]) {
  const out: string[] = [];
  const row = (...cells: Array<string | number | null>) =>
    out.push(`| ${cells.map((c) => (c === null ? "" : String(c))).join(" | ")} |`);
  out.push(`# Simulation Report: ${SIMULATION_BATCH} (${run.batchCode})`, "");
  out.push(
    `Factory **${run.factory.name}**, fabric from **${run.mill.name}**, advance paid from **${run.bankAccount.code} ${run.bankAccount.name}**. Fabric: ${SIMULATION_FABRIC}.`,
    "",
  );
  out.push("## What ran, step by step", "");
  run.steps.forEach((s, i) => out.push(`${i + 1}. ${s}`));
  out.push("", "## The styles", "");
  row(
    "Style",
    "Brand",
    "Target price",
    "Cut",
    "A",
    "B",
    "C",
    "Rejects",
    "Missing",
    "CM a piece",
    "Total cost",
    "Final unit cost",
  );
  row("---", "---", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:", "---:");
  for (const s of f.styles) {
    row(
      s.code,
      s.brand,
      bdt(s.targetUnitCost),
      s.totals.cut,
      s.totals.a,
      s.totals.b,
      s.totals.c,
      s.totals.reject,
      s.totals.missing,
      s.cmRate ? bdt(s.cmRate) : null,
      bdt(s.totalCost),
      bdt(s.unitCost),
    );
  }
  out.push("", `Pieces in stock (A and B): **${pcs(f.stockPieces)}**.`, "");
  out.push("## The final CM settlement", "");
  row("Line", "Amount");
  row("---", "---:");
  row("Total CM (A + B + C + rejects at each style's CM)", bdt(f.settlement.totalCm));
  row(
    "Less faults (missing pieces, embroidery spoilage)",
    bdt(f.settlement.snapshot.totals.faults),
  );
  row("Less the CM of the C-grade pieces", bdt(f.settlement.snapshot.totals.cGradeCm));
  row("Less the advance taken", bdt(f.settlement.paid));
  row(
    `**Final payable to ${run.factory.name}** (${f.settlement.number})`,
    `**${bdt(f.settlement.payable)}**`,
  );
  out.push(
    "",
    `The deductions (${bdt(f.settlement.deductions)}) came off ${run.factory.name}'s Supplier Due on ${f.settlement.entry}.`,
    "",
  );
  out.push("## Supplier Due", "");
  row("Supplier", "Before", "After", "Change");
  row("---", "---:", "---:", "---:");
  for (const [name, d] of [
    [run.factory.name, f.due.factory],
    [run.mill.name, f.due.mill],
  ] as const) {
    row(name, bdt(d.before), bdt(d.after), bdt(new Prisma.Decimal(d.after).minus(d.before)));
  }
  out.push("", "## Bills", "");
  row("Bill", "Supplier", "Their ref", "Total", "Paid", "Due", "Status");
  row("---", "---", "---", "---:", "---:", "---:", "---");
  for (const b of f.bills)
    row(b.number, b.supplier, b.ref, bdt(b.total), bdt(b.paid), bdt(b.due), b.status);
  out.push("", "## Fault log", "");
  row("Fault", "Supplier", "Kind", "Style", "Qty", "Value", "Status");
  row("---", "---", "---", "---", "---:", "---:", "---");
  for (const x of f.faults) {
    row(
      x.number,
      x.supplier,
      x.kind,
      x.style,
      x.quantity,
      x.amount ? bdt(x.amount) : "to agree",
      x.status,
    );
  }
  out.push("", "## Journal entries posted", "");
  for (const e of f.entries) {
    out.push(
      `**${e.number}** (${SOURCE_NAMES[e.sourceType] ?? e.sourceType}): ${e.description ?? ""}`,
      "",
    );
    row("Account", "Party", "Debit", "Credit");
    row("---", "---", "---:", "---:");
    for (const l of e.lines) {
      row(
        l.account,
        l.party,
        Number(l.debit) ? bdt(l.debit) : null,
        Number(l.credit) ? bdt(l.credit) : null,
      );
    }
    out.push("");
  }
  out.push("## Net effect on each account", "");
  row("Account", "Debits", "Credits", "Net (Dr + / Cr -)");
  row("---", "---:", "---:", "---:");
  for (const a of f.accounts) row(a.account, bdt(a.debit), bdt(a.credit), bdt(a.net));
  if (wiped) {
    out.push("", "## The wipe", "");
    wiped.forEach((w) => out.push(`- ${w}`));
  }
  return out.join("\n") + "\n";
}

// =============================================================================
// The wipe
// =============================================================================

/**
 * Wipes every record the run made, from its batch down, and puts back what it
 * touched: the suppliers' bills as they stood, their last activity, the number
 * counters (when nothing else was numbered since) and any set-up it added.
 * Returns what it removed, by table.
 */
export async function teardownSimulation(run: SimulationRun) {
  const { companyId } = run;
  const found = await linked(companyId, run.batchId);
  const removed: string[] = [];
  const note = (table: string, count: number) => {
    if (count > 0) removed.push(`${table}: ${count}`);
  };
  const styleVariantIds = (
    await prisma.productVariant.findMany({
      where: { styleId: { in: run.created.styleIds } },
      select: { id: true },
    })
  ).map((v) => v.id);
  const lotIds = (
    await prisma.stockLot.findMany({
      where: {
        OR: [{ styleId: { in: run.created.styleIds } }, { intakeId: { in: found.intakeIds } }],
      },
      select: { id: true },
    })
  ).map((l) => l.id);
  const allIds = [
    run.batchId,
    ...Object.values(found).flat(),
    ...run.created.brandIds,
    ...run.created.categoryIds,
    ...run.created.colorIds,
    ...run.created.sizeIds,
    ...run.created.styleIds,
    ...run.created.materialIds,
    ...run.created.ledgerAccountIds,
    ...run.created.expenseHeadIds,
    ...run.created.warehouseIds,
    ...styleVariantIds,
    ...lotIds,
  ];

  await prisma.$transaction(
    async (tx) => {
      const del = async (table: string, run: () => Promise<{ count: number }>) =>
        note(table, (await run()).count);
      await del("NotificationLog", () =>
        tx.notificationLog.deleteMany({ where: { companyId, entityId: { in: allIds } } }),
      );
      await del("AuditLog", () =>
        tx.auditLog.deleteMany({ where: { companyId, entityId: { in: allIds } } }),
      );
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
        tx.stockMovement.deleteMany({
          where: {
            OR: [
              { variantId: { in: styleVariantIds } },
              { referenceType: "StockIntake", referenceId: { in: found.intakeIds } },
            ],
          },
        }),
      );
      await del("StockLot", () => tx.stockLot.deleteMany({ where: { id: { in: lotIds } } }));
      await del("StockBalance", () =>
        tx.stockBalance.deleteMany({ where: { variantId: { in: styleVariantIds } } }),
      );
      await del("StockIntake", () =>
        tx.stockIntake.deleteMany({ where: { id: { in: found.intakeIds } } }),
      );
      await del("RawMaterialMovement", () =>
        tx.rawMaterialMovement.deleteMany({
          where: {
            OR: [
              { rawMaterialId: { in: run.created.materialIds } },
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
      await del("ProductionBatch", () =>
        tx.productionBatch.deleteMany({ where: { id: run.batchId, companyId } }),
      );
      await del("RawMaterial", () =>
        tx.rawMaterial.deleteMany({ where: { id: { in: run.created.materialIds } } }),
      );
      await del("Style", () =>
        tx.style.deleteMany({ where: { id: { in: run.created.styleIds } } }),
      );
      await del("Brand", () =>
        tx.brand.deleteMany({ where: { id: { in: run.created.brandIds } } }),
      );
      await del("Category", () =>
        tx.category.deleteMany({ where: { id: { in: run.created.categoryIds } } }),
      );
      await del("Color", () =>
        tx.color.deleteMany({ where: { id: { in: run.created.colorIds } } }),
      );
      await del("Size", () => tx.size.deleteMany({ where: { id: { in: run.created.sizeIds } } }));
      // Set-up added on the way, when nothing else uses it.
      await del("ExpenseHead", () =>
        tx.expenseHead.deleteMany({
          where: {
            id: { in: run.created.expenseHeadIds },
            expenses: { none: {} },
            billAllocations: { none: {} },
          },
        }),
      );
      await del("LedgerAccount", () =>
        tx.ledgerAccount.deleteMany({
          where: { id: { in: run.created.ledgerAccountIds }, lines: { none: {} } },
        }),
      );
      // A store made for the fabric (the company had none) goes when it is empty and unused.
      const unused = { none: {} };
      await del("Warehouse", () =>
        tx.warehouse.deleteMany({
          where: {
            id: { in: run.created.warehouseIds },
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

      // The suppliers' bills settle again from the ledger as it was, then their dates go back.
      for (const supplierId of [run.factory.id, run.mill.id]) {
        await settleSupplierBills(tx, companyId, supplierId);
      }
      let restored = 0;
      for (const b of run.before.bills) {
        const now = await tx.supplierBill.findUnique({ where: { id: b.id } });
        if (!now) continue;
        if (
          fixed(now.paidAmount) === b.paidAmount &&
          fixed(now.dueAmount) === b.dueAmount &&
          now.status === b.status
        ) {
          await tx.$executeRaw`UPDATE "SupplierBill" SET "updatedAt" = ${b.updatedAt} WHERE "id" = ${b.id}`;
          restored += 1;
        } else {
          throw new AppError(
            "CONFLICT",
            `Bill ${now.number} did not settle back to where it was; nothing was wiped.`,
          );
        }
      }
      note("SupplierBill (put back as it was)", restored);
      for (const p of run.before.parties) {
        await tx.$executeRaw`UPDATE "Party" SET "lastTransactionAt" = ${p.lastTransactionAt}, "updatedAt" = ${p.updatedAt} WHERE "id" = ${p.id}`;
      }
      note("Party (last activity put back)", run.before.parties.length);

      // The number counters: back to where they were, unless something else was numbered since.
      let counters = 0;
      for (const s of run.sequencesAfter) {
        const now = await tx.documentSequence.findUnique({ where: { id: s.id } });
        if (!now || now.nextNumber !== s.nextNumber) continue;
        const was = run.before.sequences.find((b) => b.id === s.id);
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
    { timeout: 120_000 },
  );
  return removed;
}
