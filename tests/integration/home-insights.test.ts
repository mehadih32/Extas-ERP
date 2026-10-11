import { beforeEach, describe, expect, it } from "vitest";

import { localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { addDays } from "@/modules/accounts/periods";
import {
  fallbackText,
  FEED_ROWS,
  feedParts,
  getActivityFeed,
} from "@/modules/dashboard/activity.service";
import {
  getProductionPipeline,
  projectProgress,
  stagePercent,
} from "@/modules/dashboard/pipeline.service";
import {
  getPredictiveInsights,
  runwayDays,
  runwayStatus,
} from "@/modules/dashboard/predictive.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as orders from "@/modules/sales/order.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/**
 * Home dashboard overhaul 3: the predictive insights (stock runway, top buyer),
 * the production pipeline and the live activity feed.
 *
 * A company with one person per built-in role, a polo (Navy M with 50 pcs and
 * Navy L with 2 pcs) and a tee (Navy M with 100 pcs), and two buyers.
 */
async function setup() {
  const { company, roles } = await makeCompany("Extras");
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@extras.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return contextFor(user.id, company.id);
  };
  const admin = await member("SUPER_ADMIN", "admin");
  const accounts = await member("ACCOUNTS", "accounts");
  const sales = await member("SALES_EXECUTIVE", "sales");
  const production = await member("PRODUCTION_MANAGER", "production");
  const store = await member("WAREHOUSE_TEAM", "store");
  const employee = await member("EMPLOYEE", "employee");

  const m = await catalog.createSize(admin, { name: "M" });
  const l = await catalog.createSize(admin, { name: "L" });
  const navy = await catalog.createColor(admin, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(admin, { name: "Tops" });
  const style = async (code: string, name: string, sizes: string[]) => {
    const made = await styles.createStyle(admin, {
      code,
      name,
      categoryId: tops.id,
      retailPrice: 1450,
      wholesalePrice: 1000,
    });
    await matrix.generateMatrix(admin, made.id, { colorIds: [navy.id], sizeIds: sizes });
    return made;
  };
  const polo = await style("EX-PL-001", "Classic Polo", [m.id, l.id]);
  const tee = await style("EX-TS-002", "Basic Tee", [m.id]);
  const variants = await prisma.productVariant.findMany({ include: { size: true } });
  const sku = (styleId: string, size: string) =>
    variants.find((v) => v.styleId === styleId && v.size.name === size)!;
  const poloM = sku(polo.id, "M");
  const poloL = sku(polo.id, "L");
  const teeM = sku(tee.id, "M");
  for (const [variant, quantity] of [
    [poloM, 50],
    [poloL, 2],
    [teeM, 100],
  ] as const) {
    await stock.adjustStock(admin, {
      variantId: variant.id,
      quantity,
      type: "OPENING",
      unitCost: 500,
    });
  }
  const { party: rahim } = await parties.createParty(admin, {
    kind: "BUYER",
    name: "Rahim Traders",
    phone: "01711223344",
  });
  const { party: selim } = await parties.createParty(admin, {
    kind: "BUYER",
    name: "Selim Fashion",
  });
  return {
    company,
    admin,
    accounts,
    sales,
    production,
    store,
    employee,
    polo,
    tee,
    poloM,
    teeM,
    rahim,
    selim,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

const today = () => localDay(new Date(), TZ);

/** An invoiced order of `pieces` of a SKU for a buyer at 1000 (or a walk-in at 1450). */
async function sell(
  env: Env,
  buyer: { id: string } | { name: string },
  variantId: string,
  pieces: number,
  by = env.admin,
) {
  const order = await orders.createOrder(by, {
    ...("id" in buyer
      ? { channel: "WHOLESALE", partyId: buyer.id }
      : { channel: "POS", customerName: buyer.name }),
    lines: [{ variantId, quantity: pieces }],
  });
  return prisma.invoice.findUniqueOrThrow({ where: { orderId: order.id } });
}

/** Moves an invoice's issue day `days` back from today. */
const issuedDaysAgo = (invoiceId: string, days: number) =>
  prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      issueDate: new Date(startOfDayInZone(addDays(today(), -days), TZ).getTime() + 3600_000),
    },
  });

