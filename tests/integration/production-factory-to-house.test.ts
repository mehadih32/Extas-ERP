import type { Prisma, StockGrade } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { stockValuation } from "@/modules/accounts/reports.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as costs from "@/modules/production/cost.service";
import * as intakes from "@/modules/production/intake.service";
import * as projects from "@/modules/production/project.service";
import * as screens from "@/modules/production/screens.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";
const INVENTORY = "1300";
const WIP = "1350";
const COGS = "5000";

function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A company with a polo style (Navy / White x S M L), a factory, a fabric mill,
 * one person per production role, and a project making 100 pieces by colour
 * and size: Navy M 40, Navy L 30, White M 30. Its fabric costs 10,000.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const ctx = await member("SUPER_ADMIN", "admin");
  const pmCtx = await member("PRODUCTION_MANAGER", "production");
  const accountsCtx = await member("ACCOUNTS", "accounts");
  const warehouseCtx = await member("WAREHOUSE_TEAM", "warehouse");

  const sizes = [];
  for (const name of ["S", "M", "L"]) sizes.push(await catalog.createSize(ctx, { name }));
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
  const heads = Object.fromEntries(
    (await costs.listCostHeads(ctx)).map((h) => [h.name, h.id]),
  ) as Record<string, string>;

  const project = await projects.createProject(pmCtx, {
    name: "Classic Polo for Rahim",
    factoryId: factory.id,
    targetDate: dayFromToday(30),
    targets: [
      { variantId: sku("Navy", "M"), quantity: 40 },
      { variantId: sku("Navy", "L"), quantity: 30 },
      { variantId: sku("White", "M"), quantity: 30 },
    ],
  });
  const cost = (headName: string, amount: number) =>
    costs.addProjectCost(pmCtx, project.id, {
      expenseHeadId: heads[headName]!,
      amount,
      paymentType: "DUE",
      supplierId: mill.id,
      allowDuplicate: true,
    });
  await cost("Fabric", 10000);
  return { ctx, pmCtx, accountsCtx, warehouseCtx, company, style, sku, project, cost };
}

type Env = Awaited<ReturnType<typeof setup>>;
type Line = { variantId: string; quantity: number; grade?: StockGrade };

const receive = (env: Env, lines: Line[], extra: Record<string, unknown> = {}) =>
  intakes.createIntake(env.warehouseCtx, { projectId: env.project.id, lines, ...extra });

async function accountBalance(companyId: string, code: string) {
  const rows = await prisma.$queryRaw<Array<{ balance: Prisma.Decimal | null }>>`
    SELECT SUM(jl.debit - jl.credit) AS balance
    FROM "JournalLine" jl JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE la."companyId" = ${companyId} AND la.code = ${code}`;
  return Number(rows[0]?.balance ?? 0).toFixed(2);
}

/** The Inventory ledger account equals the stock on hand at each SKU grade's average cost. */
async function expectInventoryMatchesStock(env: Env) {
  const books = Number(await accountBalance(env.company.id, INVENTORY));
  const value = Number(await stockValuation(env.company.id));
  expect(Math.abs(books - value)).toBeLessThan(0.01);
}

const avgCost = async (variantId: string, grade: StockGrade = "A_GRADE") => {
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  return (grade === "B_GRADE" ? v.bGradeAvgCost : v.avgCost).toFixed(2);
};

/** What each confirmed delivery line of the project costs a piece now. */
async function lineCosts(env: Env) {
  const lines = await prisma.stockIntakeLine.findMany({
    where: { intake: { projectId: env.project.id, status: "CONFIRMED" } },
    select: { quantity: true, unitCost: true, costAdjustment: true },
  });
  return [
    ...new Set(
      lines.map((l) => l.unitCost.plus(l.costAdjustment.dividedBy(l.quantity)).toFixed(2)),
    ),
  ];
}

