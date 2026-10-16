import type { Prisma, StockGrade } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";

import { localDay } from "@/lib/dates";
import { prisma } from "@/lib/prisma";
import { readOnly } from "@/lib/read-only";
import { ensureControlAccounts } from "@/modules/accounts/control-accounts";
import { postJournalEntry } from "@/modules/accounts/journal.service";
import * as reports from "@/modules/accounts/reports.service";
import { DATA_CHECKS } from "@/modules/bug-guard/checks/data";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as costs from "@/modules/production/cost.service";
import * as intakes from "@/modules/production/intake.service";
import * as projects from "@/modules/production/project.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

/*
 * Pieces sold before they are in stock (Sales' Force Override) leave at the
 * SKU grade's average cost of the day. When pieces come in at a cost while the
 * grade is below zero, the first of them are those sold pieces: the books move
 * the difference between Finished Goods Inventory and Cost of Goods Sold, so
 * the inventory account keeps matching the stock on hand at average cost.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";
const INVENTORY = "1300";
const COGS = "5000";
const TRUE_UP = "Cost of pieces sold before stock arrived";

/** A calendar day `n` days from today in company time. */
function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * A company with a linen shirt (White / Navy in M), a factory, a buyer, a Super
 * Admin and a Production Manager.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const ctx = await member("SUPER_ADMIN", "owner");
  const pmCtx = await member("PRODUCTION_MANAGER", "production");

  const medium = await catalog.createSize(ctx, { name: "M" });
  const white = await catalog.createColor(ctx, { name: "White", hexCode: "#FFFFFF" });
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const shirts = await catalog.createCategory(ctx, { name: "Shirts" });
  const style = await styles.createStyle(ctx, {
    code: "EX-LN-005",
    name: "Linen Shirt",
    categoryId: shirts.id,
    retailPrice: 2450,
    wholesalePrice: 1650,
  });
  await matrix.generateMatrix(ctx, style.id, {
    colorIds: [white.id, navy.id],
    sizeIds: [medium.id],
  });
  const variants = await prisma.productVariant.findMany({
    where: { styleId: style.id },
    include: { color: true },
  });
  const sku = (color: string) => variants.find((v) => v.color.name === color)!;
  const factory = (
    await parties.createParty(ctx, { kind: "SUPPLIER", name: "Gazipur Knit Factory" })
  ).party;
  const buyer = (
    await parties.createParty(ctx, { kind: "BUYER", name: "Rahim Traders", phone: "01711223344" })
  ).party;
  const heads = Object.fromEntries(
    (await costs.listCostHeads(ctx)).map((h) => [h.name, h.id]),
  ) as Record<string, string>;
  return {
    ctx,
    pmCtx,
    company,
    style,
    white: sku("White"),
    navy: sku("Navy"),
    factory,
    buyer,
    heads,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** An order taken past the stock with Force Override and delivered in full. */
async function sellShort(env: Env, variantId: string, quantity: number) {
  const order = await orders.createOrder(env.ctx, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    lines: [{ variantId, quantity }],
    forceOverride: { reason: "Factory delivers next week" },
  });
  await documents.createDeliveryChallan(env.ctx, order.id);
  return order;
}

/**
 * A production project whose costs come to `cost`, delivered in full (one
 * final delivery of `lines`) into the default warehouse or `warehouseId`.
 */
async function produce(
  env: Env,
  cost: number,
  lines: Array<{ variantId: string; quantity: number; grade?: StockGrade }>,
  options: { warehouseId?: string; bGradeRatio?: number } = {},
) {
  const pieces = lines.reduce((s, l) => s + l.quantity, 0);
  const project = await projects.createProject(env.pmCtx, {
    name: "Linen shirt run",
    styleId: env.style.id,
    factoryId: env.factory.id,
    targetDate: dayFromToday(45),
    targetQuantity: pieces,
  });
  await costs.createBill(env.pmCtx, {
    supplierId: env.factory.id,
    paymentType: "DUE",
    allocations: [{ projectId: project.id, expenseHeadId: env.heads.Fabric!, amount: cost }],
  });
  const draft = await intakes.createIntake(env.pmCtx, {
    projectId: project.id,
    lines,
    ...(options.bGradeRatio !== undefined
      ? { costAllocation: "B_GRADE_RATIO", bGradeCostRatio: options.bGradeRatio }
      : {}),
  });
  await intakes.confirmIntake(env.pmCtx, draft.id, {
    finalDelivery: true,
    warehouseId: options.warehouseId,
  });
  return { project, intake: draft };
}

