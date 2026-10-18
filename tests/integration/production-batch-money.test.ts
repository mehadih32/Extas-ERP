import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * A master batch's money: Cost Setup (a batch cost split equally among its
 * open styles, or on one), advances paid to the factory for the batch (they
 * settle its styles' bills first), and the final CM settlement:
 *   Total CM - Deductions - Advance taken = Final payable.
 * Its deductions come off the factory's Supplier Due at once (the batch's bills first).
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import { getPartyBalance } from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as actionLog from "@/modules/production/action-log.service";
import * as batchMoney from "@/modules/production/batch-money.service";
import * as batches from "@/modules/production/batch.service";
import * as contracts from "@/modules/production/contract.service";
import * as costs from "@/modules/production/cost.service";
import * as cutting from "@/modules/production/cutting.service";
import * as faults from "@/modules/production/fault.service";
import * as finishing from "@/modules/production/finishing.service";
import * as projects from "@/modules/production/project.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const ROLES = {
  owner: "SUPER_ADMIN",
  production: "PRODUCTION_MANAGER",
  accounts: "ACCOUNTS",
  store: "WAREHOUSE_TEAM",
} as const;
type Who = keyof typeof ROLES;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

/**
 * A master batch at a factory with two styles of a polo (20 and 10 pieces), a
 * 1,800 CM bill on the first, and all its pieces cut.
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
  const { party: factory } = await parties.createParty(owner, {
    kind: "SUPPLIER",
    name: "Gazipur Knit Factory",
  });
  const batch = await batches.createBatch(pm, {
    name: "Winter 2030",
    factoryId: factory.id,
    targetDate: "2030-12-20",
  });
  const polo = await projects.createProject(pm, {
    name: "Brand A polo",
    batchId: batch.id,
    factoryId: factory.id,
    targetDate: "2030-12-20",
    targets: [
      { variantId: sku("S"), quantity: 10 },
      { variantId: sku("M"), quantity: 10 },
    ],
  });
  const second = await projects.createProject(pm, {
    name: "Brand B polo",
    batchId: batch.id,
    factoryId: factory.id,
    targetDate: "2030-12-20",
    targets: [{ variantId: sku("S"), quantity: 10 }],
  });
  await costs.ensureProductionCostHeads(company.id);
  const head = (name: string) =>
    prisma.expenseHead.findFirstOrThrow({ where: { companyId: company.id, name } });
  const sewing = await head("Sewing (CM)");
  await costs.addProjectCost(pm, polo.id, {
    expenseHeadId: sewing.id,
    amount: 1800,
    paymentType: "DUE",
    supplierId: factory.id,
  });
  await cutting.createCuttingReport(pm, polo.id, {
    lines: [
      { colorName: "Navy", sizeName: "S", quantity: 10 },
      { colorName: "Navy", sizeName: "M", quantity: 10 },
    ],
  });
  const qc = await costs.createCostHead(pm, { name: "QC visits" });
  return {
    company,
    owner,
    pm,
    accounts,
    store,
    factory,
    batch,
    polo,
    second,
    sewing,
    qc,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

run("Production renovation: batch costs, advance CM and the final CM settlement", () => {
  let env: Env;

  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("splits a batch cost equally to the cent, as one Due bill or paid now per style", async () => {
    const due = await costs.addBatchCost(env.pm, env.batch.id, {
      expenseHeadId: env.qc.id,
      amount: 100.01,
      paymentType: "DUE",
      supplierId: env.factory.id,
      split: "EQUAL",
      description: "QC visit",
    });
    expect(due.shares.map((s) => [s.code, s.amount])).toEqual([
      [env.polo.code, "50.01"],
      [env.second.code, "50.00"],
    ]);
    const bill = await prisma.supplierBill.findFirstOrThrow({
      where: { allocations: { some: { expenseHeadId: env.qc.id } } },
      include: { allocations: true },
    });
    expect(bill.totalAmount.toFixed(2)).toBe("100.01");
    expect(bill.allocations.map((a) => a.amount.toFixed(2)).sort()).toEqual(["50.00", "50.01"]);
    const second = await prisma.productionProject.findUniqueOrThrow({
      where: { id: env.second.id },
    });
    expect(second.totalCost.toFixed(2)).toBe("50.00");

    // Paid now is for Accounts; on one style it all goes there.
    await expectAppError(
      costs.addBatchCost(env.pm, env.batch.id, {
        expenseHeadId: env.qc.id,
        amount: 90,
        paymentType: "CASH_BANK",
        split: "EQUAL",
      }),
      "FORBIDDEN",
    );
    const paid = await costs.addBatchCost(env.accounts, env.batch.id, {
      expenseHeadId: env.qc.id,
      amount: 90,
      paymentType: "CASH_BANK",
      split: "ONE",
      projectId: env.second.id,
    });
    expect(paid.shares).toEqual([{ id: env.second.id, code: env.second.code, amount: "90.00" }]);
    const expenses = await prisma.expense.findMany({ where: { headId: env.qc.id } });
    expect(expenses.map((e) => [e.projectId, e.amount.toFixed(2)])).toEqual([
      [env.second.id, "90.00"],
    ]);
    await expect(
      costs.addBatchCost(env.pm, env.batch.id, {
        expenseHeadId: env.qc.id,
        amount: 10,
        paymentType: "DUE",
        supplierId: env.factory.id,
        split: "ONE",
      }),
    ).rejects.toThrow();

    // A closed style takes no share: the next split goes to the open one only.
    await prisma.productionProject.update({
      where: { id: env.second.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    const one = await costs.addBatchCost(env.pm, env.batch.id, {
      expenseHeadId: env.qc.id,
      amount: 40,
      paymentType: "DUE",
      supplierId: env.factory.id,
      split: "EQUAL",
    });
    expect(one.shares.map((s) => s.code)).toEqual([env.polo.code]);
    const log = await actionLog.getActionLog(env.pm, { batchId: env.batch.id });
    expect(
      log.rows.some((r) => /Cost Setup: 100\.01 QC visits split equally/.test(r.summary)),
    ).toBe(true);
  });

  it("pays an advance for the batch that settles its styles' bills first", async () => {
    // An older bill from the same factory on a style outside the batch.
    const other = await projects.createProject(env.pm, {
      name: "Old order",
      factoryId: env.factory.id,
      targetDate: "2030-12-20",
      targetQuantity: 10,
    });
    await costs.addProjectCost(env.pm, other.id, {
      expenseHeadId: env.sewing.id,
      amount: 500,
      paymentType: "DUE",
      supplierId: env.factory.id,
      date: "2026-01-05",
    });
    const billOf = async (projectId: string) =>
      prisma.supplierBill.findFirstOrThrow({
        where: { allocations: { some: { projectId } } },
      });

    await expectAppError(
      batchMoney.payForBatch(env.pm, env.batch.id, { amount: 1000 }),
      "FORBIDDEN",
    );
    const paid = await batchMoney.payForBatch(env.accounts, env.batch.id, { amount: 1000 });
    expect(paid.supplier?.name).toBe("Gazipur Knit Factory");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paid.id } });
    expect([payment.batchId, payment.projectId, payment.notes]).toEqual([
      env.batch.id,
      null,
      `Advance CM for ${env.batch.code}`,
    ]);
    // The batch's bill is paid first although the other one is older.
    expect((await billOf(env.polo.id)).paidAmount.toFixed(2)).toBe("1000.00");
    expect((await billOf(other.id)).paidAmount.toFixed(2)).toBe("0.00");

    // What the batch does not need joins the rest, oldest first.
    await batchMoney.payForBatch(env.accounts, env.batch.id, { amount: 1000 });
    expect((await billOf(env.polo.id)).status).toBe("PAID");
    expect((await billOf(other.id)).paidAmount.toFixed(2)).toBe("200.00");

    const money = await batchMoney.getBatchMoney(env.pm, env.batch.id);
    expect([money.advanceTotal, money.advances.length]).toEqual(["2000.00", 2]);
    expect(money.can).toEqual({ pay: false, settle: true });
    await expectAppError(batchMoney.getBatchMoney(env.store, env.batch.id), "FORBIDDEN");

    // Accessories run on one continuous ledger, never by batch.
    const { party: trims } = await parties.createParty(env.owner, {
      kind: "SUPPLIER",
      name: "Trims House",
      supplierCategories: ["ACCESSORIES"],
    });
    await expectAppError(
      batchMoney.payForBatch(env.accounts, env.batch.id, { supplierId: trims.id, amount: 100 }),
      "VALIDATION",
    );
  });

  it("settles a CM agreed per dozen at its twelfth a piece, and its deductions on the Supplier Due", async () => {
    const agreement = await contracts.createContract(env.pm, env.batch.id, {
      kind: "FACTORY_CM",
      partyId: env.factory.id,
    });
    const { clauses } = (await contracts.getContractScreen(env.pm, agreement.id)).contract;
    await contracts.updateContract(env.pm, agreement.id, {
      clauses,
      cmRates: [{ projectId: env.polo.id, cmRate: 120, cmPer: "DOZEN" }],
    });
    await finishing.createFinishingCount(env.store, env.polo.id, {
      lines: [
        { colorName: "Navy", sizeName: "S", a: 8, b: 1, c: 1, reject: 0 },
        { colorName: "Navy", sizeName: "M", a: 10, b: 0, c: 0, reject: 0 },
      ],
    });
    const draft = (await batchMoney.getCmSettlementScreen(env.pm, env.batch.id)).draft!;
    // 120 a dozen = 10 a piece: 20 pieces earn 200, the C-grade piece 10.
    expect(draft.styles[0]).toMatchObject({
      pieces: 20,
      cmRate: "10.00",
      cmPerDozen: "120.00",
      cm: "200.00",
      cGradeCm: "10.00",
    });
    expect(draft.keepC).toMatchObject({ totalCm: "200.00", payable: "200.00" });
    expect(draft.deductC).toMatchObject({ deductions: "10.00", payable: "190.00" });

    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: true });
    expect([made.payable, made.deducted]).toEqual(["190.00", "10.00"]);
    // The 1,800 bill less the C-grade CM taken off.
    expect((await getPartyBalance(env.accounts, env.factory.id)).neg().toFixed(2)).toBe("1790.00");
    const settled = await batchMoney.getCmSettlementScreen(env.accounts, env.batch.id);
    const pdf = batchMoney.cmSettlementDocument(env.accounts, settled.standing!);
    const table = pdf.blocks[0]!;
    expect(table.kind === "table" && table.columns[1]!.label).toBe("CM agreed");
    expect(table.kind === "table" && table.rows[0]!.cells.slice(0, 2)).toEqual([
      env.polo.code,
      "120.00 a dozen",
    ]);
  });

  it("settles the CM: total CM - deductions - advance taken = final payable", async () => {
    await prisma.productionProject.update({ where: { id: env.polo.id }, data: { cmRate: 90 } });
    // S: 6 A, 2 B, 1 C; M: 7 A, 1 B, 1 reject; 2 missing at the packing list (112.50 each).
    await finishing.createFinishingCount(env.store, env.polo.id, {
      lines: [
        { colorName: "Navy", sizeName: "S", a: 6, b: 2, c: 1, reject: 0 },
        { colorName: "Navy", sizeName: "M", a: 7, b: 1, c: 0, reject: 1 },
      ],
    });
    await finishing.receivePackingList(env.pm, env.polo.id, {
      missing: [
        { colorName: "Navy", sizeName: "S", quantity: 1 },
        { colorName: "Navy", sizeName: "M", quantity: 1 },
      ],
    });
    await faults.createFault(env.pm, {
      supplierId: env.factory.id,
      kind: "FABRIC_FAULT",
      projectId: env.polo.id,
      amount: 100,
      note: "Holes in two panels",
    });
    const toAgree = await faults.createFault(env.pm, {
      supplierId: env.factory.id,
      kind: "QUALITY",
      batchId: env.batch.id,
      note: "Uneven hems, value to agree",
    });
    const { party: fabric } = await parties.createParty(env.owner, {
      kind: "SUPPLIER",
      name: "Fabric Mills",
    });
    await faults.createFault(env.pm, {
      supplierId: fabric.id,
      kind: "FABRIC_FAULT",
      batchId: env.batch.id,
      amount: 999,
      note: "Not the factory's",
    });
    await batchMoney.payForBatch(env.accounts, env.batch.id, { amount: 500 });
    // An older bill from the same factory on a style outside the batch.
    const other = await projects.createProject(env.pm, {
      name: "Old order",
      factoryId: env.factory.id,
      targetDate: "2030-12-20",
      targetQuantity: 10,
    });
    await costs.addProjectCost(env.pm, other.id, {
      expenseHeadId: env.sewing.id,
      amount: 500,
      paymentType: "DUE",
      supplierId: env.factory.id,
      date: "2026-01-05",
    });
    const billOf = async (projectId: string) =>
      prisma.supplierBill.findFirstOrThrow({ where: { allocations: { some: { projectId } } } });
    /** What we owe the factory (their Supplier Due). */
    const supplierDue = async () =>
      (await getPartyBalance(env.accounts, env.factory.id)).neg().toFixed(2);
    expect(await supplierDue()).toBe("1800.00");

    const screen = await batchMoney.getCmSettlementScreen(env.pm, env.batch.id);
    const draft = screen.draft!;
    expect(draft.styles.map((s) => [s.code, s.a, s.b, s.c, s.reject, s.pieces, s.cm])).toEqual([
      [env.polo.code, 13, 3, 1, 1, 18, "1620.00"],
      [env.second.code, 0, 0, 0, 0, 0, null],
    ]);
    expect(draft.faults.map((f) => [f.kind, f.amount])).toEqual([
      ["MISSING_PIECES", "225.00"],
      ["FABRIC_FAULT", "100.00"],
      ["QUALITY", null],
    ]);
    expect(draft.keepC).toMatchObject({
      totalCm: "1620.00",
      deductions: "325.00",
      paid: "500.00",
      payable: "795.00",
    });
    expect(draft.deductC).toMatchObject({
      cGradeCm: "90.00",
      deductions: "415.00",
      payable: "705.00",
    });
    expect(screen.can).toMatchObject({ settle: true, undo: false });
    await expectAppError(batchMoney.getCmSettlementScreen(env.store, env.batch.id), "FORBIDDEN");
    await expectAppError(
      batchMoney.settleCm(env.store, env.batch.id, { deductCGrade: false }),
      "FORBIDDEN",
    );

    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: true });
    expect(made.number).toMatch(/^CMS-\d{4}-\d{5}$/);
    expect([made.payable, made.faults, made.deducted]).toEqual(["705.00", 2, "415.00"]);

    // The 415 of deductions came off the factory's Supplier Due at once: one entry,
    // Dr Accounts Payable (the factory), Cr Deductions from Suppliers.
    expect(await supplierDue()).toBe("1385.00");
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "CM_SETTLEMENT", sourceId: made.id },
      include: { lines: { include: { account: true }, orderBy: { debit: "desc" } } },
    });
    expect(entry.number).toBe(made.entry);
    expect(
      entry.lines.map((l) => [l.account.code, l.partyId, l.debit.toFixed(2), l.credit.toFixed(2)]),
    ).toEqual([
      ["2100", env.factory.id, "415.00", "0.00"],
      ["4250", null, "0.00", "325.00"],
      ["4250", null, "0.00", "90.00"],
    ]);
    expect(entry.lines[1]!.account.name).toBe("Deductions from Suppliers");
    // It settles the batch's bill first, though the other one is older.
    expect((await billOf(env.polo.id)).paidAmount.toFixed(2)).toBe("915.00");
    expect((await billOf(other.id)).paidAmount.toFixed(2)).toBe("0.00");
    await expectAppError(
      batchMoney.settleCm(env.accounts, env.batch.id, { deductCGrade: false }),
      "CONFLICT",
    );
    const deducted = await prisma.supplierFault.findMany({
      where: { cmSettlementId: made.id },
      select: { status: true, settledNote: true },
    });
    expect(deducted).toHaveLength(2);
    expect(deducted.every((f) => f.status === "DEDUCTED")).toBe(true);
    expect(deducted[0]!.settledNote).toBe(`Taken off the CM on ${made.number}`);
    expect(
      (await prisma.supplierFault.findUniqueOrThrow({ where: { id: toAgree.id } })).status,
    ).toBe("OPEN");
    expect(
      await prisma.notificationLog.count({ where: { subject: `CM settled: ${env.batch.code}` } }),
    ).toBeGreaterThan(0);

    const settled = await batchMoney.getCmSettlementScreen(env.accounts, env.batch.id);
    expect(settled.draft).toBeNull();
    expect(settled.standing).toMatchObject({
      number: made.number,
      deductCGrade: true,
      deductions: "415.00",
      posted: { id: entry.id, number: entry.number },
      notPosted: false,
    });
    expect(settled.standing!.snapshot.totals.payable).toBe("705.00");
    expect(settled.can.seeJournal).toBe(true);
    const pdf = await batchMoney.cmSettlementPdf(env.accounts, made.id);
    expect(pdf.bytes.subarray(0, 4).toString()).toBe("%PDF");
    expect(pdf.fileName).toContain(made.number);

    // Undone, its faults are open again, its deductions are back on the Supplier Due
    // and the batch can be settled again.
    await batchMoney.undoCmSettlement(env.pm, made.id, { reason: "Counted the wrong carton" });
    expect(await prisma.supplierFault.count({ where: { status: "DEDUCTED" } })).toBe(0);
    expect(await supplierDue()).toBe("1800.00");
    expect(
      (await prisma.journalEntry.findUniqueOrThrow({ where: { id: entry.id } })).isReversed,
    ).toBe(true);
    expect((await billOf(env.polo.id)).paidAmount.toFixed(2)).toBe("500.00");
    await expectAppError(
      batchMoney.undoCmSettlement(env.pm, made.id, { reason: "Again" }),
      "CONFLICT",
    );
    const again = await batchMoney.getCmSettlementScreen(env.pm, env.batch.id);
    expect(again.draft?.keepC.payable).toBe("795.00");
    expect(again.undone.map((u) => u.number)).toEqual([made.number]);

    // Settled again without the C-grade CM: 325 off this time.
    const remade = await batchMoney.settleCm(env.accounts, env.batch.id, { deductCGrade: false });
    expect([remade.payable, remade.deducted]).toEqual(["795.00", "325.00"]);
    expect(await supplierDue()).toBe("1475.00");
    await batchMoney.undoCmSettlement(env.accounts, remade.id, { reason: "Wrong rate" });
    expect(await supplierDue()).toBe("1800.00");
    const log = await actionLog.getActionLog(
      env.pm,
      { batchId: env.batch.id },
      { kind: "CmSettlement" },
    );
    expect(log.rows.map((r) => r.action)).toEqual([
      "Status",
      "Added",
      "Status",
      "Exported",
      "Added",
    ]);
  });

  it("posts nothing when there is nothing to deduct, and flags a settlement saved before", async () => {
    await prisma.productionProject.update({ where: { id: env.polo.id }, data: { cmRate: 90 } });
    await finishing.createFinishingCount(env.store, env.polo.id, {
      lines: [{ colorName: "Navy", sizeName: "S", a: 5, b: 0, c: 0, reject: 0 }],
    });
    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });
    expect([made.deducted, made.entry]).toEqual(["0.00", null]);
    expect(await prisma.journalEntry.count({ where: { sourceType: "CM_SETTLEMENT" } })).toBe(0);
    const screen = await batchMoney.getCmSettlementScreen(env.pm, env.batch.id);
    expect(screen.standing).toMatchObject({ posted: null, notPosted: false });
    await batchMoney.undoCmSettlement(env.pm, made.id, { reason: "Not yet" });

    // One saved before deductions were posted (no entry) asks to be saved again.
    const old = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });
    await prisma.cmSettlement.update({ where: { id: old.id }, data: { deductions: 120 } });
    const flagged = await batchMoney.getCmSettlementScreen(env.pm, env.batch.id);
    expect(flagged.standing).toMatchObject({ posted: null, notPosted: true });
    // Undoing it reverses nothing.
    await batchMoney.undoCmSettlement(env.pm, old.id, { reason: "Save it again" });
    expect(await prisma.journalEntry.count()).toBe(
      await prisma.journalEntry.count({ where: { sourceType: { not: "CM_SETTLEMENT" } } }),
    );
  });

  it("will not settle without a CM rate or a factory", async () => {
    await finishing.createFinishingCount(env.store, env.polo.id, {
      lines: [{ colorName: "Navy", sizeName: "S", a: 5, b: 0, c: 0, reject: 0 }],
    });
    const screen = await batchMoney.getCmSettlementScreen(env.pm, env.batch.id);
    expect(screen.draft!.warnings.noRate).toEqual([env.polo.code]);
    expect(screen.can.settle).toBe(false);
    await expectAppError(
      batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false }),
      "VALIDATION",
    );
    await prisma.productionBatch.update({ where: { id: env.batch.id }, data: { factoryId: null } });
    await expectAppError(
      batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false }),
      "VALIDATION",
    );
  });
});