run("Factory to House: receiving, wastage and one cost per piece", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("opens the receiving grid on the project's target grid with what is still to come", async () => {
    const env = await setup();
    const navyM = env.sku("Navy", "M");

    const form = await screens.getIntakeForm(env.warehouseCtx, { projectId: env.project.id });
    expect(form.blocks.map((b) => b.matrix.style.code)).toEqual(["EX-PL-001"]);
    expect(form.plan).toEqual({
      [navyM]: { target: 40, received: 0 },
      [env.sku("Navy", "L")]: { target: 30, received: 0 },
      [env.sku("White", "M")]: { target: 30, received: 0 },
    });

    // A confirmed delivery counts as received; a draft does not.
    const first = await receive(env, [{ variantId: navyM, quantity: 25 }]);
    await intakes.confirmIntake(env.warehouseCtx, first.id);
    const draft = await receive(env, [{ variantId: navyM, quantity: 15, grade: "B_GRADE" }]);
    const edit = await screens.getIntakeForm(env.warehouseCtx, { intakeId: draft.id });
    expect(edit.plan[navyM]).toEqual({ target: 40, received: 25 });
    expect(edit.blocks).toHaveLength(1);
    expect(edit.blocks[0]!.b).toEqual({ [navyM]: 15 });

    // A project with only a total opens on its style, with no plan.
    const plain = await projects.createProject(env.pmCtx, {
      name: "Plain run",
      styleId: env.style.id,
      targetDate: dayFromToday(30),
      targetQuantity: 50,
    });
    const plainForm = await screens.getIntakeForm(env.warehouseCtx, { projectId: plain.id });
    expect(plainForm.blocks.map((b) => b.matrix.style.id)).toEqual([env.style.id]);
    expect(plainForm.plan).toEqual({});
  });

  it("evens every piece out to total ÷ received on completing, lists the short pieces as wastage, and puts it back if a delivery is undone", async () => {
    const env = await setup();
    const navyM = env.sku("Navy", "M");
    const navyL = env.sku("Navy", "L");
    const whiteM = env.sku("White", "M");

    // First delivery: 60 of 100 pieces take 60% of the 10,000 so far, 100 a piece.
    const first = await receive(env, [
      { variantId: navyM, quantity: 40 },
      { variantId: whiteM, quantity: 20 },
    ]);
    expect((await intakes.confirmIntake(env.pmCtx, first.id)).totalCost?.toFixed(2)).toBe(
      "6000.00",
    );
    expect(await avgCost(navyM)).toBe("100.00");

    // 10 Navy M leave stock; a late transport bill adds 1,000 to the project.
    await stock.adjustStock(env.ctx, { variantId: navyM, quantity: -10 });
    await env.cost("Production Transport", 1000);

    // The project screen tells what completing now would mean.
    const before = await screens.getProjectScreen(env.pmCtx, env.project.id);
    expect(before.completion).toEqual({ short: 40, perPiece: { a: "100.00", b: null } });
    expect(before.costs!.evened).toBe(false);

    // The factory's last delivery is 10 short: 30 pieces, one of them B-grade.
    const last = await receive(env, [
      { variantId: navyL, quantity: 24 },
      { variantId: navyL, quantity: 1, grade: "B_GRADE" },
      { variantId: whiteM, quantity: 5 },
    ]);
    const preview = await screens.getIntakeScreen(env.pmCtx, last.id);
    expect(preview.completion).toEqual({
      target: 100,
      received: 90,
      short: 10,
      perPiece: { a: "122.22", b: "122.22" },
    });
    expect(preview.can.completeProject).toBe(true);
    // The store cannot complete a project, so it is not told.
    expect((await screens.getIntakeScreen(env.warehouseCtx, last.id)).completion).toBeNull();

    await intakes.confirmIntake(env.pmCtx, last.id, { completeProject: true });

    // Every piece received now costs 11,000 ÷ 90 = 122.22, whichever delivery brought it.
    expect(await lineCosts(env)).toEqual(["122.22"]);
    expect(await avgCost(navyM)).toBe("122.22");
    expect(await avgCost(navyL)).toBe("122.22");
    expect(await avgCost(navyL, "B_GRADE")).toBe("122.22");
    expect(await avgCost(whiteM)).toBe("122.22");
    // The 10 Navy M pieces that had left went out 22.22 too cheap each: that goes to cost of goods sold.
    expect(await accountBalance(env.company.id, COGS)).toBe("222.22");
    expect(await accountBalance(env.company.id, WIP)).toBe("0.00");
    await expectInventoryMatchesStock(env);
    const entry = await prisma.journalEntry.findFirstOrThrow({
      where: {
        companyId: env.company.id,
        description: { startsWith: "Cost per piece evened out" },
      },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(entry).toMatchObject({ sourceType: "PRODUCTION", sourceId: env.project.id });
    expect(
      entry.lines.map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)]),
    ).toEqual([
      [COGS, "222.22", "0.00"],
      [INVENTORY, "0.00", "222.22"],
    ]);

    // The pieces short are wastage: listed per colour and size, no loss booked.
    const page = await screens.getProjectScreen(env.pmCtx, env.project.id);
    expect(page.project.status).toBe("COMPLETED");
    expect(page.project.targets).toMatchObject({ target: 100, received: 90, short: 10 });
    const grid = page.project.targets!.styles[0]!;
    expect(grid.rows.map((r) => [r.color.name, r.cells.map((c) => c?.short ?? null)])).toEqual([
      ["Navy", [0, 5]],
      ["White", [5, null]],
    ]);
    expect(page.costs).toMatchObject({
      evened: true,
      inStock: "11000.00",
      writtenOff: "0.00",
      grades: { a: { pieces: 89, perPiece: "122.22" }, b: { pieces: 1, perPiece: "122.22" } },
    });
    expect(await accountBalance(env.company.id, "5100")).toBe("0.00");
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: env.project.id, summary: { startsWith: "Completed" } },
    });
    expect(audit.summary).toBe(
      `Completed ${env.project.code}: 90 of 100 pcs received, 10 short (wastage); every piece evened out to 122.22`,
    );
    // Each delivery shows the one cost its pieces were evened out to.
    const firstPage = await screens.getIntakeScreen(env.accountsCtx, first.id);
    expect(firstPage.costs).toMatchObject({
      perPiece: { a: "100.00", b: null },
      evened: { a: "122.22", b: null },
    });
    expect((await screens.getIntakeScreen(env.warehouseCtx, first.id)).costs).toBeNull();

    // Undoing the last delivery reopens the project and puts the costs back first.
    await intakes.reverseIntake(env.pmCtx, last.id, { reason: "Counted the wrong cartons" });
    const reopened = await prisma.productionProject.findUniqueOrThrow({
      where: { id: env.project.id },
    });
    expect(reopened.status).toBe("ACTIVE");
    expect(await lineCosts(env)).toEqual(["100.00"]);
    expect(await avgCost(navyM)).toBe("100.00");
    expect(await avgCost(whiteM)).toBe("100.00");
    expect(await accountBalance(env.company.id, COGS)).toBe("0.00");
    expect(await accountBalance(env.company.id, WIP)).toBe("5000.00");
    await expectInventoryMatchesStock(env);

    // Received again and completed again: evened out anew.
    const again = await receive(env, [
      { variantId: navyL, quantity: 25 },
      { variantId: whiteM, quantity: 5 },
    ]);
    await intakes.confirmIntake(env.pmCtx, again.id, { completeProject: true });
    expect(await lineCosts(env)).toEqual(["122.22"]);
    expect(await accountBalance(env.company.id, COGS)).toBe("222.22");
    await expectInventoryMatchesStock(env);
  });

  it("keeps B-grade at its share, keeps typed costs, and evens out after a write-off", async () => {
    const env = await setup();
    const navyL = env.sku("Navy", "L");
    const ratio = { costAllocation: "B_GRADE_RATIO", bGradeCostRatio: 0.5 };

    // A B-grade piece carries half an A-grade one's cost.
    const first = await receive(
      env,
      [
        { variantId: env.sku("Navy", "M"), quantity: 40 },
        { variantId: navyL, quantity: 20 },
        { variantId: navyL, quantity: 20, grade: "B_GRADE" },
      ],
      ratio,
    );
    await intakes.confirmIntake(env.pmCtx, first.id);
    expect(await avgCost(navyL, "B_GRADE")).toBe("57.14");
    const last = await receive(env, [{ variantId: env.sku("White", "M"), quantity: 10 }], ratio);
    await intakes.confirmIntake(env.pmCtx, last.id, { completeProject: true });
    // 70 A-grade and 20 B-grade at half: 80 shares of 10,000, 125 and 62.50.
    const page = await screens.getProjectScreen(env.pmCtx, env.project.id);
    expect(page.costs!.grades).toMatchObject({
      a: { pieces: 70, perPiece: "125.00" },
      b: { pieces: 20, perPiece: "62.50" },
    });
    expect(await avgCost(navyL)).toBe("125.00");
    expect(await avgCost(navyL, "B_GRADE")).toBe("62.50");
    await expectInventoryMatchesStock(env);

    // Typed costs (manual) on the last delivery are kept as they are.
    const fabric = (await costs.listCostHeads(env.ctx)).find((h) => h.name === "Fabric")!.id;
    const mill = await prisma.party.findFirstOrThrow({
      where: { companyId: env.company.id, name: "Narayanganj Fabrics" },
    });
    const plainProject = (name: string) =>
      projects.createProject(env.pmCtx, {
        name,
        styleId: env.style.id,
        targetDate: dayFromToday(30),
        targetQuantity: 10,
      });
    const manual = await plainProject("Manual run");
    await costs.addProjectCost(env.pmCtx, manual.id, {
      expenseHeadId: fabric,
      amount: 1000,
      paymentType: "DUE",
      supplierId: mill.id,
      allowDuplicate: true,
    });
    const typed = await intakes.createIntake(env.pmCtx, {
      projectId: manual.id,
      costAllocation: "MANUAL",
      lines: [{ variantId: env.sku("Navy", "S"), quantity: 8, unitCost: 95 }],
    });
    await intakes.confirmIntake(env.pmCtx, typed.id);
    await projects.completeProject(env.accountsCtx, manual.id, {
      writeOffReason: "Two pieces lost at the factory",
    });
    const kept = await prisma.stockIntakeLine.findMany({ where: { intakeId: typed.id } });
    expect(kept.map((l) => [l.unitCost.toFixed(2), l.costAdjustment.toFixed(2)])).toEqual([
      ["95.00", "0.00"],
    ]);
    const manualAudit = await prisma.auditLog.findFirstOrThrow({
      where: { entityId: manual.id, summary: { startsWith: "Completed" } },
    });
    expect(manualAudit.summary).toBe(
      `Completed ${manual.code}: 8 of 10 pcs received, 2 short (wastage), 240.00 written off (Two pieces lost at the factory)`,
    );

    // Accounts completes with a write-off: what reached stock is spread over the pieces.
    const short = await plainProject("Short run");
    await costs.addProjectCost(env.pmCtx, short.id, {
      expenseHeadId: fabric,
      amount: 1000,
      paymentType: "DUE",
      supplierId: mill.id,
      allowDuplicate: true,
    });
    const part = await intakes.createIntake(env.pmCtx, {
      projectId: short.id,
      lines: [{ variantId: env.sku("White", "S"), quantity: 4 }],
    });
    await intakes.confirmIntake(env.pmCtx, part.id);
    const screen = await screens.getProjectScreen(env.accountsCtx, short.id);
    expect(screen.completion).toEqual({ short: 6, perPiece: { a: "100.00", b: null } });
    expect((await screens.getProjectScreen(env.warehouseCtx, short.id)).completion).toEqual({
      short: 6,
      perPiece: null,
    });
    await projects.completeProject(env.accountsCtx, short.id, {
      writeOffReason: "The factory closed with 6 pieces unmade",
    });
    expect(await avgCost(env.sku("White", "S"))).toBe("100.00");
    await expectInventoryMatchesStock(env);
  });
});