/** Debit minus credit on a ledger account, e.g. "1300". */
async function accountBalance(env: Env, code: string) {
  const rows = await prisma.$queryRaw<Array<{ balance: Prisma.Decimal | null }>>`
    SELECT SUM(jl.debit - jl.credit) AS balance
    FROM "JournalLine" jl JOIN "LedgerAccount" la ON la.id = jl."accountId"
    WHERE la."companyId" = ${env.company.id} AND la.code = ${code}`;
  return Number(rows[0]?.balance ?? 0).toFixed(2);
}

/** Pieces of a SKU grade on hand in every warehouse. */
async function onHand(variantId: string, grade: StockGrade = "A_GRADE") {
  const sum = await prisma.stockBalance.aggregate({
    where: { variantId, grade },
    _sum: { quantity: true },
  });
  return sum._sum.quantity ?? 0;
}

/** A SKU grade's average cost, to 4 decimals. */
async function avgCost(variantId: string, grade: StockGrade = "A_GRADE") {
  const v = await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } });
  return (grade === "B_GRADE" ? v.bGradeAvgCost : v.avgCost).toFixed(4);
}

/** The true-up entries posted, oldest first, with their lines as [account, debit, credit]. */
async function trueUps(env: Env) {
  const entries = await prisma.journalEntry.findMany({
    where: { companyId: env.company.id, description: { startsWith: TRUE_UP } },
    include: { lines: { include: { account: { select: { code: true } } } } },
    orderBy: { number: "asc" },
  });
  return entries.map((e) => ({
    description: e.description,
    sourceType: e.sourceType,
    sourceId: e.sourceId,
    lines: e.lines
      .map((l) => [l.account.code, l.debit.toFixed(2), l.credit.toFixed(2)])
      .sort((a, b) => Number(b[1]) - Number(a[1])),
  }));
}

/** The stock movement that brought a delivery's pieces of one SKU grade in. */
const intakeMovement = (intakeId: string, variantId: string, grade: StockGrade = "A_GRADE") =>
  prisma.stockMovement.findFirstOrThrow({
    where: { referenceType: "StockIntake", referenceId: intakeId, variantId, grade },
  });

/**
 * The books match the stock register: Finished Goods Inventory equals the
 * pieces on hand at their grade's average cost, “Books check” finds nothing
 * wrong and neither does Bug Guard's comparison of the registers (nor its
 * check of each delivery's entry).
 */
async function expectBooksMatchStock(env: Env) {
  const books = Number(await accountBalance(env, INVENTORY));
  const register = Number(await reports.stockValuation(env.company.id));
  expect(Math.abs(books - register)).toBeLessThan(0.01);
  const check = await reports.getBooksCheck(env.ctx);
  expect(check.checks.filter((c) => !c.ok)).toEqual([]);
  expect(check.ok).toBe(true);
  // Bug Guard: the registers against the books, and each delivery against its entry.
  const checks = DATA_CHECKS.filter((c) =>
    ["data.stock.registers", "data.stock.intakes"].includes(c.key),
  );
  expect(checks).toHaveLength(2);
  const found = await readOnly("Bug Guard only reads", async () => {
    const all = [];
    for (const c of checks) {
      all.push(
        ...(await c.run({
          companyId: env.company.id,
          now: new Date(),
          since: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          platform: false,
          db: prisma,
        })),
      );
    }
    return all;
  });
  expect(found.map((f) => f.key)).toEqual([]);
}

