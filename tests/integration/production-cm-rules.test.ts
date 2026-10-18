import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The real CM rules:
 *   - An embroidery or print house (a supplier of that type) owns the pieces it
 *     spoils: taking them back logs the fault at the fabric in a cut piece and
 *     takes it off the house's own Supplier Due at once, never the factory's.
 *     Reopening or waiving the fault puts it back; deducting it again takes it off.
 *   - Rejects up to the batch's allowance (2% of the pieces cut unless changed)
 *     cost the factory nothing; each one over it is taken off the final CM
 *     settlement at the style's target price. Missing pieces always are.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { prisma } from "@/lib/prisma";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as batchIssue from "@/modules/production/batch-issue.service";
import * as batchMoney from "@/modules/production/batch-money.service";
import * as bookings from "@/modules/production/booking.service";
import * as batchSummary from "@/modules/production/batch-summary.service";
import * as batches from "@/modules/production/batch.service";
import * as cutting from "@/modules/production/cutting.service";
import * as faults from "@/modules/production/fault.service";
import * as finishing from "@/modules/production/finishing.service";
import * as needs from "@/modules/production/material-need.service";
import * as projects from "@/modules/production/project.service";
import * as receive from "@/modules/production/receive.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  accounts: "ACCOUNTS",
  store: "WAREHOUSE_TEAM",
} as const;
type Who = keyof typeof ROLES;

