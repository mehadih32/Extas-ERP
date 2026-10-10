import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import * as accountScreens from "@/modules/accounts/screens.service";
import * as supplierPayments from "@/modules/accounts/supplier-payment.service";
import { supplierProjectBalances } from "@/modules/accounts/supplier-projects";
import { billsOutOfStep } from "@/modules/accounts/supplier-settlement";
import * as printing from "@/modules/documents/print.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as styles from "@/modules/inventory/style.service";
import * as purchaseOrders from "@/modules/materials/purchase-order.service";
import * as purchases from "@/modules/materials/purchase.service";
import * as materials from "@/modules/materials/material.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import * as partyScreens from "@/modules/parties/screens.service";
import { getSupplier360 } from "@/modules/parties/supplier-360.service";
import * as costs from "@/modules/production/cost.service";
import * as intakes from "@/modules/production/intake.service";
import * as projects from "@/modules/production/project.service";
import * as productionScreens from "@/modules/production/screens.service";
import { projectSupplierRows } from "@/modules/production/settlement.service";
import { createRole } from "@/modules/rbac/role.service";
import * as reportScreens from "@/modules/reports/screens.service";

import { pdfLines } from "../fixtures/pdf";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/** A calendar day `n` days from today in company time, e.g. "2026-10-12". */
function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A company with one person per role, a polo style (Navy x S M L), a factory
 * that does CM and FOB, a fabric mill, an accessories supplier, a buyer, a
 * fabric and a button, and a role that sees production and raw materials but
 * no money (parties.view, production.view, materials.view).
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const person = async (email: string, roleId: string) => {
    const user = await makeUser(`${email}@extras.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const ctx = await person("admin", roles.SUPER_ADMIN);
  const pmCtx = await person("production", roles.PRODUCTION_MANAGER);
  const accountsCtx = await person("accounts", roles.ACCOUNTS);
  const salesCtx = await person("sales", roles.SALES_EXECUTIVE);
  const warehouseCtx = await person("warehouse", roles.WAREHOUSE_TEAM);
  const floorRole = await createRole(ctx, {
    name: "Production floor",
    permissions: ["parties.view", "production.view", "materials.view"],
  });
  const floorCtx = await person("floor", floorRole.id);

  const sizes = [];
  for (const name of ["S", "M", "L"]) sizes.push(await catalog.createSize(ctx, { name }));
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, {
    colorIds: [navy.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { size: true },
  });
  const sku = (size: string) => variants.find((v) => v.size.name === size)!.id;

  const supplier = async (name: string, supplierCategories: string[]) =>
    (await parties.createParty(ctx, { kind: "SUPPLIER", name, supplierCategories })).party;
  const factory = await supplier("Gazipur Knit Factory", ["CM", "FOB"]);
  const mill = await supplier("Narayanganj Fabrics", ["FABRIC"]);
  const trims = await supplier("Dhaka Trims", ["ACCESSORIES"]);
  const buyer = (await parties.createParty(ctx, { kind: "BUYER", name: "Rahim Traders" })).party;
  const heads = Object.fromEntries(
    (await costs.listCostHeads(ctx)).map((h) => [h.name, h.id]),
  ) as Record<string, string>;
  const fabric = await materials.createMaterial(pmCtx, {
    name: "Single Jersey 180 GSM",
    kind: "FABRIC",
    unit: "METER",
    supplierId: mill.id,
  });
  const button = await materials.createMaterial(pmCtx, {
    name: "Polo Button 18L",
    kind: "TRIM",
    unit: "PCS",
    supplierId: trims.id,
  });
  return {
    ctx,
    pmCtx,
    accountsCtx,
    salesCtx,
    warehouseCtx,
    floorCtx,
    company,
    style,
    sku,
    factory,
    mill,
    trims,
    buyer,
    heads,
    fabric,
    button,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

/** An active polo project at the factory. */
const newProject = (env: Env, name: string, targetQuantity = 100) =>
  projects.createProject(env.pmCtx, {
    name,
    styleId: env.style.id,
    factoryId: env.factory.id,
    buyerId: env.buyer.id,
    targetDate: dayFromToday(30),
    targetQuantity,
  });

/** A bill on credit (Due) from a supplier, shared across projects by head. */
const bill = (
  env: Env,
  supplierId: string,
  billDate: string,
  shares: Array<{ projectId: string; head: string; amount: number }>,
) =>
  costs.createBill(env.pmCtx, {
    supplierId,
    billDate,
    paymentType: "DUE",
    allocations: shares.map((s) => ({
      projectId: s.projectId,
      expenseHeadId: env.heads[s.head]!,
      amount: s.amount,
    })),
  });

/** A payment to a supplier by Accounts, for a project or on account. */
const pay = (env: Env, supplierId: string, amount: number, projectId?: string) =>
  supplierPayments.paySupplier(env.accountsCtx, {
    supplierId,
    amount,
    method: "CASH",
    projectId,
  });

const billState = async (id: string) => {
  const b = await prisma.supplierBill.findUniqueOrThrow({ where: { id } });
  return [b.status, b.paidAmount.toFixed(2), b.dueAmount.toFixed(2)];
};

/** Receives the project's goods (all its cost moves to stock) and completes it. */
async function deliverAndComplete(env: Env, projectId: string, pieces = 30) {
  const draft = await intakes.createIntake(env.pmCtx, {
    projectId,
    lines: [{ variantId: env.sku("M"), quantity: pieces }],
  });
  return intakes.confirmIntake(env.pmCtx, draft.id, { completeProject: true });
}

run("Supplier 360° and project settlements", () => {
  let uploads: string;

  beforeEach(async () => {
    await resetDb();
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-supplier-360-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("keeps what each supplier supplies and lists suppliers by it", async () => {
    const env = await setup();
    // Ticked in any order, kept once each in the usual order.
    const both = (
      await parties.createParty(env.ctx, {
        kind: "SUPPLIER",
        name: "Ashulia Garments",
        supplierCategories: ["FOB", "CM", "FOB"],
      })
    ).party;
    expect(both.supplierCategories).toEqual(["FOB", "CM"]);
    expect(env.buyer.supplierCategories).toEqual([]);

    // Buyers supply nothing.
    await expect(
      parties.createParty(env.ctx, {
        kind: "BUYER",
        name: "Karim Fashion",
        supplierCategories: ["FABRIC"],
      }),
    ).rejects.toBeInstanceOf(ZodError);
    await expectAppError(
      parties.updateParty(env.ctx, env.buyer.id, { supplierCategories: ["CM"] }),
      "VALIDATION",
    );

    const listed = async (category: string) =>
      (await parties.listParties(env.ctx, { kind: "SUPPLIER", category })).items
        .map((p) => p.name)
        .sort();
    expect(await listed("CM")).toEqual(["Ashulia Garments", "Gazipur Knit Factory"]);
    expect(await listed("FABRIC")).toEqual(["Narayanganj Fabrics"]);
    expect(await listed("ACCESSORIES")).toEqual(["Dhaka Trims"]);

    // Edited like any other detail; a supplier turned buyer supplies nothing.
    await parties.updateParty(env.ctx, both.id, { supplierCategories: ["CM"] });
    const screen = await partyScreens.getPartyScreen(env.ctx, both.id);
    expect(screen.party.supplierCategories).toEqual(["CM"]);
    await parties.updateParty(env.ctx, both.id, { kind: "BUYER" });
    expect(
      (await prisma.party.findUniqueOrThrow({ where: { id: both.id } })).supplierCategories,
    ).toEqual([]);

    // New companies get the FOB cost heads with the rest.
    expect(Object.keys(env.heads)).toEqual(
      expect.arrayContaining(["FOB Goods", "QC & Inspection"]),
    );
  });

  it("pays a supplier for one project: that project's bills first, the rest oldest first", async () => {
    const env = await setup();
    const a = await newProject(env, "Polo run A");
    const b = await newProject(env, "Polo run B");
    const idle = await newProject(env, "Polo run C");
    // F1 for A (oldest), F2 for B, F3 split between them.
    const f1 = await bill(env, env.mill.id, dayFromToday(-10), [
      { projectId: a.id, head: "Fabric", amount: 1000 },
    ]);
    const f2 = await bill(env, env.mill.id, dayFromToday(-5), [
      { projectId: b.id, head: "Fabric", amount: 2000 },
    ]);
    const f3 = await bill(env, env.mill.id, dayFromToday(-2), [
      { projectId: a.id, head: "Fabric", amount: 500 },
      { projectId: b.id, head: "Fabric", amount: 500 },
    ]);
    expect((await ledger.getPartyBalance(env.ctx, env.mill.id)).toFixed(2)).toBe("-4000.00");

    // The pay form offers each project with something due.
    const dues = await accountScreens.getSupplierDues(env.accountsCtx, env.mill.id);
    expect(dues.projects.map((p) => [p.code, p.due])).toEqual([
      [a.code, "1500.00"],
      [b.code, "2500.00"],
    ]);
    const form = await accountScreens.getPayForm(env.accountsCtx, env.mill.id, b.id);
    expect(form.supplier?.projectId).toBe(b.id);
    expect(
      (await accountScreens.getPayForm(env.accountsCtx, env.mill.id, idle.id)).supplier?.projectId,
    ).toBeNull();

    // 2,200 for B settles B's bill and B's half of the split bill; A's old bill waits.
    const forB = await pay(env, env.mill.id, 2200, b.id);
    expect(forB.project).toMatchObject({ id: b.id, code: b.code });
    expect(forB.appliedTo.map((x) => [x.number, x.amount])).toEqual([
      [f2.number, "2000.00"],
      [f3.number, "200.00"],
    ]);
    expect(await billState(f1.id)).toEqual(["UNPAID", "0.00", "1000.00"]);
    expect(await billState(f2.id)).toEqual(["PAID", "2000.00", "0.00"]);
    expect(await billState(f3.id)).toEqual(["PARTIALLY_PAID", "200.00", "800.00"]);
    const byProject = await supplierProjectBalances(prisma, env.company.id, env.mill.id);
    // The split bill's payment counts for each project by its share.
    expect(
      [a.id, b.id].map((id) => {
        const x = byProject.get(id)!;
        return [x.billed.toFixed(2), x.paid.toFixed(2), x.due.toFixed(2)];
      }),
    ).toEqual([
      ["1500.00", "100.00", "1400.00"],
      ["2500.00", "2100.00", "400.00"],
    ]);

    // Nothing is due for C: pay without a project instead.
    const refused = await expectAppError(pay(env, env.mill.id, 100, idle.id), "VALIDATION");
    expect(refused.details?.projectId).toBeDefined();
    // Paying stays with Accounts.
    await expectAppError(
      supplierPayments.paySupplier(env.pmCtx, {
        supplierId: env.mill.id,
        amount: 100,
        method: "CASH",
        projectId: a.id,
      }),
      "FORBIDDEN",
    );

    // On account: the oldest first, as before.
    await pay(env, env.mill.id, 300);
    expect(await billState(f1.id)).toEqual(["PARTIALLY_PAID", "300.00", "700.00"]);

    // Voiding the payment for B: B's bills are due again, the 300 stays on the oldest.
    await supplierPayments.voidSupplierPayment(env.accountsCtx, forB.id, {
      reason: "Paid the wrong project",
    });
    expect(await billState(f1.id)).toEqual(["PARTIALLY_PAID", "300.00", "700.00"]);
    expect(await billState(f2.id)).toEqual(["UNPAID", "0.00", "2000.00"]);
    expect(await billState(f3.id)).toEqual(["UNPAID", "0.00", "1000.00"]);

    // More than A needs: A's bills first (F1 and A's half of F3), the rest oldest first.
    const forA = await pay(env, env.mill.id, 3000, a.id);
    expect(forA.advanceLeft).toBe("0.00");
    expect(await billState(f1.id)).toEqual(["PAID", "1000.00", "0.00"]);
    expect(await billState(f2.id)).toEqual(["PARTIALLY_PAID", "1800.00", "200.00"]);
    expect(await billState(f3.id)).toEqual(["PARTIALLY_PAID", "500.00", "500.00"]);
    expect((await ledger.getPartyBalance(env.ctx, env.mill.id)).toFixed(2)).toBe("-700.00");

    // The payment list says what it was for; the books agree with the bills.
    const rows = await accountScreens.listSupplierPaymentRows(env.accountsCtx, {});
    expect(rows.items.find((r) => r.id === forA.id)?.project).toEqual({
      id: a.id,
      code: a.code,
    });
    expect(await billsOutOfStep(env.company.id)).toEqual([]);
  });

  it("settles a completed project with each supplier and posts nothing", async () => {
    const env = await setup();
    const project = await newProject(env, "Polo run A");
    await bill(env, env.factory.id, dayFromToday(-6), [
      { projectId: project.id, head: "Sewing (CM)", amount: 5000 },
    ]);
    await bill(env, env.mill.id, dayFromToday(-8), [
      { projectId: project.id, head: "Fabric", amount: 3000 },
    ]);
    await bill(env, env.trims.id, dayFromToday(-7), [
      { projectId: project.id, head: "Trims & Accessories", amount: 800 },
    ]);
    // A QC check on the goods is one more cost of the project.
    await costs.addProjectCost(env.pmCtx, project.id, {
      supplierId: env.factory.id,
      expenseHeadId: env.heads["QC & Inspection"],
      amount: 400,
      paymentType: "DUE",
    });
    await pay(env, env.mill.id, 1000, project.id);

    // While it runs, the project shows what it owes each of them.
    const running = await projectSupplierRows(prisma, env.pmCtx, {
      id: project.id,
      status: "ACTIVE",
    });
    expect(running.map((r) => [r.supplier.name, r.billed, r.paid, r.balance])).toEqual([
      ["Dhaka Trims", "800.00", "0.00", "800.00"],
      ["Gazipur Knit Factory", "5400.00", "0.00", "5400.00"],
      ["Narayanganj Fabrics", "3000.00", "1000.00", "2000.00"],
    ]);

    const payable = async () =>
      Promise.all(
        [env.factory.id, env.mill.id, env.trims.id].map(async (id) =>
          (await ledger.getPartyBalance(env.ctx, id)).toFixed(2),
        ),
      );
    const before = await payable();
    const entriesBefore = await prisma.journalEntry.count({
      where: { companyId: env.company.id },
    });
    await deliverAndComplete(env, project.id);
    const done = await prisma.productionProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(done.status).toBe("COMPLETED");

    // A statement for the factory and the mill; the accessories supplier is on a
    // running ledger. Nothing posted beyond the delivery itself, and every supplier
    // is owed what they were owed.
    const statements = await prisma.projectSettlement.findMany({
      where: { projectId: project.id },
      include: { supplier: { select: { name: true } } },
      orderBy: { supplier: { name: "asc" } },
    });
    expect(
      statements.map((s) => [
        s.supplier.name,
        s.billed.toFixed(2),
        s.paid.toFixed(2),
        s.carried.toFixed(2),
        s.reopenedAt,
      ]),
    ).toEqual([
      ["Gazipur Knit Factory", "5400.00", "0.00", "5400.00", null],
      ["Narayanganj Fabrics", "3000.00", "1000.00", "2000.00", null],
    ]);
    expect(statements[0]!.bills).toHaveLength(2);
    expect(await payable()).toEqual(before);
    expect(await prisma.journalEntry.count({ where: { companyId: env.company.id } })).toBe(
      entriesBefore + 1, // the delivery moving the cost to stock
    );
    const audit = await prisma.auditLog.findFirst({
      where: { companyId: env.company.id, summary: { startsWith: `Settled ${project.code}` } },
    });
    expect(audit?.summary).toBe(
      `Settled ${project.code} with Gazipur Knit Factory (5400.00 left on their ledger), Narayanganj Fabrics (2000.00 left on their ledger)`,
    );

    // The project's balance with them is zero; Dhaka Trims is still owed on their ledger.
    const screen = await productionScreens.getProjectScreen(env.pmCtx, project.id);
    expect(
      screen.suppliers?.map((r) => [
        r.supplier.name,
        r.balance,
        r.runningLedger,
        r.settlement?.carried ?? null,
      ]),
    ).toEqual([
      ["Dhaka Trims", "800.00", true, null],
      ["Gazipur Knit Factory", "0.00", false, "5400.00"],
      ["Narayanganj Fabrics", "0.00", false, "2000.00"],
    ]);
    // People who do not see production costs do not get the panel.
    const floorScreen = await productionScreens.getProjectScreen(env.floorCtx, project.id);
    expect(floorScreen.suppliers ?? null).toBeNull();

    // What was carried can still be paid for the project; the statement stays as it was.
    await pay(env, env.mill.id, 500, project.id);
    const mill360 = await getSupplier360(env.ctx, env.mill.id);
    expect(mill360.completedProjects?.items[0]?.money).toMatchObject({
      billed: "3000.00",
      paid: "1000.00",
      balance: "0.00",
      settlement: { carried: "2000.00", stillDue: "1500.00" },
    });

    // Reopened (a delivery was undone), its statements no longer stand...
    await prisma.$transaction((tx) =>
      projects.reopenProjectTx(tx, env.pmCtx, project, "Delivery undone"),
    );
    expect(
      await prisma.projectSettlement.count({
        where: { projectId: project.id, reopenedAt: null },
      }),
    ).toBe(0);
    const reopened = await getSupplier360(env.ctx, env.mill.id);
    expect(reopened.activeProjects?.items[0]?.money).toMatchObject({
      balance: "1500.00",
      settlement: null,
    });
    // ...and completing it again settles anew.
    await projects.completeProject(env.pmCtx, project.id);
    const again = await prisma.projectSettlement.findMany({
      where: { projectId: project.id, supplierId: env.mill.id },
      orderBy: { settledAt: "asc" },
    });
    expect(
      again.map((s) => [s.paid.toFixed(2), s.carried.toFixed(2), s.reopenedAt === null]),
    ).toEqual([
      ["1000.00", "2000.00", false],
      ["1500.00", "1500.00", true],
    ]);
    expect(await billsOutOfStep(env.company.id)).toEqual([]);
  });

  it("shows each role the part of a supplier's 360° view it may see", async () => {
    const env = await setup();
    const now = new Date();
    const today = localDay(now, env.company.timezone);
    const running = await newProject(env, "Polo run A");
    const finished = await newProject(env, "Polo run B", 50);
    await bill(env, env.factory.id, dayFromToday(-4), [
      { projectId: running.id, head: "Sewing (CM)", amount: 5000 },
    ]);
    const fobBill = await bill(env, env.factory.id, dayFromToday(-3), [
      { projectId: finished.id, head: "FOB Goods", amount: 2000 },
    ]);
    await pay(env, env.factory.id, 1500, finished.id);
    const goods = await deliverAndComplete(env, finished.id, 40);
    // The mill: an order for project A and a delivery of fabric into the store.
    const order = await purchaseOrders.createPurchaseOrder(env.pmCtx, {
      supplierId: env.mill.id,
      projectId: running.id,
      expectedDate: dayFromToday(10),
      lines: [{ materialId: env.fabric.id, quantity: 500, unitPrice: 175 }],
    });
    const fabricIn = await purchases.createPurchase(env.pmCtx, {
      supplierId: env.mill.id,
      paymentType: "DUE",
      items: [{ materialId: env.fabric.id, quantity: 120.5, unitPrice: 100 }],
    });

    const owner = await getSupplier360(env.ctx, env.factory.id, {}, now);
    expect(owner.party).toMatchObject({
      name: "Gazipur Knit Factory",
      categories: ["FOB", "CM"],
    });
    expect(owner.shows).toEqual({ money: true, production: true, materials: true });
    expect(owner.figures).toEqual({
      dueToThem: "5500.00",
      advanceWithThem: "0.00",
      billed: { total: "7000.00", bills: 2, open: "5500.00", openBills: 2 },
      paid: { total: "1500.00", payments: 1 },
      projects: { active: 1, completed: 1 },
      deliveries: { total: 1, lastOn: today },
    });
    expect(owner.runningLedger).toBe(false);
    expect(owner.activeProjects?.items.map((p) => [p.code, p.asFactory, p.money])).toEqual([
      [
        running.code,
        true,
        { billed: "5000.00", paid: "0.00", balance: "5000.00", settlement: null },
      ],
    ]);
    expect(owner.completedProjects?.items[0]).toMatchObject({
      code: finished.code,
      status: "COMPLETED",
      completedOn: today,
      produced: 40,
      money: {
        billed: "2000.00",
        paid: "1500.00",
        balance: "0.00",
        settlement: { settledOn: today, carried: "500.00", stillDue: "500.00" },
      },
    });
    expect(owner.deliveries?.items).toEqual([
      expect.objectContaining({
        kind: "GOODS",
        id: goods.id,
        number: goods.number,
        undone: false,
        project: { id: finished.id, code: finished.code },
        pieces: { a: 40, b: 0 },
        value: null,
      }),
    ]);
    expect(owner.bills?.items.map((b) => [b.number, b.opens, b.projects, b.due])).toEqual([
      [fobBill.number, "bill", [finished.code], "500.00"],
      [expect.any(String), "bill", [running.code], "5000.00"],
    ]);
    expect(owner.payments?.items[0]).toMatchObject({
      amount: "1500.00",
      project: { code: finished.code },
      bill: null,
      voided: false,
    });
    expect(owner.orders).toEqual({ total: 0, open: 0, items: [] });
    expect(owner.can).toMatchObject({ print: true, pay: true });

    // The mill: its order and fabric delivery, and project A through the order.
    const mill = await getSupplier360(env.ctx, env.mill.id, {}, now);
    expect(mill.deliveries?.items).toEqual([
      expect.objectContaining({
        kind: "MATERIALS",
        id: fabricIn.id,
        materials: [
          {
            id: env.fabric.id,
            code: env.fabric.code,
            name: "Single Jersey 180 GSM",
            unit: "METER",
            quantity: "120.5",
          },
        ],
        value: "12050.00",
      }),
    ]);
    expect(mill.orders?.items).toEqual([
      expect.objectContaining({
        id: order.id,
        status: "OPEN",
        project: { id: running.id, code: running.code },
        total: "87500.00",
      }),
    ]);
    expect(mill.activeProjects?.items.map((p) => [p.code, p.asFactory])).toEqual([
      [running.code, false],
    ]);
    expect(mill.bills?.items.map((b) => [b.isPurchase, b.opens])).toEqual([[true, "purchase"]]);

    // Accessories run on a running ledger.
    expect((await getSupplier360(env.ctx, env.trims.id)).runningLedger).toBe(true);

    // Accounts sees and pays; the Production Manager sees but does not pay.
    const accounts = await getSupplier360(env.accountsCtx, env.factory.id, {}, now);
    expect(accounts.shows).toEqual({ money: true, production: true, materials: true });
    expect(accounts.can.pay).toBe(true);
    const pm = await getSupplier360(env.pmCtx, env.factory.id, {}, now);
    expect(pm.figures.billed?.total).toBe("7000.00");
    expect(pm.can).toMatchObject({ pay: false, print: true });

    // The floor sees projects, deliveries and orders without any amount.
    const floor = await getSupplier360(env.floorCtx, env.mill.id, {}, now);
    expect(floor.shows).toEqual({ money: false, production: true, materials: true });
    expect(floor.figures.billed).toBeNull();
    expect(floor.figures.paid).toBeNull();
    expect(floor.bills).toBeNull();
    expect(floor.payments).toBeNull();
    expect(floor.activeProjects?.items[0]?.money).toBeNull();
    expect(floor.deliveries?.items[0]?.value).toBeNull();
    expect(floor.orders?.items[0]?.total).toBeNull();

    // Sales sees the profile's balance and nothing more.
    const sales = await getSupplier360(env.salesCtx, env.factory.id, {}, now);
    expect(sales.shows).toEqual({ money: false, production: false, materials: false });
    expect(sales.figures).toMatchObject({
      dueToThem: "5500.00",
      billed: null,
      paid: null,
      projects: null,
      deliveries: null,
    });
    for (const part of [
      sales.activeProjects,
      sales.completedProjects,
      sales.deliveries,
      sales.orders,
      sales.bills,
      sales.payments,
    ]) {
      expect(part).toBeNull();
    }
    expect(sales.can).toMatchObject({ pay: false, print: true });

    // Buyers have no supplier view.
    await expectAppError(getSupplier360(env.ctx, env.buyer.id), "NOT_FOUND");
  });

  it("lists the rest of a history with Show all", async () => {
    const env = await setup();
    for (let i = 0; i < 10; i++) {
      await purchaseOrders.createPurchaseOrder(env.pmCtx, {
        supplierId: env.trims.id,
        lines: [{ materialId: env.button.id, quantity: 1000 + i, unitPrice: 2 }],
      });
    }
    const first = await getSupplier360(env.ctx, env.trims.id);
    expect([first.orders?.total, first.orders?.open, first.orders?.items.length]).toEqual([
      10, 10, 8,
    ]);
    const all = await getSupplier360(env.ctx, env.trims.id, { all: "orders" });
    expect(all.orders?.items).toHaveLength(10);
    await expect(
      getSupplier360(env.ctx, env.trims.id, { all: "styles" as "orders" }),
    ).rejects.toBeInstanceOf(ZodError);
  });

  it("prints the supplier's profile as a PDF that opens only for people who may see all of it", async () => {
    const env = await setup();
    const today = localDay(new Date(), env.company.timezone);
    const running = await newProject(env, "Polo run A");
    const sewing = await bill(env, env.factory.id, dayFromToday(-4), [
      { projectId: running.id, head: "Sewing (CM)", amount: 5000 },
    ]);
    const payment = await pay(env, env.factory.id, 1200, running.id);

    const owners = await printing.printDocument(env.ctx, {
      type: "SUPPLIER_360",
      partyId: env.factory.id,
    });
    expect(owners).toMatchObject({
      type: "SUPPLIER_360",
      typeLabel: "Supplier 360° profile",
      title: `Supplier profile: Gazipur Knit Factory (${formatDay(today)})`,
      referenceType: "PartyProfile",
      referenceId: env.factory.id,
      reused: false,
    });
    const row = await prisma.generatedDocument.findUniqueOrThrow({ where: { id: owners.id } });
    expect(row.options).toMatchObject({
      shows: { money: true, production: true, materials: true },
    });
    const text = pdfLines((await printing.downloadDocument(env.ctx, owners.id)).bytes).join("\n");
    for (const expected of [
      "SUPPLIER PROFILE",
      "Gazipur Knit Factory (SUP-0001)",
      "FOB, CM (Factory)",
      "ACTIVE PROJECTS (1)",
      "COMPLETED PROJECTS (0)",
      `${running.code} · Polo run A`,
      "BILLS (1)",
      sewing.number,
      "PAYMENTS MADE (1)",
      payment.number,
      `Project ${running.code}`,
      "3,800.00",
      "5,000.00",
    ]) {
      expect(text).toContain(expected);
    }

    // Printed documents link it back to the supplier, and it shows on their profile.
    const rows = await reportScreens.listDocumentRows(env.ctx, { type: "SUPPLIER_360" });
    expect(rows.items.map((d) => d.source)).toEqual([
      { href: `/parties/suppliers/${env.factory.id}`, label: "Open the supplier" },
    ]);
    expect((await getSupplier360(env.ctx, env.factory.id)).documents.items[0]?.id).toBe(owners.id);
    // Nothing changed: the same copy comes back.
    expect(
      await printing.printDocument(env.ctx, { type: "SUPPLIER_360", partyId: env.factory.id }),
    ).toMatchObject({ id: owners.id, reused: true });

    // Sales staff print a copy without amounts, projects or deliveries...
    const sellers = await printing.printDocument(env.salesCtx, {
      type: "SUPPLIER_360",
      partyId: env.factory.id,
    });
    const sellerText = pdfLines(
      (await printing.downloadDocument(env.salesCtx, sellers.id)).bytes,
    ).join("\n");
    expect(sellerText).toContain("SUPPLIER PROFILE");
    for (const hidden of ["BILLS", "PAYMENTS MADE", "ACTIVE PROJECTS", sewing.number]) {
      expect(sellerText).not.toContain(hidden);
    }
    // ...and cannot open the owner's, which shows them.
    await expectAppError(printing.getDocument(env.salesCtx, owners.id), "FORBIDDEN");
    expect(
      (await printing.listDocuments(env.salesCtx, { type: "SUPPLIER_360" })).items.map((d) => d.id),
    ).toEqual([sellers.id]);
    // The floor sees projects but no money: the owner's copy stays hidden, the seller's opens.
    await expectAppError(printing.getDocument(env.floorCtx, owners.id), "FORBIDDEN");
    await printing.getDocument(env.floorCtx, sellers.id);
    expect(
      (await getSupplier360(env.floorCtx, env.factory.id)).documents.items.map((d) => d.id),
    ).toEqual([sellers.id]);

    // Buyers print the Customer 360° instead.
    await expect(
      printing.printDocument(env.ctx, { type: "SUPPLIER_360", partyId: env.buyer.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