describe("the predictive figures", () => {
  it("counts the days the stock lasts at the last 30 days' speed", () => {
    expect(runwayDays(22, 30)).toBe(22);
    expect(runwayDays(100, 7)).toBe(428);
    expect(runwayDays(5, 60)).toBe(2);
    expect(runwayDays(0, 30)).toBe(0);
    expect(runwayDays(-3, 30)).toBe(0);
    expect(runwayStatus(0, 0)).toBe("OUT");
    expect(runwayStatus(10, 14)).toBe("SHORT");
    expect(runwayStatus(10, 15)).toBe("ORDER");
    expect(runwayStatus(10, 44)).toBe("ORDER");
    expect(runwayStatus(10, 45)).toBe("OK");
  });

  it("moves a project's bar on with each stage, or with the pieces received", () => {
    expect(
      (["FABRIC_SOURCING", "CUTTING", "SEWING", "WASH_QC", "FINISHING", "COMPLETED"] as const).map(
        stagePercent,
      ),
    ).toEqual([10, 30, 50, 70, 90, 100]);
    expect(projectProgress({ stage: "SEWING", targetQuantity: 300, received: 0 })).toEqual({
      percent: 50,
      basis: "STAGE",
    });
    expect(projectProgress({ stage: "WASH_QC", targetQuantity: 600, received: 480 })).toEqual({
      percent: 80,
      basis: "RECEIVED",
    });
    expect(projectProgress({ stage: "FINISHING", targetQuantity: 100, received: 140 })).toEqual({
      percent: 100,
      basis: "RECEIVED",
    });
    expect(projectProgress({ stage: "CUTTING", targetQuantity: 0, received: 0 }).percent).toBe(30);
  });

  it("splits the amounts out of the activity text, for the eye to hide", () => {
    expect(feedParts("Issued invoice INV-2026-00039 for SO-2026-00042 (10200.00)")).toEqual([
      { text: "Issued invoice INV-2026-00039 for SO-2026-00042 (" },
      { amount: "10200.00" },
      { text: ")" },
    ]);
    expect(feedParts("Salary of EMP-0113 from 2026-11-01: 13000.00 -> 13500.00")).toEqual([
      { text: "Salary of EMP-0113 from 2026-11-01: " },
      { amount: "13000.00" },
      { text: " -> " },
      { amount: "13500.00" },
    ]);
    expect(feedParts("Balance -500.00 left")).toEqual([
      { text: "Balance " },
      { amount: "-500.00" },
      { text: " left" },
    ]);
    // Quantities, dates, times and codes are not money.
    for (const text of [
      "Delivery GRN-2026-00006 for PRD-2026-00008: 180 pcs entered",
      "Issued MI-2026-00001 from Main Warehouse: FAB-0004 × 64.5 yd",
      "Sabbir Ahmed checked in at 04:16",
      "Version 1.2.30 installed",
    ]) {
      expect(feedParts(text), text).toEqual([{ text }]);
    }
    expect(fallbackText("CREATE", "SalesOrder")).toBe("Added a sales order");
    expect(fallbackText("STATUS_CHANGE", "LeaveRequest")).toBe(
      "Changed the status of a leave request",
    );
  });
});