/**
 * A batch at a CM factory with one polo (Navy S 50, M 50, target price 480,
 * CM 90 a piece): 25 kg of fabric at 700 a kg (17,500) issued to it and all
 * 100 pieces cut, so a cut piece is worth 175.00. "Demo Embo" is an
 * embroidery house.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    people[who] = user;
  }
  const owner = await contextFor(people.owner.id, company.id);
  const pm = await contextFor(people.production.id, company.id);
  const accounts = await contextFor(people.accounts.id, company.id);
  const store = await contextFor(people.store.id, company.id);
  const small = await catalog.createSize(owner, { name: "S" });
  const medium = await catalog.createSize(owner, { name: "M" });
  const navy = await catalog.createColor(owner, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(owner, { name: "Tops" });
  const style = await styles.createStyle(owner, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(owner, style.id, {
    colorIds: [navy.id],
    sizeIds: [small.id, medium.id],
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true },
  });
  const sku = (size: string) => variants.find((v) => v.size.name === size)!.id;
  const supplier = async (name: string, categories: Array<"FABRIC" | "CM" | "EMBROIDERY_PRINT">) =>
    (
      await parties.createParty(owner, {
        kind: "SUPPLIER",
        name,
        supplierCategories: categories,
      })
    ).party;
  const factory = await supplier("Gazipur Knit Factory", ["CM"]);
  const mill = await supplier("Narayanganj Fabrics", ["FABRIC"]);
  const embo = await supplier("Demo Embo", ["EMBROIDERY_PRINT"]);
  const pique = await materials.createMaterial(pm, {
    name: "Pique 220 GSM",
    kind: "FABRIC",
    unit: "KG",
    supplierId: mill.id,
  });
  const batch = await batches.createBatch(pm, {
    name: "Five Style Polo",
    factoryId: factory.id,
    targetDate: "2030-12-20",
  });
  const polo = await projects.createProject(pm, {
    name: "Ralph Lauren polo",
    batchId: batch.id,
    factoryId: factory.id,
    targetDate: "2030-12-20",
    targetUnitCost: 480,
    targets: [
      { variantId: sku("S"), quantity: 50 },
      { variantId: sku("M"), quantity: 50 },
    ],
  });
  await prisma.productionProject.update({ where: { id: polo.id }, data: { cmRate: 90 } });
  await needs.setMaterialNeeds(pm, polo.id, {
    needs: [{ materialId: pique.id, perPiece: 0.25, split: "COLOUR", placement: "Main body" }],
  });
  const booked = await bookings.createBooking(pm, {
    source: "SUPPLIER_PO",
    category: "KNITWEAR",
    supplierId: mill.id,
    batchId: batch.id,
    expectedDate: "2030-11-15",
    lines: [{ materialId: pique.id, quantity: 25, unitPrice: 700 }],
  });
  // The owner approves it, so its goods can arrive.
  await bookings.approveBooking(owner, booked.id);
  const order = await prisma.purchaseOrder.findFirstOrThrow({ where: { supplierId: mill.id } });
  const screen = await receive.getBatchReceive(pm, batch.id, order.id);
  await receive.receiveBatchDelivery(pm, batch.id, {
    orderId: order.id,
    lines: screen.order!.lines.map((l) => ({
      lineId: l.id,
      challanQuantity: 25,
      quantity: 25,
    })),
  });
  await batchIssue.issueToStyles(store, batch.id, {
    lines: [{ projectId: polo.id, materialId: pique.id, colorName: "Navy", quantity: 25 }],
  });
  await cutting.createCuttingReport(pm, polo.id, {
    lines: [
      { colorName: "Navy", sizeName: "S", quantity: 50 },
      { colorName: "Navy", sizeName: "M", quantity: 50 },
    ],
  });
  return { company, owner, pm, accounts, store, factory, mill, embo, batch, polo };
}

type Env = Awaited<ReturnType<typeof setup>>;

run("The real CM rules: embroidery houses' spoilage and the reject allowance", () => {
  let env: Env;

  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  /** What we owe a supplier (their Supplier Due). */
  const due = async (partyId: string) =>
    (await getPartyBalance(env.accounts, partyId)).neg().toFixed(2);

  it("takes pieces an embroidery house spoils off its own Supplier Due, never the factory's", async () => {
    const job = await cutting.sendToEmbroidery(env.pm, env.polo.id, {
      kind: "EMBROIDERY",
      partyId: env.embo.id,
      lines: [
        { colorName: "Navy", sizeName: "S", quantity: 50 },
        { colorName: "Navy", sizeName: "M", quantity: 50 },
      ],
    });
    const factoryBefore = await due(env.factory.id);
    const back = await cutting.receiveFromEmbroidery(env.pm, job.id, {
      lines: [
        { colorName: "Navy", sizeName: "S", received: 48, spoiled: 2 },
        { colorName: "Navy", sizeName: "M", received: 49, spoiled: 1 },
      ],
    });
    // 3 spoiled at 175.00 a cut piece (17,500 of fabric over 100 pieces cut).
    expect(back.spoiled).toBe(3);
    expect(back.charged).toMatchObject({ amount: "525.00", perPiece: "175.00" });
    const fault = await prisma.supplierFault.findFirstOrThrow({
      where: { supplierId: env.embo.id },
      include: { journalEntry: { include: { lines: { include: { account: true } } } } },
    });
    expect(fault).toMatchObject({
      kind: "SPOILED_PIECES",
      status: "DEDUCTED",
      batchId: env.batch.id,
      projectId: env.polo.id,
    });
    expect(fault.quantity!.toNumber()).toBe(3);
    expect(fault.amount!.toFixed(2)).toBe("525.00");
    expect(fault.journalEntry!.sourceType).toBe("SUPPLIER_FAULT");
    expect(fault.journalEntry!.number).toBe(back.charged!.entry);
    expect(
      fault
        .journalEntry!.lines.map((l) => [
          l.account.code,
          l.partyId,
          l.debit.toFixed(2),
          l.credit.toFixed(2),
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual([
      ["2100", env.embo.id, "525.00", "0.00"],
      ["4250", null, "0.00", "525.00"],
    ]);
    // Demo Embo has billed nothing yet, so it now owes the 525 back; the factory is untouched.
    expect(await due(env.embo.id)).toBe("-525.00");
    expect(await due(env.factory.id)).toBe(factoryBefore);
    // The CM settlement does not take it off the factory again.
    const draft = (await batchMoney.getCmSettlementScreen(env.pm, env.batch.id)).draft!;
    expect(draft.faults).toEqual([]);

    // Cut again: the house's fault is not logged twice.
    const replaced = await cutting.replaceFromCutting(env.pm, job.id, {
      lines: [
        { colorName: "Navy", sizeName: "S", quantity: 2 },
        { colorName: "Navy", sizeName: "M", quantity: 1 },
      ],
      logFault: true,
    });
    expect(replaced.fault).toBeNull();
    expect(await prisma.supplierFault.count({ where: { supplierId: env.embo.id } })).toBe(1);
    const screen = await cutting.getCuttingScreen(env.pm, env.polo.id);
    expect(screen.jobs[0]!.party).toMatchObject({ name: "Demo Embo", chargesSpoilage: true });

    // Reopened, the 525 goes back on Demo Embo's Supplier Due; deducted again, it comes off.
    const reopened = await faults.settleFault(env.accounts, fault.id, { status: "OPEN" });
    expect(reopened.entry).toMatch(/^JV-/);
    expect(await due(env.embo.id)).toBe("0.00");
    const open = await prisma.supplierFault.findUniqueOrThrow({ where: { id: fault.id } });
    expect([open.status, open.journalEntryId]).toEqual(["OPEN", null]);
    const again = await faults.settleFault(env.pm, fault.id, { status: "DEDUCTED" });
    expect(again.entry).toMatch(/^JV-/);
    expect(await due(env.embo.id)).toBe("-525.00");
    await faults.settleFault(env.accounts, fault.id, {
      status: "WAIVED",
      note: "Agreed to let go",
    });
    expect(await due(env.embo.id)).toBe("0.00");
    expect(
      await prisma.journalEntry.count({
        where: { sourceType: "SUPPLIER_FAULT", isReversed: false, reversalOfId: null },
      }),
    ).toBe(0);
  });

  it("keeps the old way for a house that is not an embroidery or print supplier", async () => {
    const job = await cutting.sendToEmbroidery(env.pm, env.polo.id, {
      kind: "PRINT",
      partyId: env.factory.id,
      lines: [{ colorName: "Navy", sizeName: "S", quantity: 10 }],
    });
    const back = await cutting.receiveFromEmbroidery(env.pm, job.id, {
      lines: [{ colorName: "Navy", sizeName: "S", received: 9, spoiled: 1 }],
    });
    expect(back.charged).toBeNull();
    expect(await prisma.supplierFault.count()).toBe(0);
    const replaced = await cutting.replaceFromCutting(env.pm, job.id, {
      lines: [{ colorName: "Navy", sizeName: "S", quantity: 1 }],
      logFault: true,
    });
    expect(replaced.fault).not.toBeNull();
    const fault = await prisma.supplierFault.findFirstOrThrow({});
    expect([fault.kind, fault.supplierId, fault.amount]).toEqual(["QUALITY", env.factory.id, null]);
  });

  it("charges the rejects over the 2% allowance at the target price on the CM settlement", async () => {
    // S: 45 A, 2 B, 3 rejects; M: 44 A, 1 B, 4 rejects (1 M not counted yet). 7 rejects of
    // 100 cut: the allowance is 2, so 5 are charged at 480.
    await finishing.createFinishingCount(env.store, env.polo.id, {
      lines: [
        { colorName: "Navy", sizeName: "S", a: 45, b: 2, c: 0, reject: 3 },
        { colorName: "Navy", sizeName: "M", a: 44, b: 1, c: 0, reject: 4 },
      ],
    });
    const draft = (await batchMoney.getCmSettlementScreen(env.pm, env.batch.id)).draft!;
    expect(draft.rejectAllowancePercent).toBe("2");
    expect(draft.styles[0]).toMatchObject({
      reject: 7,
      cut: 100,
      allowance: 2,
      overAllowance: 5,
      targetPrice: "480.00",
      rejectPenalty: "2400.00",
    });
    // CM: 99 pieces handed over (A, B and rejects) at 90.
    expect(draft.keepC).toMatchObject({
      totalCm: "8910.00",
      rejects: "2400.00",
      deductions: "2400.00",
      payable: "6510.00",
    });

    // At 10% the allowance is 10 pieces: nothing to charge.
    await batches.updateBatch(env.pm, env.batch.id, { rejectTolerancePercent: 10 });
    const loose = (await batchMoney.getCmSettlementScreen(env.pm, env.batch.id)).draft!;
    expect(loose.styles[0]).toMatchObject({
      allowance: 10,
      overAllowance: 0,
      rejectPenalty: "0.00",
    });
    expect(loose.keepC.rejects).toBe("0.00");
    await batches.updateBatch(env.pm, env.batch.id, { rejectTolerancePercent: 2 });
    await expect(
      batches.updateBatch(env.pm, env.batch.id, { rejectTolerancePercent: 120 }),
    ).rejects.toThrow("100 at most");

    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });
    expect([made.payable, made.deducted]).toEqual(["6510.00", "2400.00"]);
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "CM_SETTLEMENT", sourceId: made.id },
      include: { lines: { include: { account: true }, orderBy: { debit: "desc" } } },
    });
    expect(
      entry.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2), l.memo]),
    ).toEqual([
      ["2100", "2400.00", "0.00", `Deductions on ${made.number}`],
      [
        "4250",
        "0.00",
        "2400.00",
        `Rejects over the 2% allowance taken off on ${made.number}, at the target price`,
      ],
    ]);
    const saved = await batchMoney.getCmSettlementScreen(env.accounts, env.batch.id);
    expect(saved.standing!.snapshot).toMatchObject({
      rejectAllowancePercent: "2",
      totals: { rejects: "2400.00", payable: "6510.00" },
    });
    // The batch summary: 17,500 of fabric over 92 good pieces; 2,400 taken back from the factory.
    const summary = await batchSummary.getBatchSummary(env.accounts, env.batch.id);
    expect(summary.pieces).toMatchObject({ cut: 100, a: 89, b: 3, reject: 7, good: 92 });
    expect(summary.money).toEqual({
      totalCost: "17500.00",
      perPiece: "190.22",
      targetPrice: "480.00",
      recovered: "2400.00",
      netCost: "15100.00",
      netPerPiece: "164.13",
    });
    expect(summary.spent).toEqual([
      expect.objectContaining({ kind: "MATERIAL", quantity: "25", amount: "17500.00" }),
    ]);
    expect(summary.penalties.cm.saved?.number).toBe(made.number);
    expect(summary.penalties.cm.overAllowance).toEqual([
      expect.objectContaining({ over: 5, allowance: 2, amount: "2400.00" }),
    ]);
    await expect(batchSummary.getBatchSummary(env.store, env.batch.id)).rejects.toThrow(
      "permission",
    );
    const summaryDoc = batchSummary.batchSummaryDocument(env.accounts, summary);
    expect(summaryDoc.title).toBe("Batch summary");
    // The bill PDF lists the rejects over the allowance.
    const doc = batchMoney.cmSettlementDocument(env.accounts, saved.standing!);
    const deductions = doc.blocks.find((b) => b.kind === "table" && b.title === "Deductions");
    expect(JSON.stringify(deductions)).toContain("Rejects over the 2% allowance");
  });

  it("reads a settlement saved before the reject allowance", async () => {
    await finishing.createFinishingCount(env.store, env.polo.id, {
      lines: [{ colorName: "Navy", sizeName: "S", a: 50, b: 0, c: 0, reject: 0 }],
    });
    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });
    // As an older settlement kept it: no allowance, no reject figures.
    const row = await prisma.cmSettlement.findUniqueOrThrow({ where: { id: made.id } });
    const old = JSON.parse(JSON.stringify(row.snapshot)) as Record<string, unknown> & {
      styles: Array<Record<string, unknown>>;
      totals: Record<string, unknown>;
      warnings: Record<string, unknown>;
    };
    delete old.rejectAllowancePercent;
    delete old.totals.rejects;
    delete old.warnings.noTarget;
    for (const st of old.styles) {
      for (const key of [
        "cut",
        "allowance",
        "overAllowance",
        "targetPrice",
        "rejectPenalty",
        "cmPerDozen",
      ]) {
        delete st[key];
      }
    }
    await prisma.cmSettlement.update({
      where: { id: made.id },
      data: { snapshot: old as Prisma.InputJsonValue },
    });
    const screen = await batchMoney.getCmSettlementScreen(env.accounts, env.batch.id);
    expect(screen.standing!.snapshot).toMatchObject({
      rejectAllowancePercent: null,
      totals: { rejects: "0.00", payable: "4500.00" },
    });
    expect(screen.standing!.snapshot.styles[0]).toMatchObject({
      allowance: null,
      overAllowance: 0,
      rejectPenalty: "0.00",
      // Saved before the CM could be agreed per dozen: per piece, printed as before.
      cmPerDozen: null,
      cmRate: "90.00",
    });
    const doc = batchMoney.cmSettlementDocument(env.accounts, screen.standing!);
    const table = doc.blocks[0]!;
    expect(table.kind === "table" && table.columns[1]!.label).toBe("CM a piece");
    expect(table.kind === "table" && table.rows[0]!.cells[1]).toBe("90.00");
  });

  it("keeps a fault the CM settlement took off until that settlement is undone", async () => {
    await finishing.createFinishingCount(env.store, env.polo.id, {
      lines: [{ colorName: "Navy", sizeName: "S", a: 50, b: 0, c: 0, reject: 0 }],
    });
    const fault = await faults.createFault(env.pm, {
      supplierId: env.factory.id,
      kind: "FABRIC_FAULT",
      projectId: env.polo.id,
      amount: 100,
      note: "Holes in two panels",
    });
    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });
    const settled = await due(env.factory.id);
    // The 100 is in the settlement's entry: waiving or reopening the fault on its
    // own would leave it off the factory's Supplier Due for good.
    for (const change of [
      { status: "WAIVED", note: "Agreed to let go" },
      { status: "OPEN" },
    ] as const) {
      await expect(faults.settleFault(env.accounts, fault.id, change)).rejects.toThrow(
        `Taken off the CM on ${made.number}; undo that settlement to change it.`,
      );
    }
    const kept = await prisma.supplierFault.findUniqueOrThrow({ where: { id: fault.id } });
    expect([kept.status, kept.cmSettlementId]).toEqual(["DEDUCTED", made.id]);
    expect(await due(env.factory.id)).toBe(settled);
    // The log says which settlement holds it, so the screen offers no buttons.
    const log = await faults.listFaults(env.accounts, {});
    expect(log.items.find((f) => f.id === fault.id)?.cmSettlement).toBe(made.number);

    // Undone, the fault is open and changeable again.
    await batchMoney.undoCmSettlement(env.accounts, made.id, { reason: "Wrong count" });
    const reopened = await faults.listFaults(env.accounts, {});
    expect(reopened.items.find((f) => f.id === fault.id)).toMatchObject({
      status: "OPEN",
      cmSettlement: null,
    });
    await faults.settleFault(env.accounts, fault.id, { status: "WAIVED", note: "Agreed" });
    expect((await prisma.supplierFault.findUniqueOrThrow({ where: { id: fault.id } })).status).toBe(
      "WAIVED",
    );
  });
});
