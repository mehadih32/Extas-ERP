import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4.2, the owner's Part 1 (money):
 *   1. Faults about material the factory supplied (a short at receive is already
 *      off its material bill) never come off the CM again; they are shown left
 *      out, with why. Only faults of the CM work come off.
 *   2. CM paid counts only what of the payments for the batch and its styles did
 *      not pay the factory's material bills.
 *   3. Rejects over the allowance of a style with no target price are never
 *      charged at 0: the price per reject is entered and saved with the settlement.
 *   4. While a settlement stands, its styles' cutting reports, finishing counts,
 *      mending returns and CM stay: "Undo the CM settlement first".
 *   5. A CM saved without saying per piece or per dozen keeps the style's way.
 *   8. After the update Bug Guard lists, read-only, the saved settlements that
 *      would come out different and the open bookings for one style a fabric
 *      change will not mark red, in the owner's inbox.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readOnly } from "@/lib/read-only";
import { cmRulesReview, reportCmRulesReview, reviewText } from "@/modules/bug-guard/cm-review";
import * as supplierPayments from "@/modules/accounts/supplier-payment.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import * as purchaseOrders from "@/modules/materials/purchase-order.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as parties from "@/modules/parties/party.service";
import * as batchMoney from "@/modules/production/batch-money.service";
import * as batches from "@/modules/production/batch.service";
import * as bookings from "@/modules/production/booking.service";
import * as contracts from "@/modules/production/contract.service";
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
 * A batch at a factory that also sells fabric (rib), with one polo (Navy S 50,
 * M 50, target price 480, CM 90 a piece, all 100 pieces cut). Its rib was
 * booked from the factory for the batch: 10 kg at 500 on the challan, 9 kg came,
 * so a 500.00 short is in the factory's fault log and its bill is for the 9 kg.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const people = {} as Record<Who, { id: string }>;
  for (const [who, role] of Object.entries(ROLES) as Array<[Who, keyof typeof roles]>) {
    const user = await makeUser(`${who}@extras.test`, { isSuperAdmin: who === "owner" });
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
    supplierCategories: ["CM", "FABRIC"],
  });
  const rib = await materials.createMaterial(pm, {
    name: "Rib 1x1",
    kind: "FABRIC",
    unit: "KG",
    supplierId: factory.id,
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
    needs: [{ materialId: rib.id, perPiece: 0.1, split: "COLOUR", placement: "Collar" }],
  });
  const booked = await bookings.createBooking(pm, {
    source: "SUPPLIER_PO",
    category: "KNITWEAR",
    supplierId: factory.id,
    batchId: batch.id,
    expectedDate: "2030-11-15",
    lines: [{ materialId: rib.id, quantity: 10, unitPrice: 500 }],
  });
  await bookings.approveBooking(owner, booked.id);
  const order = await prisma.purchaseOrder.findFirstOrThrow({ where: { id: booked.orderId } });
  const screen = await receive.getBatchReceive(pm, batch.id, order.id);
  const received = await receive.receiveBatchDelivery(pm, batch.id, {
    orderId: order.id,
    lines: screen.order!.lines.map((l) => ({ lineId: l.id, challanQuantity: 10, quantity: 9 })),
  });
  await cutting.createCuttingReport(pm, polo.id, {
    lines: [
      { colorName: "Navy", sizeName: "S", quantity: 50 },
      { colorName: "Navy", sizeName: "M", quantity: 50 },
    ],
  });
  return { company, owner, pm, accounts, store, factory, rib, batch, polo, received };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Every piece counted A: 100 pieces at 90 is 9,000 of CM, nothing over the allowance. */
const allGood = (env: Env) =>
  finishing.createFinishingCount(env.store, env.polo.id, {
    lines: [
      { colorName: "Navy", sizeName: "S", a: 50, b: 0, c: 0, reject: 0 },
      { colorName: "Navy", sizeName: "M", a: 50, b: 0, c: 0, reject: 0 },
    ],
  });