run("the stock runway", () => {
  beforeEach(resetDb);

  it("tells how many days the top sellers' stock lasts at the current speed", async () => {
    const env = await setup();
    await sell(env, env.rahim, env.poloM.id, 30);
    await sell(env, env.selim, env.teeM.id, 6);
    // A sale before the last 30 days does not set the speed.
    const old = await sell(env, env.selim, env.teeM.id, 50);
    await issuedDaysAgo(old.id, 40);

    const { runway } = await getPredictiveInsights(env.production);
    expect(runway).toMatchObject({
      speedDays: 30,
      from: addDays(today(), -29),
      to: today(),
      shortDays: 15,
      orderDays: 45,
      orderNow: "PRODUCTION",
    });
    // Polo: 52 on hand less 30 reserved = 22 left at 1 a day. Tee: 44 left at 0.2 a day.
    expect(runway!.items).toEqual([
      {
        styleId: env.polo.id,
        styleCode: "EX-PL-001",
        styleName: "Classic Polo",
        sold: 30,
        perDay: "1.0",
        available: 22,
        days: 22,
        runsOutOn: addDays(today(), 22),
        status: "ORDER",
      },
      expect.objectContaining({
        styleId: env.tee.id,
        sold: 6,
        perDay: "0.2",
        available: 44,
        days: 220,
        status: "OK",
      }),
    ]);
  });

  it("is red when the stock runs out soon, and shows out of stock", async () => {
    const env = await setup();
    await sell(env, env.rahim, env.poloM.id, 45); // 7 left at 1.5 a day: 4 days
    await sell(env, env.rahim, env.teeM.id, 100); // none left
    const { runway } = await getPredictiveInsights(env.admin);
    const byCode = Object.fromEntries(runway!.items.map((i) => [i.styleCode, i]));
    expect(byCode["EX-PL-001"]).toMatchObject({ available: 7, days: 4, status: "SHORT" });
    expect(byCode["EX-TS-002"]).toMatchObject({ available: 0, days: 0, status: "OUT" });
  });

  it("is for those who see stock, pieces only", async () => {
    const env = await setup();
    await sell(env, env.rahim, env.poloM.id, 3);
    expect((await getPredictiveInsights(env.employee)).runway).toBeNull();
    expect((await getPredictiveInsights(env.store)).runway!.orderNow).toBe("PRODUCT");
    expect((await getPredictiveInsights(env.sales)).runway!.items).toHaveLength(1);
    const empty = await getPredictiveInsights(env.production, {}, new Date(Date.UTC(2020, 0, 1)));
    expect(empty.runway!.items).toEqual([]);
  });
});

run("the top buyer", () => {
  beforeEach(resetDb);

  it("names the buyer who bought the most in the period, with what they bought", async () => {
    const env = await setup();
    await sell(env, env.rahim, env.poloM.id, 6); // 6,000
    await sell(env, env.rahim, env.teeM.id, 4); // 4,000
    await sell(env, env.selim, env.teeM.id, 3); // 3,000
    await sell(env, { name: "Karim" }, env.poloM.id, 5); // 7,250 at the counter
    // Last month's big order does not count this month.
    const old = await sell(env, env.selim, env.teeM.id, 50);
    await issuedDaysAgo(old.id, 40);

    const { topBuyer, currency } = await getPredictiveInsights(env.admin, { range: "MONTH" });
    expect(currency).toBe("BDT");
    expect(topBuyer).toEqual({
      total: "20250.00",
      buyer: {
        partyId: env.rahim.id,
        code: env.rahim.code,
        name: "Rahim Traders",
        invoices: 2,
        pieces: 10,
        net: "10000.00",
        sharePct: "49.4",
        styles: [
          { id: env.polo.id, code: "EX-PL-001", name: "Classic Polo", pieces: 6 },
          { id: env.tee.id, code: "EX-TS-002", name: "Basic Tee", pieces: 4 },
        ],
      },
      // Walk-in sales are no one buyer.
      runnersUp: [
        {
          partyId: env.selim.id,
          code: env.selim.code,
          name: "Selim Fashion",
          invoices: 1,
          pieces: 3,
          net: "3000.00",
        },
      ],
    });
  });

  it("is for those who see sales amounts, as on The Pulse", async () => {
    const env = await setup();
    await sell(env, env.rahim, env.poloM.id, 1);
    for (const [who, ctx, sees] of [
      ["owner", env.admin, true],
      ["accounts", env.accounts, true],
      ["sales", env.sales, true],
      // The store team sees sales (to pack orders), so sales amounts too.
      ["store", env.store, true],
      ["production", env.production, false],
      ["employee", env.employee, false],
    ] as const) {
      const { topBuyer } = await getPredictiveInsights(ctx, { range: "TODAY" });
      expect(topBuyer === null, who).toBe(!sees);
      if (sees) expect(topBuyer!.buyer!.name, who).toBe("Rahim Traders");
    }
  });

  it("has no top buyer without a buyer's sale", async () => {
    const env = await setup();
    await sell(env, { name: "Karim" }, env.poloM.id, 1);
    const { topBuyer } = await getPredictiveInsights(env.admin, { range: "TODAY" });
    expect(topBuyer).toEqual({ total: "1450.00", buyer: null, runnersUp: [] });
  });
});

