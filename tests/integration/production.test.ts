import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import * as files from "@/modules/files/file.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as ledger from "@/modules/parties/ledger.service";
import * as parties from "@/modules/parties/party.service";
import type { IntakeParser } from "@/modules/production/ai-intake";
import * as costs from "@/modules/production/cost.service";
import * as intakes from "@/modules/production/intake.service";
import { projectCostSummaries } from "@/modules/production/project-costs";
import * as projects from "@/modules/production/project.service";
import * as documents from "@/modules/sales/documents.service";
import * as payments from "@/modules/sales/payment.service";
import * as proformas from "@/modules/sales/proforma.service";
import * as quotations from "@/modules/sales/quotation.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";
// Ledger account codes (see CONTROL_ACCOUNTS).
const CASH = "1000";
const WALLET = "1050";
const BANK = "1100";
const INVENTORY = "1300";
const WIP = "1350";
const PAYABLE = "2100";
const COGS = "5000";
const LOSS = "5100";

/** A calendar day `n` days from today in company time, e.g. "2026-10-12". */
function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A company with a polo style (Navy / White x S M L XL), a factory and a fabric
 * mill as suppliers, a buyer, and one user per role: Super Admin, Production
 * Manager, Accounts, Warehouse Team and Sales Executive.
 */
async function setup(companyName = "Extras") {
  const { company, roles } = await makeCompany(companyName);
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const ctx = await member("SUPER_ADMIN", "admin");
  const pmCtx = await member("PRODUCTION_MANAGER", "production");
  const accountsCtx = await member("ACCOUNTS", "accounts");
  const warehouseCtx = await member("WAREHOUSE_TEAM", "warehouse");
  const salesCtx = await member("SALES_EXECUTIVE", "sales");

  const sizes = [];
  for (const name of ["S", "M", "L", "XL"]) sizes.push(await catalog.createSize(ctx, { name }));
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, {
    colorIds: [navy.id, white.id],
    sizeIds: sizes.map((s) => s.id),
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { color: true, size: true },
  });
  const sku = (color: string, size: string) =>
    variants.find((v) => v.color.name === color && v.size.name === size)!.id;

  const supplier = async (name: string) =>
    (await parties.createParty(ctx, { kind: "SUPPLIER", name })).party;
  const factory = await supplier("Gazipur Knit Factory");
  const mill = await supplier("Narayanganj Fabrics");
  const buyer = (
    await parties.createParty(ctx, { kind: "BUYER", name: "Rahim Traders", phone: "01711223344" })
  ).party;
  const heads = Object.fromEntries(
    (await costs.listCostHeads(ctx)).map((h) => [h.name, h.id]),
  ) as Record<string, string>;
  const warehouse = await stock.getDefaultWarehouse(ctx);
  return {
    ctx,
    pmCtx,
    accountsCtx,
    warehouseCtx,
    salesCtx,
    company,
    style,
    tops,
    sku,
    factory,
    mill,
    buyer,
    heads,
    warehouse,
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

/** Every journal entry of the company balances. */
async function expectBooksBalanced(companyId: string) {
  const rows = await prisma.$queryRaw<Array<{ number: string }>>`
    SELECT je.number FROM "JournalEntry" je JOIN "JournalLine" jl ON jl."entryId" = je.id
    WHERE je."companyId" = ${companyId}
    GROUP BY je.id HAVING SUM(jl.debit) <> SUM(jl.credit)`;
  expect(rows).toEqual([]);
}

/** Debit minus credit on a ledger account, e.g. "1350" (Work in Progress). */
async function accountBalance(companyId: string, code: string) {
  const rows = await prisma.$queryRaw<Array<{ balance: Prisma.Decimal | null }>>`
    SELECT SUM(jl.debit - jl.credit) AS balance
    FROM "JournalLine" jl JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE la."companyId" = ${companyId} AND la.code = ${code}`;
  return Number(rows[0]?.balance ?? 0).toFixed(2);
}

/** The Work in Progress ledger account equals the projects' work in progress added up. */
async function expectWipMatchesProjects(env: Env) {
  const all = await prisma.productionProject.findMany({
    where: { companyId: env.company.id },
    select: { id: true },
  });
  const summaries = await projectCostSummaries(
    prisma,
    env.company.id,
    all.map((p) => p.id),
  );
  const total = [...summaries.values()].reduce((s, x) => s + Number(x.wip), 0);
  expect(await accountBalance(env.company.id, WIP)).toBe(total.toFixed(2));
}

const balanceOf = async (env: Env, partyId: string) =>
  (await ledger.getPartyBalance(env.ctx, partyId)).toFixed(2);
const cell = async (env: Env, variantId: string) =>
  (await stock.stockByVariant(env.ctx, [variantId])).get(variantId)!;
const avgCost = async (variantId: string) =>
  (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).avgCost.toFixed(4);

/** An active polo project made by the Production Manager. */
const newProject = (env: Env, extra: Record<string, unknown> = {}) =>
  projects.createProject(env.pmCtx, {
    name: "Classic Polo run",
    styleId: env.style.id,
    factoryId: env.factory.id,
    targetDate: dayFromToday(30),
    targetQuantity: 100,
    ...extra,
  });

/** A fabric bill from the mill on credit (Due), for one project. */
const dueBill = (env: Env, projectId: string, amount: number) =>
  costs.createBill(env.pmCtx, {
    supplierId: env.mill.id,
    paymentType: "DUE",
    allocations: [{ projectId, expenseHeadId: env.heads.Fabric, amount }],
  });

run("production projects", () => {
  beforeEach(resetDb);

  it("creates projects for a buyer or In-House and shows them on the overview", async () => {
    const env = await setup();
    const forBuyer = await newProject(env, {
      name: "Rahim polo order",
      buyerId: env.buyer.id,
      targetQuantity: 1000,
    });
    expect(forBuyer).toMatchObject({
      code: expect.stringMatching(/^PRD-\d{4}-00001$/),
      status: "ACTIVE",
      isInHouse: false,
      buyerLabel: "Rahim Traders",
      factoryLabel: "Gazipur Knit Factory",
      category: { name: "Tops" }, // taken from the style
      stage: { label: "Fabric Sourcing", number: 1, of: 5 },
      quantities: { target: 1000, produced: 0, remaining: 1000 },
      timeline: { totalDays: 30, elapsedDays: 0, remainingDays: 30, health: "ON_TRACK" },
    });
    expect(forBuyer.costs?.totalCost.toFixed(2)).toBe("0.00");
    expect(forBuyer.stageHistory.map((s) => s.label)).toEqual(["Fabric Sourcing"]);

    const inHouse = await projects.createProject(env.pmCtx, {
      name: "In-house basics",
      factoryName: "Own sewing floor",
      targetDate: dayFromToday(5),
      targetQuantity: 300,
    });
    expect(inHouse).toMatchObject({
      isInHouse: true,
      buyerLabel: "In-House",
      factoryLabel: "Own sewing floor",
      timeline: { remainingDays: 5, dueSoon: true, health: "DUE_SOON" },
    });

    const late = await newProject(env, {
      name: "Late tees",
      startDate: dayFromToday(-40),
      targetDate: dayFromToday(-10),
    });
    expect(late.timeline).toMatchObject({
      elapsedDays: 40,
      remainingDays: -10,
      isOverdue: true,
      overdueDays: 10,
      health: "OVERDUE",
    });

    const planned = await newProject(env, {
      name: "Winter hoodies",
      status: "PLANNED",
      startDate: dayFromToday(10),
      targetDate: dayFromToday(60),
    });
    expect(planned).toMatchObject({ status: "PLANNED", stageHistory: [] });

    const overview = await projects.getProductionOverview(env.pmCtx);
    expect(overview.counts).toEqual({
      planned: 1,
      active: 3,
      onHold: 0,
      overdue: 1,
      dueSoon: 1,
      completedThisMonth: 0,
    });
    // Overdue (red) cards first, then by target date.
    expect(overview.projects.map((p) => p.name)).toEqual([
      "Late tees",
      "In-house basics",
      "Rahim polo order",
      "Winter hoodies",
    ]);
    expect(overview.byStage).toEqual([
      { stage: "FABRIC_SOURCING", label: "Fabric Sourcing", count: 3 },
      { stage: "CUTTING", label: "Cutting", count: 0 },
      { stage: "SEWING", label: "Sewing", count: 0 },
      { stage: "WASH_QC", label: "Wash/QC", count: 0 },
      { stage: "FINISHING", label: "Finishing", count: 0 },
    ]);
    expect(overview.totals?.wip.toFixed(2)).toBe("0.00");

    // The warehouse sees the projects but not what they cost.
    const forWarehouse = await projects.getProductionOverview(env.warehouseCtx);
    expect(forWarehouse.totals).toBeNull();
    expect(forWarehouse.projects.every((p) => p.costs === null)).toBe(true);

    const names = async (query: Record<string, string>) =>
      (await projects.listProjects(env.pmCtx, query)).items.map((p) => p.name);
    expect(await names({ inHouse: "false" })).toEqual(["Rahim polo order"]);
    // Newest start first; projects without a buyer are In-House.
    expect(await names({ inHouse: "true" })).toEqual([
      "Winter hoodies",
      "In-house basics",
      "Late tees",
    ]);
    expect(await names({ overdue: "true" })).toEqual(["Late tees"]);
    expect(await names({ status: "PLANNED" })).toEqual(["Winter hoodies"]);
    expect(await names({ search: "rahim" })).toEqual(["Rahim polo order"]);
    expect(await names({ buyerId: env.buyer.id })).toEqual(["Rahim polo order"]);

    await expectAppError(
      newProject(env, { startDate: dayFromToday(5), targetDate: dayFromToday(1) }),
      "VALIDATION",
    );
    // A supplier cannot be the buyer, nor a buyer the factory.
    await expectAppError(newProject(env, { buyerId: env.factory.id }), "VALIDATION");
    await expectAppError(newProject(env, { factoryId: env.buyer.id }), "VALIDATION");
  });

  it("moves through the stages, pauses and resumes, and keeps the stage history", async () => {
    const env = await setup();
    const project = await newProject(env);
    await projects.setProjectStage(env.pmCtx, project.id, { stage: "CUTTING" });
    const sewing = await projects.setProjectStage(env.pmCtx, project.id, { stage: "SEWING" });
    expect(sewing.stage).toMatchObject({ key: "SEWING", number: 3, progressPercent: 40 });
    await expectAppError(
      projects.setProjectStage(env.pmCtx, project.id, { stage: "SEWING" }),
      "CONFLICT",
    );
    // Going back a stage (rework) needs a reason.
    await expectAppError(
      projects.setProjectStage(env.pmCtx, project.id, { stage: "CUTTING" }),
      "VALIDATION",
    );
    const rework = await projects.setProjectStage(env.pmCtx, project.id, {
      stage: "CUTTING",
      note: "Panels cut with the wrong GSM",
    });
    expect(rework.stageHistory.map((s) => [s.label, s.completedAt === null, s.note])).toEqual([
      ["Fabric Sourcing", false, null],
      ["Cutting", false, null],
      ["Sewing", false, null],
      ["Cutting", true, "Panels cut with the wrong GSM"],
    ]);
    // Completing goes through Move to Stock or Complete, not the stage badge.
    await expect(
      projects.setProjectStage(env.pmCtx, project.id, { stage: "COMPLETED" }),
    ).rejects.toBeInstanceOf(ZodError);

    // On hold: the stage cannot move until the project is resumed.
    const held = await projects.setProjectStatus(env.pmCtx, project.id, {
      status: "ON_HOLD",
      note: "Waiting for zippers",
    });
    expect(held.status).toBe("ON_HOLD");
    await expectAppError(
      projects.setProjectStage(env.pmCtx, project.id, { stage: "SEWING" }),
      "CONFLICT",
    );
    await expectAppError(
      projects.setProjectStatus(env.pmCtx, project.id, { status: "ON_HOLD" }),
      "CONFLICT",
    );
    await projects.setProjectStatus(env.pmCtx, project.id, { status: "ACTIVE" });
    const resumed = await projects.setProjectStage(env.pmCtx, project.id, { stage: "SEWING" });
    expect(resumed.stage.key).toBe("SEWING");
    expect(
      await prisma.auditLog.count({
        where: { entityId: project.id, action: "STATUS_CHANGE" },
      }),
    ).toBe(6);

    // A planned project starts when production really begins, even early.
    const planned = await newProject(env, {
      status: "PLANNED",
      startDate: dayFromToday(10),
      targetDate: dayFromToday(40),
    });
    await expectAppError(
      projects.setProjectStage(env.pmCtx, planned.id, { stage: "CUTTING" }),
      "CONFLICT",
    );
    const started = await projects.setProjectStatus(env.pmCtx, planned.id, { status: "ACTIVE" });
    expect(started).toMatchObject({
      status: "ACTIVE",
      timeline: { startDay: dayFromToday(0), remainingDays: 40 },
    });
    expect(started.stageHistory.map((s) => s.label)).toEqual(["Fabric Sourcing"]);

    const edited = await projects.updateProject(env.pmCtx, project.id, {
      targetQuantity: 1200,
      targetDate: dayFromToday(50),
      buyerId: env.buyer.id,
    });
    expect(edited).toMatchObject({
      buyerLabel: "Rahim Traders",
      isInHouse: false,
      quantities: { target: 1200 },
      timeline: { remainingDays: 50 },
    });
  });
});

run("production costs", () => {
  beforeEach(resetDb);

  it("splits one supplier bill across projects on credit (Due)", async () => {
    const env = await setup();
    const polo = await newProject(env, { targetQuantity: 1000 });
    const tees = await newProject(env, { name: "Tee run", targetQuantity: 500 });

    const bill = await costs.createBill(env.pmCtx, {
      supplierId: env.mill.id,
      supplierRef: "NF-7781",
      billDate: dayFromToday(-2),
      paymentType: "DUE",
      allocations: [
        { projectId: polo.id, expenseHeadId: env.heads.Fabric, amount: 60000 },
        { projectId: tees.id, expenseHeadId: env.heads.Fabric, amount: 25000 },
        {
          projectId: polo.id,
          expenseHeadId: env.heads["Trims & Accessories"],
          amount: 5000,
          description: "Buttons and labels",
        },
      ],
    });
    expect(bill).toMatchObject({
      number: expect.stringMatching(/^BILL-\d{4}-00001$/),
      status: "UNPAID",
      paymentType: "DUE",
      supplierRef: "NF-7781",
    });
    expect(bill.totalAmount.toFixed(2)).toBe("90000.00");
    expect(bill.dueAmount.toFixed(2)).toBe("90000.00");
    expect(
      bill.allocations
        .map((a) => [a.project?.code, a.expenseHead.name, a.amount.toFixed(2)].join(" "))
        .sort(),
    ).toEqual(
      [
        `${polo.code} Fabric 60000.00`,
        `${tees.code} Fabric 25000.00`,
        `${polo.code} Trims & Accessories 5000.00`,
      ].sort(),
    );

    // The mill is owed the whole bill; each project carries its share as work in progress.
    expect(await balanceOf(env, env.mill.id)).toBe("-90000.00");
    expect(await accountBalance(env.company.id, WIP)).toBe("90000.00");
    expect(await accountBalance(env.company.id, PAYABLE)).toBe("-90000.00");

    const sheet = await costs.getProjectCostSheet(env.pmCtx, polo.id);
    expect(sheet.summary).toMatchObject({ piecesReceived: 0, actualCostPerPiece: null });
    expect(sheet.summary.totalCost.toFixed(2)).toBe("65000.00");
    expect(sheet.summary.wip.toFixed(2)).toBe("65000.00");
    expect(sheet.summary.estimatedCostPerPiece.toFixed(2)).toBe("65.00");
    expect(sheet.byHead.map((h) => [h.name, h.amount.toFixed(2)])).toEqual([
      ["Fabric", "60000.00"],
      ["Trims & Accessories", "5000.00"],
    ]);
    expect(sheet.entries.map((e) => [e.kind, e.number])).toEqual([
      ["BILL", bill.number],
      ["BILL", bill.number],
    ]);
    const cached = await prisma.productionProject.findUniqueOrThrow({ where: { id: tees.id } });
    expect(cached.totalCost.toFixed(2)).toBe("25000.00");
    expect((await projects.getProductionOverview(env.accountsCtx)).totals?.wip.toFixed(2)).toBe(
      "90000.00",
    );

    expect(
      (await costs.listBills(env.pmCtx, { projectId: tees.id })).items.map((b) => b.id),
    ).toEqual([bill.id]);
    expect((await costs.listBills(env.accountsCtx, { supplierId: env.factory.id })).items).toEqual(
      [],
    );

    // Cost figures stay with Production and Accounts.
    await expectAppError(costs.getBill(env.warehouseCtx, bill.id), "FORBIDDEN");
    await expectAppError(costs.getProjectCostSheet(env.warehouseCtx, polo.id), "FORBIDDEN");
    expect((await projects.getProject(env.warehouseCtx, polo.id)).costs).toBeNull();

    // Bills need a supplier and active cost heads.
    await expectAppError(
      costs.createBill(env.pmCtx, {
        supplierId: env.buyer.id,
        paymentType: "DUE",
        allocations: [{ projectId: polo.id, expenseHeadId: env.heads.Fabric, amount: 100 }],
      }),
      "VALIDATION",
    );
    await costs.updateCostHead(env.pmCtx, env.heads.Wash!, { isActive: false });
    await expectAppError(
      costs.createBill(env.pmCtx, {
        supplierId: env.mill.id,
        paymentType: "DUE",
        allocations: [{ projectId: polo.id, expenseHeadId: env.heads.Wash, amount: 100 }],
      }),
      "VALIDATION",
    );
    await expectBooksBalanced(env.company.id);
    await expectWipMatchesProjects(env);
  });

  it("keeps money paid out with Accounts: cash bills, supplier payments and voids", async () => {
    const env = await setup();
    const project = await newProject(env, { targetQuantity: 1000 });
    const sewing = (extra: Record<string, unknown>) => ({
      supplierId: env.factory.id,
      allocations: [
        { projectId: project.id, expenseHeadId: env.heads["Sewing (CM)"], amount: 30000 },
      ],
      ...extra,
    });

    // Production Managers record what is owed, never money going out.
    await expectAppError(
      costs.createBill(env.pmCtx, sewing({ paymentType: "CASH_BANK" })),
      "FORBIDDEN",
    );
    await expectAppError(
      costs.addProjectCost(env.pmCtx, project.id, {
        expenseHeadId: env.heads["Production Transport"],
        amount: 1500,
        paymentType: "CASH_BANK",
      }),
      "FORBIDDEN",
    );
    // A cost left Due must say which supplier it is owed to.
    await expect(
      costs.addProjectCost(env.pmCtx, project.id, {
        expenseHeadId: env.heads.Fabric,
        amount: 100,
        paymentType: "DUE",
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await prisma.supplierBill.count()).toBe(0);

    // Accounts records a bill paid on the spot by bKash.
    const paidNow = await costs.createBill(
      env.accountsCtx,
      sewing({ paymentType: "CASH_BANK", method: "BKASH", reference: "TRX-88" }),
    );
    expect(paidNow.status).toBe("PAID");
    expect(paidNow.dueAmount.toFixed(2)).toBe("0.00");
    expect(paidNow.payments).toMatchObject([
      { number: expect.stringMatching(/^PV-\d{4}-00001$/), method: "BKASH", reference: "TRX-88" },
    ]);
    expect(await accountBalance(env.company.id, WALLET)).toBe("-30000.00");
    expect(await balanceOf(env, env.factory.id)).toBe("0.00");

    // A Due bill that Accounts pays in parts.
    const due = await costs.createBill(
      env.pmCtx,
      sewing({ paymentType: "DUE", supplierRef: "GKF-12" }),
    );
    expect(await balanceOf(env, env.factory.id)).toBe("-30000.00");
    await expectAppError(
      costs.payBill(env.pmCtx, due.id, { amount: 1000, method: "CASH" }),
      "FORBIDDEN",
    );
    const part = await costs.payBill(env.accountsCtx, due.id, {
      amount: 10000,
      method: "BANK_TRANSFER",
      reference: "CHQ 1021",
    });
    expect(part.status).toBe("PARTIALLY_PAID");
    expect(part.dueAmount.toFixed(2)).toBe("20000.00");
    await expectAppError(
      costs.payBill(env.accountsCtx, due.id, { amount: 20000.01, method: "CASH" }),
      "VALIDATION",
    );
    expect(
      (await costs.payBill(env.accountsCtx, due.id, { amount: 20000, method: "CASH" })).status,
    ).toBe("PAID");
    await expectAppError(
      costs.payBill(env.accountsCtx, due.id, { amount: 1, method: "CASH" }),
      "CONFLICT",
    );
    expect(await balanceOf(env, env.factory.id)).toBe("0.00");
    expect(await accountBalance(env.company.id, BANK)).toBe("-10000.00");
    expect(await accountBalance(env.company.id, CASH)).toBe("-20000.00");

    // A wrong bill is voided; what was already paid on it stays with the supplier as an advance.
    const wrong = await costs.createBill(
      env.pmCtx,
      sewing({
        paymentType: "DUE",
        allocations: [{ projectId: project.id, expenseHeadId: env.heads.Wash, amount: 8000 }],
      }),
    );
    await costs.payBill(env.accountsCtx, wrong.id, { amount: 3000, method: "CASH" });
    const voided = await costs.voidBill(env.pmCtx, wrong.id, {
      reason: "Entered against the wrong factory",
    });
    expect(voided).toMatchObject({ status: "VOID", payments: [] });
    expect(
      await prisma.payment.findFirst({ where: { partyId: env.factory.id, amount: 3000 } }),
    ).toMatchObject({ isAdvance: true, supplierBillId: null });
    expect(await balanceOf(env, env.factory.id)).toBe("3000.00"); // the factory owes us 3,000
    await expectAppError(
      costs.voidBill(env.pmCtx, wrong.id, { reason: "Entered twice" }),
      "CONFLICT",
    );
    expect(
      (await costs.getProjectCostSheet(env.pmCtx, project.id)).summary.totalCost.toFixed(2),
    ).toBe("60000.00");

    // A cost paid straight from cash, then voided again by Accounts.
    const sheet = await costs.addProjectCost(env.accountsCtx, project.id, {
      expenseHeadId: env.heads["Production Transport"],
      amount: 1500,
      paymentType: "CASH_BANK",
      description: "Truck to the factory",
      reference: "Slip 44",
    });
    const direct = sheet.entries.find((e) => e.kind === "DIRECT")!;
    expect(direct).toMatchObject({
      number: expect.stringMatching(/^EXP-\d{4}-00001$/),
      description: "Truck to the factory · Ref Slip 44",
      isVoid: false,
    });
    expect(sheet.summary.directCost.toFixed(2)).toBe("1500.00");
    expect(await accountBalance(env.company.id, CASH)).toBe("-24500.00");
    await expectAppError(
      costs.voidProjectCost(env.pmCtx, direct.id, { reason: "Duplicate slip" }),
      "FORBIDDEN",
    );
    const afterVoid = await costs.voidProjectCost(env.accountsCtx, direct.id, {
      reason: "Duplicate slip",
    });
    expect(afterVoid.summary.directCost.toFixed(2)).toBe("0.00");
    expect(afterVoid.entries.find((e) => e.id === direct.id)).toMatchObject({
      isVoid: true,
      voidReason: "Duplicate slip",
    });
    await expectAppError(
      costs.voidProjectCost(env.accountsCtx, direct.id, { reason: "Duplicate slip" }),
      "CONFLICT",
    );
    expect(await accountBalance(env.company.id, CASH)).toBe("-23000.00");

    // A cost owed to a supplier becomes a one-line bill on their ledger.
    const owed = await costs.addProjectCost(env.pmCtx, project.id, {
      expenseHeadId: env.heads["Print & Embroidery"],
      amount: 4200,
      paymentType: "DUE",
      supplierId: env.factory.id,
      supplierRef: "EMB-3",
    });
    expect(owed.summary.totalCost.toFixed(2)).toBe("64200.00");
    expect(await balanceOf(env, env.factory.id)).toBe("-1200.00"); // 4,200 owed less the advance
    await expectBooksBalanced(env.company.id);
    await expectWipMatchesProjects(env);
  });

  it("keeps a list of production cost heads", async () => {
    const env = await setup();
    const heads = await costs.listCostHeads(env.pmCtx);
    expect(heads).toHaveLength(10);
    expect(heads.map((h) => h.name)).toEqual(
      expect.arrayContaining(["Fabric", "Sewing (CM)", "Wash", "Finishing & Packing"]),
    );
    const knitting = await costs.createCostHead(env.pmCtx, { name: "Knitting" });
    expect(knitting).toMatchObject({ name: "Knitting", category: "PRODUCTION", isActive: true });
    await expectAppError(costs.createCostHead(env.pmCtx, { name: "fabric" }), "CONFLICT");
    await expectAppError(
      costs.updateCostHead(env.pmCtx, knitting.id, { name: "Sewing (CM)" }),
      "CONFLICT",
    );
    await costs.updateCostHead(env.pmCtx, knitting.id, { isActive: false });
    expect((await costs.listCostHeads(env.pmCtx)).map((h) => h.name)).not.toContain("Knitting");
    expect(
      (await costs.listCostHeads(env.pmCtx, { includeInactive: "true" })).map((h) => h.name),
    ).toContain("Knitting");
  });
});

run("move to stock", () => {
  beforeEach(resetDb);

  it("receives A and B grade pieces, costs them into stock and re-weights average cost", async () => {
    const env = await setup();
    const project = await newProject(env, { targetQuantity: 100 });
    await dueBill(env, project.id, 10000);
    const navyM = env.sku("Navy", "M");
    await stock.adjustStock(env.ctx, {
      variantId: navyM,
      quantity: 10,
      type: "OPENING",
      unitCost: 50,
    });

    // The warehouse types in what arrived: A-grade per size, plus 5 B-grade.
    const draft = await intakes.createIntake(env.warehouseCtx, {
      projectId: project.id,
      matrix: [
        {
          styleId: env.style.id,
          quantities: {
            [env.sku("Navy", "S")]: 10,
            [navyM]: 20,
            [env.sku("Navy", "L")]: 20,
            [env.sku("White", "S")]: 0,
          },
        },
        { styleId: env.style.id, grade: "B_GRADE", quantities: { [navyM]: 5 } },
      ],
      costAllocation: "B_GRADE_RATIO",
    });
    expect(draft).toMatchObject({
      number: expect.stringMatching(/^GRN-\d{4}-00001$/),
      status: "DRAFT",
      method: "MANUAL",
      pieces: { total: 55, aGrade: 50, bGrade: 5 },
      totalCost: null, // the warehouse does not see costs
      costPreview: null,
      aiError: null,
      warehouse: { id: env.warehouse.id },
    });
    expect(draft.bGradeCostRatio?.toFixed(2)).toBe("0.50");
    expect(draft.lines.map((l) => [l.sku, l.grade, l.quantity, l.unitCost])).toEqual([
      ["EX-PL-001-NAVY-S", "A_GRADE", 10, null],
      ["EX-PL-001-NAVY-M", "A_GRADE", 20, null],
      ["EX-PL-001-NAVY-M", "B_GRADE", 5, null],
      ["EX-PL-001-NAVY-L", "A_GRADE", 20, null],
    ]);

    // Production sees what confirming will move into stock: 55 of the 100 pieces.
    const preview = (await intakes.getIntake(env.pmCtx, draft.id)).costPreview as {
      projectCostRemaining: Prisma.Decimal;
      thisDelivery: { totalCost: Prisma.Decimal };
      asFinalDelivery: { totalCost: Prisma.Decimal };
    };
    expect(preview.projectCostRemaining.toFixed(2)).toBe("10000.00");
    expect(preview.thisDelivery.totalCost.toFixed(2)).toBe("5500.00");
    expect(preview.asFinalDelivery.totalCost.toFixed(2)).toBe("10000.00");

    const received = await intakes.confirmIntake(env.warehouseCtx, draft.id);
    expect(received).toMatchObject({ status: "CONFIRMED", totalCost: null });
    const asProduction = await intakes.getIntake(env.pmCtx, draft.id);
    expect(asProduction.totalCost?.toFixed(2)).toBe("5500.00");
    // B-grade valued at half: 5,500 / (50 + 5 x 0.5) for each A-grade piece.
    expect(asProduction.lines.map((l) => [l.grade, l.unitCost?.toFixed(4)])).toEqual([
      ["A_GRADE", "104.7619"],
      ["A_GRADE", "104.7619"],
      ["B_GRADE", "52.3810"],
      ["A_GRADE", "104.7619"],
    ]);

    expect(await cell(env, navyM)).toMatchObject({ aGrade: 30, bGrade: 5 });
    expect(await cell(env, env.sku("Navy", "L"))).toMatchObject({ aGrade: 20, bGrade: 0 });
    // Navy M: 10 on hand at 50, then 20 x 104.7619 and 5 x 52.3810.
    expect(await avgCost(navyM)).toBe("81.6327");
    expect(await avgCost(env.sku("Navy", "S"))).toBe("104.7619");
    // 500 of opening stock (10 Navy M at 50) plus the 5,500 received.
    expect(await accountBalance(env.company.id, INVENTORY)).toBe("6000.00");
    expect(await accountBalance(env.company.id, WIP)).toBe("4500.00");
    const movements = await prisma.stockMovement.findMany({
      where: { referenceType: "StockIntake", referenceId: draft.id },
    });
    expect(movements.map((m) => m.type)).toEqual(Array(4).fill("PRODUCTION_IN"));
    expect(movements.reduce((s, m) => s + m.quantity, 0)).toBe(55);

    const afterFirst = await projects.getProject(env.pmCtx, project.id);
    expect(afterFirst.quantities).toEqual({
      target: 100,
      producedA: 50,
      producedB: 5,
      produced: 55,
      remaining: 45,
    });
    expect(afterFirst.deliveries).toMatchObject([
      { number: draft.number, status: "CONFIRMED", pieces: 55, bGradePieces: 5 },
    ]);
    expect(afterFirst.costs?.inStock.toFixed(2)).toBe("5500.00");
    await expectAppError(intakes.confirmIntake(env.warehouseCtx, draft.id), "CONFLICT");
    await expectAppError(
      intakes.updateIntake(env.warehouseCtx, draft.id, { notes: "Late edit" }),
      "CONFLICT",
    );

    // The last delivery takes the rest of the cost; Production completes the project with it.
    const last = await intakes.createIntake(env.warehouseCtx, {
      projectId: project.id,
      lines: [{ variantId: env.sku("Navy", "XL"), quantity: 45 }],
    });
    await expectAppError(
      intakes.confirmIntake(env.warehouseCtx, last.id, { completeProject: true }),
      "FORBIDDEN",
    );
    await intakes.confirmIntake(env.pmCtx, last.id, { completeProject: true });
    expect(await avgCost(env.sku("Navy", "XL"))).toBe("100.0000");
    const done = await projects.getProject(env.pmCtx, project.id);
    expect(done).toMatchObject({
      status: "COMPLETED",
      stage: { key: "COMPLETED" },
      timeline: { remainingDays: null, health: "COMPLETED" },
    });
    expect(done.completedAt).not.toBeNull();
    expect(done.stageHistory.at(-1)?.label).toBe("Completed");
    const sheet = await costs.getProjectCostSheet(env.pmCtx, project.id);
    expect(sheet.summary.wip.toFixed(2)).toBe("0.00");
    expect(sheet.summary.actualCostPerPiece?.toFixed(2)).toBe("100.00");
    expect(await accountBalance(env.company.id, WIP)).toBe("0.00");
    expect((await projects.getProductionOverview(env.pmCtx)).counts.completedThisMonth).toBe(1);
    await expectBooksBalanced(env.company.id);
  });

  it("costs partial deliveries against what is still due; only Accounts writes off the rest", async () => {
    const env = await setup();
    const project = await newProject(env, { targetQuantity: 1000 });
    await dueBill(env, project.id, 20000);
    const navyS = env.sku("Navy", "S");
    const draftOf = (projectId: string, quantity: number) =>
      intakes.createIntake(env.pmCtx, { projectId, lines: [{ variantId: navyS, quantity }] });

    // 300 of 1,000 pieces take 30% of the cost.
    const first = await draftOf(project.id, 300);
    expect((await intakes.confirmIntake(env.pmCtx, first.id)).totalCost?.toFixed(2)).toBe(
      "6000.00",
    );
    // A typed total cannot take more than is left.
    const second = await draftOf(project.id, 200);
    await expectAppError(
      intakes.confirmIntake(env.pmCtx, second.id, { totalCost: 14000.01 }),
      "VALIDATION",
    );
    const typed = await intakes.confirmIntake(env.pmCtx, second.id, { totalCost: 5000 });
    expect(typed.totalCost?.toFixed(2)).toBe("5000.00");
    expect(await avgCost(navyS)).toBe("22.0000"); // (300 x 20 + 200 x 25) / 500

    // The factory stops at 500 pieces: 9,000 of cost will never reach stock.
    await expectAppError(projects.completeProject(env.pmCtx, project.id), "CONFLICT");
    await expectAppError(
      projects.completeProject(env.pmCtx, project.id, {
        writeOffReason: "Factory closed after 500 pcs",
      }),
      "FORBIDDEN",
    );
    const closed = await projects.completeProject(env.accountsCtx, project.id, {
      writeOffReason: "Factory closed after 500 pcs",
    });
    expect(closed.status).toBe("COMPLETED");
    expect(closed.costs?.writtenOff.toFixed(2)).toBe("9000.00");
    expect(closed.costs?.wip.toFixed(2)).toBe("0.00");
    expect(await accountBalance(env.company.id, LOSS)).toBe("9000.00");
    expect(await accountBalance(env.company.id, WIP)).toBe("0.00");
    expect(await balanceOf(env, env.mill.id)).toBe("-20000.00"); // the mill is still owed

    // A completed project takes no more costs or deliveries; only its name and notes change.
    await expectAppError(dueBill(env, project.id, 100), "CONFLICT");
    const bill = (await costs.listBills(env.pmCtx, { projectId: project.id })).items[0]!;
    await expectAppError(
      costs.voidBill(env.pmCtx, bill.id, { reason: "Too late now" }),
      "CONFLICT",
    );
    await expectAppError(draftOf(project.id, 1), "CONFLICT");
    await expectAppError(
      projects.updateProject(env.pmCtx, project.id, { targetQuantity: 500 }),
      "CONFLICT",
    );
    expect(
      (await projects.updateProject(env.pmCtx, project.id, { notes: "Short shipped" })).notes,
    ).toBe("Short shipped");
    await expectAppError(
      projects.cancelProject(env.accountsCtx, project.id, { reason: "Already completed" }),
      "CONFLICT",
    );

    // Cancelling writes the cost off (Accounts) and drops open deliveries.
    const dropped = await newProject(env, { name: "Cancelled run", targetQuantity: 200 });
    await dueBill(env, dropped.id, 3000);
    const open = await draftOf(dropped.id, 10);
    await expectAppError(
      projects.cancelProject(env.pmCtx, dropped.id, { reason: "Buyer cancelled the order" }),
      "FORBIDDEN",
    );
    const cancelled = await projects.cancelProject(env.accountsCtx, dropped.id, {
      reason: "Buyer cancelled the order",
    });
    expect(cancelled).toMatchObject({ status: "CANCELLED", timeline: { health: "CANCELLED" } });
    expect((await intakes.getIntake(env.pmCtx, open.id)).status).toBe("CANCELLED");
    expect(await accountBalance(env.company.id, LOSS)).toBe("12000.00");
    // With no cost to write off, Production can cancel on its own.
    const unused = await newProject(env, { name: "Never started" });
    expect(
      (await projects.cancelProject(env.pmCtx, unused.id, { reason: "Not needed any more" }))
        .status,
    ).toBe("CANCELLED");

    // Pieces with no cost behind them need a deliberate "allow zero cost".
    const samples = await newProject(env, { name: "Samples", targetQuantity: 10 });
    const free = await draftOf(samples.id, 10);
    await expectAppError(intakes.confirmIntake(env.pmCtx, free.id), "VALIDATION");
    const zero = await intakes.confirmIntake(env.pmCtx, free.id, { allowZeroCost: true });
    expect(zero.totalCost?.toFixed(2)).toBe("0.00");
    expect(
      await prisma.journalEntry.count({ where: { sourceType: "STOCK_INTAKE", sourceId: free.id } }),
    ).toBe(0);

    // Manual costing: the cost per piece is typed in.
    const manual = await newProject(env, { name: "Manual costing", targetQuantity: 100 });
    await dueBill(env, manual.id, 5000);
    const whiteL = env.sku("White", "L");
    const counted = await intakes.createIntake(env.pmCtx, {
      projectId: manual.id,
      costAllocation: "MANUAL",
      lines: [
        { variantId: whiteL, quantity: 60, unitCost: 45 },
        { variantId: whiteL, grade: "B_GRADE", quantity: 40, unitCost: 25 },
      ],
    });
    const costed = await intakes.confirmIntake(env.pmCtx, counted.id);
    expect(costed.totalCost?.toFixed(2)).toBe("3700.00"); // 60 x 45 + 40 x 25
    expect(await avgCost(whiteL)).toBe("37.0000");
    expect((await costs.getProjectCostSheet(env.pmCtx, manual.id)).summary.wip.toFixed(2)).toBe(
      "1300.00",
    );

    await expectBooksBalanced(env.company.id);
    await expectWipMatchesProjects(env);
  });

  it("reads a packing-list photo with AI and keeps unreadable lines for a person to check", async () => {
    const env = await setup();
    const uploads = await mkdtemp(path.join(os.tmpdir(), "extras-uploads-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    try {
      const project = await newProject(env, { targetQuantity: 200 });
      await dueBill(env, project.id, 4000);

      await expectAppError(
        files.storeUpload(env.warehouseCtx, { fileName: "notes.txt", bytes: Buffer.from("hello") }),
        "VALIDATION",
      );
      const photo = Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
        Buffer.from("factory packing list"),
      ]);
      const file = await files.storeUpload(env.warehouseCtx, {
        fileName: "C:\\phone\\IMG_2041.jpg",
        bytes: photo,
      });
      expect(file).toMatchObject({
        fileName: "IMG_2041.jpg",
        mimeType: "image/jpeg",
        sizeBytes: photo.length,
      });
      const stored = await prisma.fileAsset.findUniqueOrThrow({ where: { id: file.id } });
      expect(stored.storagePath.startsWith(`${env.company.id}/`)).toBe(true);
      expect((await readFile(path.join(uploads, stored.storagePath))).equals(photo)).toBe(true);

      const parse = vi.fn<IntakeParser["parse"]>(async () => ({
        lines: [
          {
            sku: null,
            styleCode: "EX-PL-001",
            color: "Navy",
            size: "M",
            quantity: 120,
            grade: "A_GRADE",
          },
          {
            sku: "EX-PL-001-NAVY-S",
            styleCode: null,
            color: null,
            size: null,
            quantity: 8,
            grade: "B_GRADE",
          },
          {
            sku: null,
            styleCode: null,
            color: "Navy",
            size: "Medium",
            quantity: 30,
            grade: "A_GRADE",
          },
          { sku: null, styleCode: null, color: "Red", size: "M", quantity: 12, grade: "A_GRADE" },
        ],
        confidence: 0.87,
        notes: "Carton 4 is smudged",
        model: "test-reader",
      }));
      const parser: IntakeParser = { parse };

      const draft = await intakes.createIntake(
        env.warehouseCtx,
        { projectId: project.id, sourceFileId: file.id },
        undefined,
        parser,
      );
      expect(draft).toMatchObject({
        status: "PARSED",
        method: "AI_OCR",
        aiError: null,
        sourceFile: { id: file.id, fileName: "IMG_2041.jpg" },
        pieces: { total: 158, aGrade: 150, bGrade: 8 },
      });
      expect(draft.lines.map((l) => [l.sku, l.grade, l.quantity])).toEqual([
        ["EX-PL-001-NAVY-S", "B_GRADE", 8],
        ["EX-PL-001-NAVY-M", "A_GRADE", 150],
      ]);
      expect(draft.ai).toMatchObject({
        model: "test-reader",
        notes: "Carton 4 is smudged",
        unmatched: [
          { color: "Red", quantity: 12, reason: "Red / M is not in this style's matrix" },
        ],
      });
      expect(draft.ai?.confidencePercent?.toFixed(2)).toBe("87.00");
      const [sent, hints] = parse.mock.calls[0]!;
      expect(sent).toMatchObject({ mimeType: "image/jpeg", fileName: "IMG_2041.jpg" });
      expect(sent.bytes.equals(photo)).toBe(true);
      expect(hints).toMatchObject({
        projectStyle: { code: "EX-PL-001", name: "Classic Polo" },
        colors: ["Navy", "White"],
        sizes: ["S", "M", "L", "XL"],
      });

      // A person corrects the reading before anything is stocked.
      const checked = await intakes.updateIntake(env.warehouseCtx, draft.id, {
        lines: [
          { variantId: env.sku("Navy", "M"), quantity: 150 },
          { variantId: env.sku("Navy", "S"), grade: "B_GRADE", quantity: 8 },
          { variantId: env.sku("White", "M"), quantity: 12 }, // the "Red" line was White
        ],
      });
      expect(checked.pieces).toEqual({ total: 170, aGrade: 162, bGrade: 8 });
      expect((await intakes.confirmIntake(env.warehouseCtx, draft.id)).status).toBe("CONFIRMED");
      expect(await cell(env, env.sku("Navy", "M"))).toMatchObject({ aGrade: 150 });
      // 170 of the 200 pieces: 85% of the 4,000 cost.
      expect((await intakes.getIntake(env.pmCtx, draft.id)).totalCost?.toFixed(2)).toBe("3400.00");

      // Without the AI reader set up, the draft is kept so quantities can be typed in.
      const typedIn = await intakes.createIntake(
        env.warehouseCtx,
        { projectId: project.id, sourceFileId: file.id },
        undefined,
        null,
      );
      expect(typedIn).toMatchObject({ status: "DRAFT", pieces: { total: 0 } });
      expect(typedIn.aiError).toContain("AI_API_KEY");
      await expectAppError(
        intakes.parseIntake(env.warehouseCtx, typedIn.id, undefined, null),
        "UNAVAILABLE",
      );
      const noFile = await intakes.createIntake(env.warehouseCtx, {
        projectId: project.id,
        lines: [{ variantId: env.sku("Navy", "L"), quantity: 1 }],
      });
      await expectAppError(
        intakes.parseIntake(env.warehouseCtx, noFile.id, undefined, parser),
        "VALIDATION",
      );
      expect((await intakes.cancelIntake(env.warehouseCtx, noFile.id)).status).toBe("CANCELLED");
      await expectAppError(intakes.confirmIntake(env.warehouseCtx, noFile.id), "CONFLICT");
      expect(
        (await intakes.listIntakes(env.warehouseCtx, { projectId: project.id })).items.map(
          (i) => i.status,
        ),
      ).toEqual(["CANCELLED", "DRAFT", "CONFIRMED"]);

      // The photo opens for people who can see the delivery, and only in its company.
      const download = await files.getFileForDownload(env.pmCtx, file.id);
      expect(download.asset).toMatchObject({ fileName: "IMG_2041.jpg", mimeType: "image/jpeg" });
      expect(download.bytes.equals(photo)).toBe(true);
      await expectAppError(files.getFileForDownload(env.salesCtx, file.id), "FORBIDDEN");
      const other = await setup("Other Co");
      await expectAppError(files.getFileForDownload(other.ctx, file.id), "NOT_FOUND");
    } finally {
      vi.unstubAllEnvs();
      await rm(uploads, { recursive: true, force: true });
    }
  });
});

run("production with sales", () => {
  beforeEach(resetDb);

  it("starts production from a proforma advance and sells the goods at their production cost", async () => {
    const env = await setup();
    const q = await quotations.createQuotation(env.salesCtx, {
      partyId: env.buyer.id,
      items: [
        {
          categoryId: env.tops.id,
          styleId: env.style.id,
          description: "White polo pre-order",
          sizeBreakdown: { S: 2, M: 4, L: 4, XL: 2 },
          unitPrice: 1000,
        },
      ],
    });
    const pi = await proformas.convertQuotationToProforma(env.salesCtx, q.id);
    await expectAppError(
      payments.receivePayment(env.salesCtx, { proformaId: pi.id, amount: 3600, method: "CASH" }),
      "FORBIDDEN",
    );
    const advance = await payments.receivePayment(env.accountsCtx, {
      proformaId: pi.id,
      amount: 3600,
      method: "BANK_TRANSFER",
    });
    const projectId = advance.productionProject!.id;
    const project = await projects.getProject(env.pmCtx, projectId);
    expect(project).toMatchObject({
      status: "ACTIVE",
      buyer: { id: env.buyer.id },
      proforma: { id: pi.id, status: "IN_PRODUCTION" },
      style: { id: env.style.id },
      category: { id: env.tops.id },
      quantities: { target: 12 },
      timeline: { remainingDays: 45 },
    });
    await expectAppError(
      projects.updateProject(env.pmCtx, projectId, { buyerId: null }),
      "CONFLICT",
    );

    // Production records its costs; the warehouse receives the goods.
    await costs.createBill(env.pmCtx, {
      supplierId: env.factory.id,
      paymentType: "DUE",
      allocations: [
        { projectId, expenseHeadId: env.heads.Fabric, amount: 1200 },
        { projectId, expenseHeadId: env.heads["Sewing (CM)"], amount: 2400 },
      ],
    });
    const white = (size: string) => env.sku("White", size);
    const sizes = { [white("S")]: 2, [white("M")]: 4, [white("L")]: 4, [white("XL")]: 2 };
    const delivery = await intakes.createIntake(env.warehouseCtx, {
      projectId,
      matrix: [{ styleId: env.style.id, quantities: sizes }],
    });
    await intakes.confirmIntake(env.warehouseCtx, delivery.id, { finalDelivery: true });
    expect((await projects.completeProject(env.pmCtx, projectId)).status).toBe("COMPLETED");
    expect(await avgCost(white("M"))).toBe("300.0000");

    // The goods go to the buyer and cost of sales is the production cost.
    const order = await proformas.convertProformaToOrder(env.salesCtx, pi.id, {
      matrix: [{ styleId: env.style.id, unitPrice: 1000, quantities: sizes }],
    });
    await documents.createDeliveryChallan(env.salesCtx, order.id);
    expect(await accountBalance(env.company.id, COGS)).toBe("3600.00");
    expect(await accountBalance(env.company.id, INVENTORY)).toBe("0.00");
    expect(await accountBalance(env.company.id, WIP)).toBe("0.00");
    expect(await cell(env, white("M"))).toMatchObject({ aGrade: 0, reserved: 0 });
    expect(await balanceOf(env, env.factory.id)).toBe("-3600.00");
    await expectBooksBalanced(env.company.id);
  });
});

run("production company isolation", () => {
  beforeEach(resetDb);

  it("keeps each company's projects, bills and deliveries apart", async () => {
    const a = await setup("Extras");
    const b = await setup("Fabric Apparel");
    const project = await newProject(a);
    const bill = await dueBill(a, project.id, 1000);
    const intake = await intakes.createIntake(a.pmCtx, {
      projectId: project.id,
      lines: [{ variantId: a.sku("Navy", "S"), quantity: 5 }],
    });

    await expectAppError(projects.getProject(b.pmCtx, project.id), "NOT_FOUND");
    await expectAppError(
      projects.setProjectStage(b.pmCtx, project.id, { stage: "CUTTING" }),
      "NOT_FOUND",
    );
    await expectAppError(
      projects.cancelProject(b.ctx, project.id, { reason: "Not ours at all" }),
      "NOT_FOUND",
    );
    await expectAppError(costs.getBill(b.pmCtx, bill.id), "NOT_FOUND");
    await expectAppError(
      costs.payBill(b.accountsCtx, bill.id, { amount: 1, method: "CASH" }),
      "NOT_FOUND",
    );
    await expectAppError(
      costs.voidBill(b.ctx, bill.id, { reason: "Not ours at all" }),
      "NOT_FOUND",
    );
    await expectAppError(dueBill(b, project.id, 500), "NOT_FOUND"); // b's mill, a's project
    await expectAppError(costs.getProjectCostSheet(b.pmCtx, project.id), "NOT_FOUND");
    await expectAppError(
      intakes.createIntake(b.pmCtx, {
        projectId: project.id,
        lines: [{ variantId: b.sku("Navy", "S"), quantity: 1 }],
      }),
      "NOT_FOUND",
    );
    await expectAppError(intakes.getIntake(b.pmCtx, intake.id), "NOT_FOUND");
    await expectAppError(intakes.confirmIntake(b.pmCtx, intake.id), "NOT_FOUND");
    await expectAppError(intakes.cancelIntake(b.pmCtx, intake.id), "NOT_FOUND");
    // a's SKU cannot be received into b's project.
    const own = await newProject(b);
    await expectAppError(
      intakes.createIntake(b.pmCtx, {
        projectId: own.id,
        lines: [{ variantId: a.sku("Navy", "S"), quantity: 1 }],
      }),
      "VALIDATION",
    );

    expect((await projects.listProjects(b.pmCtx)).items.map((p) => p.id)).toEqual([own.id]);
    expect((await projects.getProductionOverview(b.pmCtx)).projects.map((p) => p.id)).toEqual([
      own.id,
    ]);
    expect((await costs.listBills(b.pmCtx)).items).toEqual([]);
    expect((await intakes.listIntakes(b.pmCtx)).items).toEqual([]);
    expect(await costs.listCostHeads(b.pmCtx)).toHaveLength(10);
    expect((await intakes.getIntake(a.pmCtx, intake.id)).status).toBe("DRAFT");
    await expectBooksBalanced(a.company.id);
    await expectBooksBalanced(b.company.id);
  });
});