run("v6.4.2: the CM settlement's money rules", () => {
  let env: Env;

  beforeEach(async () => {
    await resetDb();
    env = await setup();
  });

  it("never charges again a short the factory's material bill already left off, and shows why", async () => {
    const short = await prisma.supplierFault.findFirstOrThrow({
      where: { supplierId: env.factory.id, kind: "SHORT_RECEIVE" },
      include: { bill: true },
    });
    // The bill is for the 9 kg that came; the 1 kg short is in the fault log at 500.
    expect([short.amount?.toFixed(2), short.bill?.totalAmount.toFixed(2)]).toEqual([
      "500.00",
      "4500.00",
    ]);
    await faults.createFault(env.pm, {
      supplierId: env.factory.id,
      kind: "FABRIC_FAULT",
      projectId: env.polo.id,
      materialId: env.rib.id,
      amount: 200,
      note: "Holes in two rib rolls",
    });
    const quality = await faults.createFault(env.pm, {
      supplierId: env.factory.id,
      kind: "QUALITY",
      projectId: env.polo.id,
      amount: 100,
      note: "Open seams on two pieces",
    });
    // Our own body fabric (the factory never sold it): holes found at cutting
    // are the factory's to answer for, so they still come off the CM.
    const jersey = await materials.createMaterial(env.pm, {
      name: "Single Jersey",
      kind: "FABRIC",
      unit: "KG",
    });
    const ourFabric = await faults.createFault(env.pm, {
      supplierId: env.factory.id,
      kind: "FABRIC_FAULT",
      projectId: env.polo.id,
      materialId: jersey.id,
      amount: 150,
      note: "Holes in two panels",
    });
    const noMaterial = await faults.createFault(env.pm, {
      supplierId: env.factory.id,
      kind: "FABRIC_FAULT",
      projectId: env.polo.id,
      amount: 100,
      note: "Holes in two panels",
    });
    await allGood(env);

    const draft = (await batchMoney.getCmSettlementScreen(env.pm, env.batch.id)).draft!;
    expect(draft.faults.map((f) => [f.number, f.amount])).toEqual([
      [quality.number, "100.00"],
      [ourFabric.number, "150.00"],
      [noMaterial.number, "100.00"],
    ]);
    expect(draft.leftOut.map((f) => [f.kind, f.amount])).toEqual([
      ["SHORT_RECEIVE", "500.00"],
      ["FABRIC_FAULT", "200.00"],
    ]);
    expect(draft.leftOut[0]!.why).toBe(
      `Short at receive: already left off its material bill ${short.bill!.number}, so it is not charged again`,
    );
    expect(draft.leftOut[1]!.why).toContain("the Rib 1x1");
    expect(draft.leftOut[1]!.why).toContain("not the CM work");
    expect(draft.keepC).toMatchObject({ totalCm: "9000.00", deductions: "350.00" });

    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });
    expect([made.deducted, made.faults, made.payable]).toEqual(["350.00", 3, "8650.00"]);
    // The short stays open in the fault log: it was never the CM's.
    expect((await prisma.supplierFault.findUniqueOrThrow({ where: { id: short.id } })).status).toBe(
      "OPEN",
    );
    const saved = await batchMoney.getCmSettlementScreen(env.accounts, env.batch.id);
    expect(saved.standing!.snapshot.leftOut).toHaveLength(2);
    const doc = batchMoney.cmSettlementDocument(env.accounts, saved.standing!);
    const left = doc.blocks.find(
      (b) => b.kind === "table" && b.title === "Left out: not the CM work",
    );
    expect(JSON.stringify(left)).toContain(short.number);
  });

  it("counts as CM paid only what did not pay the factory's material bills", async () => {
    // Rib bought from the factory for the polo: a 3,000 material bill of the style.
    const po = await purchaseOrders.createPurchaseOrder(env.pm, {
      supplierId: env.factory.id,
      projectId: env.polo.id,
      lines: [{ materialId: env.rib.id, quantity: 6, unitPrice: 500 }],
    });
    const bill = await purchases.createPurchase(env.pm, {
      purchaseOrderId: po.id,
      paymentType: "DUE",
      items: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: 6 }],
    });
    // 5,000 paid for the polo (its bill takes 3,000 first) and a 1,000 advance CM.
    const forStyle = await supplierPayments.paySupplier(env.accounts, {
      supplierId: env.factory.id,
      projectId: env.polo.id,
      amount: 5000,
      method: "CASH",
    });
    await batchMoney.payForBatch(env.accounts, env.batch.id, { amount: 1000 });
    expect((await prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.id } })).status).toBe(
      "PAID",
    );
    await allGood(env);

    const draft = (await batchMoney.getCmSettlementScreen(env.pm, env.batch.id)).draft!;
    expect(
      draft.payments.map((p) => [p.style?.code ?? "advance", p.amount, p.forBills, p.cm]),
    ).toEqual([
      [env.polo.code, "5000.00", "3000.00", "2000.00"],
      ["advance", "1000.00", "0.00", "1000.00"],
    ]);
    expect(draft.keepC).toMatchObject({
      advance: "1000.00",
      paidForStyles: "2000.00",
      paidOnBills: "3000.00",
      paid: "3000.00",
      payable: "6000.00",
    });
    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });
    expect(made.payable).toBe("6000.00");
    const saved = await batchMoney.getCmSettlementScreen(env.accounts, env.batch.id);
    const doc = batchMoney.cmSettlementDocument(env.accounts, saved.standing!);
    const paid = doc.blocks.find((b) => b.kind === "table" && b.title === "Advance taken and paid");
    expect(JSON.stringify(paid)).toContain("of it paid the factory's material bills");
    expect(forStyle.number).toBeTruthy();
  });

  it("asks the price per reject of a style with no target price and never saves rejects at 0", async () => {
    await prisma.productionProject.update({
      where: { id: env.polo.id },
      data: { targetUnitCost: null },
    });
    // 7 rejects of 100 cut: the 2% allowance is 2, so 5 are over.
    await finishing.createFinishingCount(env.store, env.polo.id, {
      lines: [
        { colorName: "Navy", sizeName: "S", a: 45, b: 2, c: 0, reject: 3 },
        { colorName: "Navy", sizeName: "M", a: 45, b: 1, c: 0, reject: 4 },
      ],
    });
    const screen = await batchMoney.getCmSettlementScreen(env.pm, env.batch.id);
    expect(screen.draft!.warnings.noTarget).toEqual([env.polo.code]);
    expect(screen.draft!.styles[0]).toMatchObject({
      overAllowance: 5,
      targetPrice: null,
      rejectPrice: null,
      rejectPenalty: "0.00",
    });
    expect(screen.can.settle).toBe(true);

    const refused = await expectAppError(
      batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false }),
      "VALIDATION",
    );
    expect(refused.message).toContain("Enter the price per reject");
    expect(refused.details).toEqual({
      [`rejectPrices.${env.polo.id}`]: ["Enter the price per reject"],
    });
    await expect(
      batchMoney.settleCm(env.pm, env.batch.id, {
        deductCGrade: false,
        rejectPrices: [{ projectId: env.polo.id, price: 0 }],
      }),
    ).rejects.toThrow();
    // A target price of 0 is no price either.
    await prisma.productionProject.update({
      where: { id: env.polo.id },
      data: { targetUnitCost: 0 },
    });
    await expectAppError(
      batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false }),
      "VALIDATION",
    );
    expect(await prisma.cmSettlement.count()).toBe(0);

    const made = await batchMoney.settleCm(env.pm, env.batch.id, {
      deductCGrade: false,
      rejectPrices: [{ projectId: env.polo.id, price: 300 }],
    });
    // 5 over at 300: 1,500 off the factory's Supplier Due.
    expect(made.deducted).toBe("1500.00");
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: { sourceType: "CM_SETTLEMENT", sourceId: made.id },
      include: { lines: true },
    });
    expect(entry.lines.find((l) => l.credit.gt(0))!.memo).toContain("or the price per reject");
    const saved = await batchMoney.getCmSettlementScreen(env.accounts, env.batch.id);
    expect(saved.standing!.snapshot.styles[0]).toMatchObject({
      rejectPrice: "300.00",
      rejectPriceEntered: true,
      rejectPenalty: "1500.00",
    });
    expect(saved.standing!.snapshot.totals.rejects).toBe("1500.00");
    const doc = batchMoney.cmSettlementDocument(env.accounts, saved.standing!);
    expect(JSON.stringify(doc.blocks)).toContain("a piece (price per reject)");
  });

  it("keeps the cutting, finishing and CM a saved settlement stands on until it is undone", async () => {
    await finishing.createFinishingCount(env.store, env.polo.id, {
      lines: [
        { colorName: "Navy", sizeName: "S", a: 48, b: 0, c: 2, reject: 0 },
        { colorName: "Navy", sizeName: "M", a: 50, b: 0, c: 0, reject: 0 },
      ],
    });
    const mended = await finishing.backFromMending(env.store, env.polo.id, {
      lines: [{ colorName: "Navy", sizeName: "S", a: 1, b: 0, reject: 0 }],
    });
    const agreement = await contracts.createContract(env.pm, env.batch.id, {
      kind: "FACTORY_CM",
      partyId: env.factory.id,
    });
    const { clauses } = (await contracts.getContractScreen(env.pm, agreement.id)).contract;
    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });

    const cut = await cutting.getCuttingScreen(env.pm, env.polo.id);
    expect(cut.cmSettlement).toMatchObject({ number: made.number, batchId: env.batch.id });
    const fin = await finishing.getFinishingScreen(env.pm, env.polo.id);
    expect(fin.cmSettlement?.number).toBe(made.number);
    const first = `Undo the CM settlement first: ${made.number} for ${env.batch.code}`;
    const noCut = await expectAppError(
      cutting.deleteCuttingReport(env.pm, cut.reports[0]!.id),
      "CONFLICT",
    );
    expect(noCut.message).toContain(first);
    const noMend = await expectAppError(
      finishing.deleteFinishingReport(env.store, mended.id),
      "CONFLICT",
    );
    expect(noMend.message).toContain(first);
    const count = fin.reports.find((r) => r.kind === "COUNT")!;
    await expectAppError(finishing.deleteFinishingReport(env.store, count.id), "CONFLICT");
    const noCm = await expectAppError(
      contracts.updateContract(env.pm, agreement.id, {
        clauses,
        cmRates: [{ projectId: env.polo.id, cmRate: 95 }],
      }),
      "CONFLICT",
    );
    expect(noCm.message).toContain(first);
    expect(noCm.details).toEqual({ "cmRates.0.cmRate": ["Undo the CM settlement first"] });
    // The same CM saved again is no change.
    await contracts.updateContract(env.pm, agreement.id, {
      clauses,
      cmRates: [{ projectId: env.polo.id, cmRate: 90 }],
    });
    const screen = await contracts.getContractScreen(env.pm, agreement.id);
    expect(screen.styles![0]!.cmSettlement?.number).toBe(made.number);
    expect(await prisma.finishingReport.count({ where: { id: mended.id } })).toBe(1);

    // Undone, they can change again.
    await batchMoney.undoCmSettlement(env.pm, made.id, { reason: "Mending entered twice" });
    expect((await cutting.getCuttingScreen(env.pm, env.polo.id)).cmSettlement).toBeNull();
    await finishing.deleteFinishingReport(env.store, mended.id);
    await contracts.updateContract(env.pm, agreement.id, {
      clauses,
      cmRates: [{ projectId: env.polo.id, cmRate: 95 }],
    });
    const polo = await prisma.productionProject.findUniqueOrThrow({ where: { id: env.polo.id } });
    expect(polo.cmRate?.toFixed(2)).toBe("95.00");
  });

  it("keeps a style's CM per dozen when the request leaves out how it is agreed", async () => {
    const agreement = await contracts.createContract(env.pm, env.batch.id, {
      kind: "FACTORY_CM",
      partyId: env.factory.id,
    });
    const { clauses } = (await contracts.getContractScreen(env.pm, agreement.id)).contract;
    await contracts.updateContract(env.pm, agreement.id, {
      clauses,
      cmRates: [{ projectId: env.polo.id, cmRate: 120, cmPer: "DOZEN" }],
    });
    await contracts.updateContract(env.pm, agreement.id, {
      clauses,
      cmRates: [{ projectId: env.polo.id, cmRate: 144 }],
    });
    const polo = await prisma.productionProject.findUniqueOrThrow({ where: { id: env.polo.id } });
    expect([polo.cmPer, polo.cmPerDozen?.toFixed(2), polo.cmRate?.toFixed(2)]).toEqual([
      "DOZEN",
      "144.00",
      "12.00",
    ]);
    // Without any CM, the settlement asks for it the way it may be agreed.
    await prisma.productionProject.update({ where: { id: env.polo.id }, data: { cmRate: null } });
    await allGood(env);
    const refused = await expectAppError(
      batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false }),
      "VALIDATION",
    );
    expect(refused.message).toBe(
      `Agree the CM of ${env.polo.code} first (a piece or a dozen), on the factory agreement.`,
    );
  });

  it("lists in the owner's inbox, after the update and only reading, what the new rules see differently", async () => {
    // Nothing saved yet: it says so plainly.
    const empty = reviewText(await cmRulesReview(env.company.id), "BDT");
    expect(empty.body).toContain("No saved CM settlement would come out different");
    expect(empty.body).toContain("No open booking for one style is missed");

    // A settlement saved under the old rules: the short (500) and a fabric fault (200)
    // taken off, the 5,000 for the style all counted though 3,000 paid its rib bill, and
    // rejects over the allowance at 0 for a style with no target price.
    await faults.createFault(env.pm, {
      supplierId: env.factory.id,
      kind: "FABRIC_FAULT",
      projectId: env.polo.id,
      materialId: env.rib.id,
      amount: 200,
      note: "Holes in two rib rolls",
    });
    const po = await purchaseOrders.createPurchaseOrder(env.pm, {
      supplierId: env.factory.id,
      projectId: env.polo.id,
      lines: [{ materialId: env.rib.id, quantity: 6, unitPrice: 500 }],
    });
    await purchases.createPurchase(env.pm, {
      purchaseOrderId: po.id,
      paymentType: "DUE",
      items: [{ purchaseOrderLineId: po.lines[0]!.id, quantity: 6 }],
    });
    await supplierPayments.paySupplier(env.accounts, {
      supplierId: env.factory.id,
      projectId: env.polo.id,
      amount: 5000,
      method: "CASH",
    });
    await allGood(env);
    const made = await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });
    const row = await prisma.cmSettlement.findUniqueOrThrow({ where: { id: made.id } });
    const snap = JSON.parse(JSON.stringify(row.snapshot)) as {
      faults: Array<Record<string, unknown>>;
      leftOut?: Array<Record<string, unknown>>;
      payments: Array<Record<string, unknown>>;
      styles: Array<Record<string, unknown>>;
      totals: Record<string, unknown>;
    };
    // As the old rules saved it.
    snap.faults.push(
      ...snap.leftOut!.map((f) => ({ ...f, quantity: null, note: null, on: "2026-10-01" })),
    );
    delete snap.leftOut;
    for (const p of snap.payments) {
      delete p.forBills;
      delete p.cm;
    }
    // The old code kept a target price of 0 and charged the rejects at it.
    Object.assign(snap.styles[0]!, {
      overAllowance: 3,
      targetPrice: "0.00",
      rejectPenalty: "0.00",
    });
    delete snap.styles[0]!.rejectPrice;
    delete snap.styles[0]!.rejectPriceEntered;
    await prisma.cmSettlement.update({
      where: { id: row.id },
      data: { snapshot: snap as Prisma.InputJsonValue, payable: 3300, deductions: 700 },
    });
    // And an open booking kept for the polo alone (as Materials could set before),
    // approved with no fabric record of it.
    const booked = await bookings.createBooking(env.pm, {
      source: "SUPPLIER_PO",
      category: "KNITWEAR",
      supplierId: env.factory.id,
      expectedDate: "2030-11-20",
      lines: [{ materialId: env.rib.id, quantity: 4, unitPrice: 500 }],
    });
    await bookings.approveBooking(env.owner, booked.id);
    await prisma.purchaseOrder.update({
      where: { id: booked.orderId },
      data: { projectId: env.polo.id },
    });

    const before = {
      settlements: JSON.stringify(await prisma.cmSettlement.findMany({ orderBy: { id: "asc" } })),
      faults: JSON.stringify(await prisma.supplierFault.findMany({ orderBy: { id: "asc" } })),
      entries: await prisma.journalEntry.count(),
    };
    const review = await cmRulesReview(env.company.id);
    expect(review.settlements).toHaveLength(1);
    expect(review.settlements[0]).toMatchObject({
      number: made.number,
      factory: "Gazipur Knit Factory",
      batch: { id: env.batch.id, code: env.batch.code },
      oldPayable: "3300.00",
      // + 700 of faults about the rib + 3,000 that paid the rib bill.
      newPayable: "7000.00",
      oldDeductions: "700.00",
      newDeductions: "0.00",
      paidOnBills: "3000.00",
      needPrice: [{ code: env.polo.code, over: 3 }],
    });
    expect(review.settlements[0]!.leftOut.map((f) => f.amount)).toEqual(["500.00", "200.00"]);
    expect(review.bookings).toEqual([
      expect.objectContaining({
        id: booked.id,
        style: { code: env.polo.code, name: "Ralph Lauren polo" },
      }),
    ]);

    // Sent once, to the owner's inbox only; nothing else changes.
    expect(await reportCmRulesReview(env.company.id)).toBe("SENT");
    expect(await reportCmRulesReview(env.company.id)).toBe("ALREADY");
    const inbox = await prisma.notificationLog.findMany({
      where: { subject: { contains: "to review after the update" } },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.body).toContain(
      `Gazipur Knit Factory, batch ${env.batch.code} (${made.number})`,
    );
    expect(inbox[0]!.body).toContain("under the new rules");
    expect(inbox[0]!.body).toContain("a price per reject is needed");
    expect(inbox[0]!.body).toContain(`for ${env.polo.code} Ralph Lauren polo`);
    expect(JSON.stringify(await prisma.cmSettlement.findMany({ orderBy: { id: "asc" } }))).toBe(
      before.settlements,
    );
    expect(JSON.stringify(await prisma.supplierFault.findMany({ orderBy: { id: "asc" } }))).toBe(
      before.faults,
    );
    expect(await prisma.journalEntry.count()).toBe(before.entries);
    expect(await prisma.aiUsage.count()).toBe(0);
    // The lists are worked out the way Bug Guard's checks are: a write in there is refused.
    await expect(
      readOnly("Bug Guard only reads while it checks", async () => {
        await cmRulesReview(env.company.id);
        await prisma.company.update({ where: { id: env.company.id }, data: { name: "Changed" } });
      }),
    ).rejects.toThrow("Bug Guard only reads while it checks");

    // A settlement saved under the new rules is never listed.
    await batchMoney.undoCmSettlement(env.pm, made.id, { reason: "Settle under the new rules" });
    await batchMoney.settleCm(env.pm, env.batch.id, { deductCGrade: false });
    expect((await cmRulesReview(env.company.id)).settlements).toEqual([]);
  });
});