run("the production pipeline", () => {
  beforeEach(resetDb);

  it("shows the active projects as progress bars, the most pressing first", async () => {
    const env = await setup();
    const at = (days: number) => startOfDayInZone(addDays(today(), days), TZ);
    const project = (
      code: string,
      data: {
        stage: "SEWING" | "WASH_QC" | "CUTTING" | "COMPLETED";
        status: "ACTIVE" | "ON_HOLD" | "COMPLETED";
        targetIn: number;
        target: number;
        received?: number;
        buyerId?: string;
      },
    ) =>
      prisma.productionProject.create({
        data: {
          companyId: env.company.id,
          code,
          name: `Project ${code}`,
          stage: data.stage,
          status: data.status,
          startDate: at(-30),
          targetDate: at(data.targetIn),
          targetQuantity: data.target,
          producedQtyA: data.received ?? 0,
          buyerId: data.buyerId ?? null,
          isInHouse: !data.buyerId,
        },
      });
    const sewing = await project("PRD-1", {
      stage: "SEWING",
      status: "ACTIVE",
      targetIn: 10,
      target: 300,
      buyerId: env.rahim.id,
    });
    const late = await project("PRD-2", {
      stage: "WASH_QC",
      status: "ACTIVE",
      targetIn: -3,
      target: 600,
      received: 480,
    });
    await project("PRD-3", { stage: "CUTTING", status: "ON_HOLD", targetIn: 5, target: 100 });
    await project("PRD-4", { stage: "COMPLETED", status: "COMPLETED", targetIn: -9, target: 50 });

    const pipeline = await getProductionPipeline(env.production);
    expect(pipeline).toMatchObject({ active: 2, onHold: 1, open: true });
    expect(pipeline.items).toEqual([
      expect.objectContaining({
        id: late.id,
        code: "PRD-2",
        stage: "WASH_QC",
        buyer: null,
        target: 600,
        received: 480,
        percent: 80,
        basis: "RECEIVED",
        isOverdue: true,
        overdueDays: 3,
      }),
      expect.objectContaining({
        id: sewing.id,
        buyer: "Rahim Traders",
        percent: 50,
        basis: "STAGE",
        remainingDays: 10,
        isOverdue: false,
        targetOn: addDays(today(), 10),
      }),
    ]);
  });

  it("is for those who see production or the financials", async () => {
    const env = await setup();
    expect((await getProductionPipeline(env.admin)).items).toEqual([]);
    expect((await getProductionPipeline(env.accounts)).items).toEqual([]);
    expect((await getProductionPipeline(env.store)).items).toEqual([]);
    for (const ctx of [env.sales, env.employee]) {
      const error = await getProductionPipeline(ctx).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe("FORBIDDEN");
    }
  });
});