run("pieces sold before stock arrived", () => {
  beforeEach(resetDb);

  it("costs them at the delivery's cost when it comes in (the demo copy's case)", async () => {
    const env = await setup();
    const sku = env.white.id;
    expect(env.white.sku).toBe("EX-LN-005-WHITE-M");
    await stock.adjustStock(env.ctx, {
      variantId: sku,
      quantity: 4,
      type: "OPENING",
      unitCost: 1100,
    });
    await sellShort(env, sku, 40);
    expect(await onHand(sku)).toBe(-36);
    await expectBooksMatchStock(env); // 4,400 - 44,000 = -36 x 1,100

    const { intake } = await produce(env, 39020.27, [{ variantId: sku, quantity: 70 }]);
    expect(await onHand(sku)).toBe(34);
    expect(await avgCost(sku)).toBe("557.4324");
    // 36 x (1,100 - 557.4324) went to Cost of Goods Sold that those pieces never cost.
    const movement = await intakeMovement(intake.id, sku);
    expect(await trueUps(env)).toEqual([
      {
        description: `${TRUE_UP} — EX-LN-005-WHITE-M × 36`,
        sourceType: "STOCK_ADJUSTMENT",
        sourceId: movement.id,
        lines: [
          [INVENTORY, "19532.43", "0.00"],
          [COGS, "0.00", "19532.43"],
        ],
      },
    ]);
    expect(await accountBalance(env, INVENTORY)).toBe("18952.70"); // 34 x 557.4324
    // The 40 sold: 4 at 1,100 and 36 at 557.4324.
    expect(await accountBalance(env, COGS)).toBe("24467.57");
    await expectBooksMatchStock(env);
  });

  it("charges the difference to Cost of Goods Sold when the pieces cost more", async () => {
    const env = await setup();
    const sku = env.white.id;
    await stock.adjustStock(env.ctx, {
      variantId: sku,
      quantity: 4,
      type: "OPENING",
      unitCost: 500,
    });
    await sellShort(env, sku, 10);
    await produce(env, 16000, [{ variantId: sku, quantity: 20 }]); // 800 each
    expect(await avgCost(sku)).toBe("800.0000");
    expect((await trueUps(env)).map((e) => [e.description, e.lines])).toEqual([
      [
        `${TRUE_UP} — EX-LN-005-WHITE-M × 6`,
        [
          [COGS, "1800.00", "0.00"],
          [INVENTORY, "0.00", "1800.00"],
        ],
      ],
    ]);
    expect(await accountBalance(env, INVENTORY)).toBe("11200.00"); // 14 x 800
    expect(await accountBalance(env, COGS)).toBe("6800.00"); // 4 x 500 + 6 x 800
    await expectBooksMatchStock(env);
  });

  it("keeps the average while stock stays below zero, and the next delivery costs the rest", async () => {
    const env = await setup();
    const sku = env.white.id;
    await stock.adjustStock(env.ctx, {
      variantId: sku,
      quantity: 4,
      type: "OPENING",
      unitCost: 1100,
    });
    await sellShort(env, sku, 40);

    // 20 in at 600: still 16 short, and those 16 still left at 1,100.
    await produce(env, 12000, [{ variantId: sku, quantity: 20 }]);
    expect(await onHand(sku)).toBe(-16);
    expect(await avgCost(sku)).toBe("1100.0000");
    expect(await accountBalance(env, INVENTORY)).toBe("-17600.00"); // -16 x 1,100
    expect(await accountBalance(env, COGS)).toBe("34000.00"); // 4 + 16 at 1,100, 20 at 600
    await expectBooksMatchStock(env);

    // 50 in at 700: the 16 still short cost 700 each, 34 are left at 700.
    await produce(env, 35000, [{ variantId: sku, quantity: 50 }]);
    expect(await onHand(sku)).toBe(34);
    expect(await avgCost(sku)).toBe("700.0000");
    expect((await trueUps(env)).map((e) => [e.description, e.lines])).toEqual([
      [
        `${TRUE_UP} — EX-LN-005-WHITE-M × 20`,
        [
          [INVENTORY, "10000.00", "0.00"],
          [COGS, "0.00", "10000.00"],
        ],
      ],
      [
        `${TRUE_UP} — EX-LN-005-WHITE-M × 16`,
        [
          [INVENTORY, "6400.00", "0.00"],
          [COGS, "0.00", "6400.00"],
        ],
      ],
    ]);
    expect(await accountBalance(env, INVENTORY)).toBe("23800.00"); // 34 x 700
    expect(await accountBalance(env, COGS)).toBe("27600.00"); // 4 x 1,100 + 20 x 600 + 16 x 700
    await expectBooksMatchStock(env);
  });

  it("follows the same rule for B-grade pieces on their own average", async () => {
    const env = await setup();
    const sku = env.white.id;
    // No screen sells B-grade past zero; older data can hold a B-grade shortage:
    // 5 pieces gone at 300 each.
    const acc = await ensureControlAccounts(env.company.id);
    const warehouse = await stock.getDefaultWarehouse(env.ctx);
    await prisma.$transaction(async (tx) => {
      const key = { variantId: sku, warehouseId: warehouse.id, grade: "B_GRADE" as const };
      await tx.productVariant.update({ where: { id: sku }, data: { bGradeAvgCost: 300 } });
      await tx.stockBalance.create({ data: { ...key, companyId: env.company.id, quantity: -5 } });
      await tx.stockMovement.create({
        data: {
          ...key,
          companyId: env.company.id,
          type: "ADJUSTMENT",
          quantity: -5,
          unitCost: 300,
        },
      });
      await postJournalEntry(tx, {
        companyId: env.company.id,
        description: "B-grade pieces sold before the ERP",
        sourceType: "MANUAL",
        lines: [
          { accountId: acc.COGS, debit: 1500 },
          { accountId: acc.INVENTORY, credit: 1500 },
        ],
      });
    });
    await expectBooksMatchStock(env);

    // 10 A-grade at 1,000 and 10 B-grade at half that: only the B-grade pieces fill a shortage.
    const { intake } = await produce(
      env,
      15000,
      [
        { variantId: sku, quantity: 10 },
        { variantId: sku, quantity: 10, grade: "B_GRADE" },
      ],
      { bGradeRatio: 0.5 },
    );
    expect(await avgCost(sku)).toBe("1000.0000");
    expect(await avgCost(sku, "B_GRADE")).toBe("500.0000");
    const movement = await intakeMovement(intake.id, sku, "B_GRADE");
    expect(await trueUps(env)).toEqual([
      {
        description: `${TRUE_UP} — EX-LN-005-WHITE-M (B-grade) × 5`,
        sourceType: "STOCK_ADJUSTMENT",
        sourceId: movement.id,
        lines: [
          [COGS, "1000.00", "0.00"],
          [INVENTORY, "0.00", "1000.00"],
        ],
      },
    ]);
    expect(await accountBalance(env, INVENTORY)).toBe("12500.00"); // 10 x 1,000 + 5 x 500
    await expectBooksMatchStock(env);
  });

  it("does the same for opening stock and corrections with a cost", async () => {
    const env = await setup();
    const sku = env.white.id;
    await stock.adjustStock(env.ctx, {
      variantId: sku,
      quantity: 4,
      type: "OPENING",
      unitCost: 500,
    });
    await sellShort(env, sku, 10);

    // A piece found, at the average: nothing to correct.
    await stock.adjustStock(env.ctx, { variantId: sku, quantity: 1, type: "ADJUSTMENT" });
    expect(await onHand(sku)).toBe(-5);
    expect(await trueUps(env)).toEqual([]);
    await expectBooksMatchStock(env);

    // 3 pieces with a cost of 650: still 2 short, still at 500.
    const added = await stock.adjustStock(env.ctx, {
      variantId: sku,
      quantity: 3,
      type: "ADJUSTMENT",
      unitCost: 650,
    });
    expect(await onHand(sku)).toBe(-2);
    expect(await avgCost(sku)).toBe("500.0000");
    expect(await trueUps(env)).toEqual([
      {
        description: `${TRUE_UP} — EX-LN-005-WHITE-M × 3`,
        sourceType: "STOCK_ADJUSTMENT",
        sourceId: added.movement.id,
        lines: [
          [COGS, "450.00", "0.00"],
          [INVENTORY, "0.00", "450.00"],
        ],
      },
    ]);
    await expectBooksMatchStock(env);

    // Opening stock of 10 at 700 from the Stock count screen: the last 2 short cost 700.
    await stock.recordStockCount(env.ctx, {
      mode: "OPENING",
      unitCost: 700,
      lines: [{ variantId: sku, quantity: 10 }],
    });
    expect(await onHand(sku)).toBe(8);
    expect(await avgCost(sku)).toBe("700.0000");
    expect((await trueUps(env)).map((e) => [e.description, e.lines])).toEqual([
      [
        `${TRUE_UP} — EX-LN-005-WHITE-M × 3`,
        [
          [COGS, "450.00", "0.00"],
          [INVENTORY, "0.00", "450.00"],
        ],
      ],
      [
        `${TRUE_UP} — EX-LN-005-WHITE-M × 2`,
        [
          [COGS, "400.00", "0.00"],
          [INVENTORY, "0.00", "400.00"],
        ],
      ],
    ]);
    expect(await accountBalance(env, INVENTORY)).toBe("5600.00"); // 8 x 700
    // The 10 sold: 4 + 1 at 500, 3 at 650, 2 at 700.
    expect(await accountBalance(env, COGS)).toBe("5850.00");
    await expectBooksMatchStock(env);
  });

  it("does the same when a cancelled order's delivered pieces come back", async () => {
    const env = await setup();
    const sku = env.white.id;
    await stock.adjustStock(env.ctx, {
      variantId: sku,
      quantity: 4,
      type: "OPENING",
      unitCost: 1100,
    });
    const first = await sellShort(env, sku, 40); // out at 1,100
    await produce(env, 25000, [{ variantId: sku, quantity: 50 }]); // 500 each
    await sellShort(env, sku, 30); // out at 500: 16 short
    expect(await onHand(sku)).toBe(-16);
    await expectBooksMatchStock(env);

    // Safe Void: the first order's 40 pieces come back at the 1,100 they left at.
    await orders.cancelOrder(env.ctx, first.id, {
      reason: "Buyer cancelled the order",
      returnDelivered: true,
    });
    expect(await onHand(sku)).toBe(24);
    expect(await avgCost(sku)).toBe("1100.0000");
    const restock = await prisma.stockMovement.findFirstOrThrow({
      where: { referenceId: first.id, type: "RETURN_RESTOCK" },
    });
    const entries = await trueUps(env);
    expect(entries).toHaveLength(2);
    // The 16 sold short at 500 are the first of them back: they cost 1,100 each.
    expect(entries[1]).toEqual({
      description: `${TRUE_UP} — EX-LN-005-WHITE-M × 16`,
      sourceType: "STOCK_ADJUSTMENT",
      sourceId: restock.id,
      lines: [
        [COGS, "9600.00", "0.00"],
        [INVENTORY, "0.00", "9600.00"],
      ],
    });
    expect(await accountBalance(env, INVENTORY)).toBe("26400.00"); // 24 x 1,100
    await expectBooksMatchStock(env);
  });

  it("keeps the books matching when a delivery is undone while another warehouse is short", async () => {
    const env = await setup();
    const sku = env.navy.id; // never in stock: average cost 0
    const main = await stock.getDefaultWarehouse(env.ctx);
    const uttara = await stock.createWarehouse(env.ctx, { name: "Uttara Store" });
    await sellShort(env, sku, 10); // from the main warehouse at cost 0
    const { intake } = await produce(env, 10000, [{ variantId: sku, quantity: 20 }], {
      warehouseId: uttara.id,
    });
    const shelves = await prisma.stockBalance.findMany({ where: { variantId: sku } });
    expect(Object.fromEntries(shelves.map((b) => [b.warehouseId, b.quantity]))).toEqual({
      [main.id]: -10,
      [uttara.id]: 20,
    });
    expect(await avgCost(sku)).toBe("500.0000");
    expect(await accountBalance(env, COGS)).toBe("5000.00"); // the 10 sold cost 500 each
    await expectBooksMatchStock(env);

    // Undone: the 20 leave Uttara at 500 and the main warehouse is 10 short at 500 again.
    await intakes.reverseIntake(env.pmCtx, intake.id, { reason: "Received in the wrong store" });
    expect(await onHand(sku)).toBe(-10);
    expect(await avgCost(sku)).toBe("500.0000");
    expect(await accountBalance(env, INVENTORY)).toBe("-5000.00");
    expect(
      await prisma.journalEntry.count({
        where: { companyId: env.company.id, description: { startsWith: "Stock value difference" } },
      }),
    ).toBe(0);
    await expectBooksMatchStock(env);
  });

  it("keeps the books matching when the project is completed and its costs evened out", async () => {
    const env = await setup();
    const sku = env.navy.id; // never in stock: average cost 0
    await sellShort(env, sku, 10);
    const project = await projects.createProject(env.pmCtx, {
      name: "Navy linen run",
      styleId: env.style.id,
      factoryId: env.factory.id,
      targetDate: dayFromToday(45),
      targetQuantity: 30,
    });
    await costs.createBill(env.pmCtx, {
      supplierId: env.factory.id,
      paymentType: "DUE",
      allocations: [{ projectId: project.id, expenseHeadId: env.heads.Fabric!, amount: 30000 }],
    });
    // 10 of 30 come first, taking a third of the cost (1,000 each): they fill the shortage.
    const first = await intakes.createIntake(env.pmCtx, {
      projectId: project.id,
      lines: [{ variantId: sku, quantity: 10 }],
    });
    await intakes.confirmIntake(env.pmCtx, first.id);
    expect(await onHand(sku)).toBe(0);
    expect(await accountBalance(env, COGS)).toBe("10000.00");
    await expectBooksMatchStock(env);
    // The last 15 take the rest (1,333.3333 each); completing evens all 25 out to 1,200.
    const last = await intakes.createIntake(env.pmCtx, {
      projectId: project.id,
      lines: [{ variantId: sku, quantity: 15 }],
    });
    await intakes.confirmIntake(env.pmCtx, last.id, { completeProject: true });
    expect(await avgCost(sku)).toBe("1200.0000");
    expect(await accountBalance(env, INVENTORY)).toBe("18000.00"); // 15 x 1,200
    expect(await accountBalance(env, COGS)).toBe("12000.00"); // 10 x 1,200
    await expectBooksMatchStock(env);
  });
});