run("the live activity feed", () => {
  beforeEach(resetDb);

  it("shows the owner everyone's activity, newest first, without the noise", async () => {
    const env = await setup();
    const invoice = await sell(env, env.rahim, env.poloM.id, 2, env.sales);
    // Not business activity: left out.
    const noise = [
      { action: "LOGIN", entityType: "Session" },
      { action: "EXPORT", entityType: "GeneratedDocument" },
      { action: "UPDATE", entityType: "Attendance" },
    ] as const;
    for (const row of noise) {
      await prisma.auditLog.create({
        data: { companyId: env.company.id, userId: env.sales.user.id, ...row, summary: "noise" },
      });
    }

    const feed = await getActivityFeed(env.admin);
    expect(feed.scope).toBe("COMPANY");
    expect(feed.today).toBe(today());
    expect(feed.items.some((i) => i.parts.some((p) => "text" in p && p.text === "noise"))).toBe(
      false,
    );
    const [newest, ordered] = feed.items;
    // The invoice was issued with the order, after it.
    expect(newest).toMatchObject({ who: "sales", mine: false, day: today() });
    expect(newest!.time).toMatch(/^\d{1,2}:\d{2} (AM|PM)$/);
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: invoice.orderId } });
    expect(newest!.parts).toEqual([
      { text: `Issued invoice ${invoice.number} for ${order.number} (` },
      { amount: "2000.00" },
      { text: ")" },
    ]);
    expect(newest!.href).toBe(`/sales/invoices/${invoice.id}`);
    expect(ordered!.href).toBe(`/sales/orders/${invoice.orderId}`);
    // The owner's own rows are "You"; a buyer opens on the buyers' list.
    const buyerRow = feed.items.find((i) => i.href === `/parties/buyers/${env.rahim.id}`);
    expect(buyerRow).toMatchObject({ who: "You", mine: true });
  });

  it("shows everyone else their own activity only", async () => {
    const env = await setup();
    await sell(env, env.rahim, env.poloM.id, 1, env.sales);
    const sales = await getActivityFeed(env.sales);
    expect(sales.scope).toBe("OWN");
    expect(sales.items.length).toBeGreaterThan(0);
    expect(sales.items.every((i) => i.mine && i.who === "You")).toBe(true);

    const employee = await getActivityFeed(env.employee);
    expect(employee).toMatchObject({ scope: "OWN", items: [] });
  });

  it("links only to what the reader may open, and never to something deleted", async () => {
    const env = await setup();
    const row = (data: { action: "CREATE" | "DELETE"; entityType: string; summary?: string }) =>
      prisma.auditLog.create({
        data: {
          companyId: env.company.id,
          userId: env.store.user.id,
          entityId: "abc",
          ...data,
        },
      });
    await row({ action: "CREATE", entityType: "JournalEntry", summary: "Journal voucher" });
    await row({ action: "DELETE", entityType: "ProductionProject", summary: "Deleted a project" });
    await row({ action: "CREATE", entityType: "Mystery" });
    await row({ action: "CREATE", entityType: "Style", summary: "Created a style" });

    const store = await getActivityFeed(env.store);
    const [style, mystery, deleted, journal] = store.items;
    expect(style!.href).toBe("/products/abc");
    expect(mystery).toMatchObject({ parts: [{ text: "Added a mystery" }], href: null });
    expect(deleted!.href).toBeNull();
    // The store team cannot open the books.
    expect(journal!.href).toBeNull();
    expect((await getActivityFeed(env.admin)).items[3]!.href).toBe("/accounts/journal/abc");
  });

  it("shows the latest 12 rows", async () => {
    const env = await setup();
    const base = Date.now() - 60_000;
    for (let i = 0; i < 15; i++) {
      await prisma.auditLog.create({
        data: {
          companyId: env.company.id,
          userId: env.employee.user.id,
          action: "CREATE",
          entityType: "LeaveRequest",
          summary: `Request ${i}`,
          createdAt: new Date(base + i * 1000),
        },
      });
    }
    const feed = await getActivityFeed(env.employee);
    expect(feed.items).toHaveLength(FEED_ROWS);
    expect(feed.items[0]!.parts).toEqual([{ text: "Request 14" }]);
    expect((await getActivityFeed(env.employee, { limit: 3 })).items).toHaveLength(3);
  });
});
