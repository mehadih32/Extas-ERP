import { beforeEach, describe, expect, it } from "vitest";

import { dateColumn, localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { addDays, addMonths, monthStart } from "@/modules/accounts/periods";
import {
  getHomePulse,
  getHomeTopBar,
  homePeriod,
  setSalesTarget,
} from "@/modules/dashboard/home.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as parties from "@/modules/parties/party.service";
import * as reminders from "@/modules/reminders/reminder.service";
import * as documents from "@/modules/sales/documents.service";
import * as orders from "@/modules/sales/order.service";
import * as payments from "@/modules/sales/payment.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";
const META = { ipAddress: "203.0.113.7", userAgent: "vitest" };

/**
 * Home dashboard overhaul 1: the top bar (pending tasks today, the monthly
 * sales target) and The Pulse (sales and money collected, deliveries,
 * production) for today, this week or this month.
 *
 * A company with one person per built-in role, a polo (Navy M, wholesale 900,
 * 50 pcs in stock) and a buyer.
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

  const size = await catalog.createSize(admin, { name: "M" });
  const navy = await catalog.createColor(admin, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(admin, { name: "Tops" });
  const style = await styles.createStyle(admin, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    retailPrice: 1450,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(admin, style.id, { colorIds: [navy.id], sizeIds: [size.id] });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { styleId: style.id } });
  await stock.adjustStock(admin, {
    variantId: variant.id,
    quantity: 50,
    type: "OPENING",
    unitCost: 500,
  });
  const { party: buyer } = await parties.createParty(admin, {
    kind: "BUYER",
    name: "Rahim Traders",
    phone: "01711223344",
  });
  return { company, admin, accounts, sales, production, store, employee, variant, buyer };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** An invoiced wholesale order of `pieces` x 900 for the buyer. */
const sell = (env: Env, pieces: number) =>
  orders.createOrder(env.admin, {
    channel: "WHOLESALE",
    partyId: env.buyer.id,
    lines: [{ variantId: env.variant.id, quantity: pieces }],
  });

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  return error as AppError;
}

const today = () => localDay(new Date(), TZ);
const thisMonth = () => today().slice(0, 7);

/** A production project straight in the table, with only what the counts read. */
async function project(
  env: Env,
  code: string,
  status: "PLANNED" | "ACTIVE" | "ON_HOLD" | "COMPLETED",
  opts: { targetDate?: string; completedAt?: Date } = {},
) {
  return prisma.productionProject.create({
    data: {
      companyId: env.company.id,
      code,
      name: `Project ${code}`,
      status,
      targetQuantity: 100,
      targetDate: startOfDayInZone(opts.targetDate ?? addDays(today(), 30), TZ),
      completedAt: opts.completedAt ?? null,
    },
  });
}

describe("the Home screen's period", () => {
  it("runs a week from Saturday and a month from the 1st, up to today", () => {
    // Wednesday 14 October 2026.
    expect(homePeriod("TODAY", "2026-10-14", TZ)).toMatchObject({
      from: "2026-10-14",
      to: "2026-10-14",
    });
    expect(homePeriod("WEEK", "2026-10-14", TZ).from).toBe("2026-10-10");
    // A Saturday starts its own week; a Friday ends it.
    expect(homePeriod("WEEK", "2026-10-10", TZ).from).toBe("2026-10-10");
    expect(homePeriod("WEEK", "2026-10-16", TZ).from).toBe("2026-10-10");
    const month = homePeriod("MONTH", "2026-10-14", TZ);
    expect(month.from).toBe("2026-10-01");
    expect(month.start).toEqual(startOfDayInZone("2026-10-01", TZ));
    expect(month.end).toEqual(startOfDayInZone("2026-10-15", TZ));
  });
});

run("the Home screen's top bar", () => {
  beforeEach(resetDb);

  it("counts today's and overdue tasks from the person's own agenda", async () => {
    const env = await setup();
    const now = startOfDayInZone(today(), TZ);
    expect((await getHomeTopBar(env.sales, now)).pending).toEqual({ total: 0, overdue: 0 });

    await reminders.createReminder(
      env.sales,
      { title: "Call Rahim Traders", day: today(), time: "23:00" },
      undefined,
      now,
    );
    const late = await reminders.createReminder(
      env.sales,
      { title: "Send the price list", day: today(), time: "22:00" },
      undefined,
      now,
    );
    await prisma.reminder.update({
      where: { id: late.id },
      data: { remindAt: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
    });
    expect((await getHomeTopBar(env.sales, now)).pending).toEqual({ total: 2, overdue: 1 });
    // Someone else's reminders are not on their list.
    expect((await getHomeTopBar(env.store, now)).pending.total).toBe(0);
  });

  it("measures the month's sales against the target, for the people who see sales", async () => {
    const env = await setup();
    let bar = await getHomeTopBar(env.admin);
    expect(bar.salesTarget).toMatchObject({
      month: thisMonth(),
      achieved: "0.00",
      target: null,
      canSet: true,
    });

    await setSalesTarget(env.admin, { month: thisMonth(), amount: 36000 }, META);
    await sell(env, 10); // 9,000
    bar = await getHomeTopBar(env.admin);
    const target = bar.salesTarget!.target!;
    expect(bar.salesTarget!.achieved).toBe("9000.00");
    expect(target).toMatchObject({
      amount: "36000.00",
      setFor: thisMonth(),
      percent: 25,
      reached: false,
      left: "27000.00",
    });
    const daysLeft = bar.salesTarget!.daysLeft;
    expect(target.perDayLeft).toBe((27000 / daysLeft).toFixed(2));

    // Sales and Accounts see it but cannot set it; Production does not see sales.
    expect((await getHomeTopBar(env.sales)).salesTarget).toMatchObject({
      canSet: false,
      target: { percent: 25 },
    });
    expect((await getHomeTopBar(env.accounts)).salesTarget?.canSet).toBe(false);
    expect((await getHomeTopBar(env.production)).salesTarget).toBeNull();
    expect((await getHomeTopBar(env.employee)).salesTarget).toBeNull();

    await sell(env, 30); // 27,000 more: 36,000 in all
    const reached = (await getHomeTopBar(env.admin)).salesTarget!.target!;
    expect(reached).toMatchObject({ percent: 100, reached: true, onPace: true, left: "0.00" });
  });

  it("carries the latest target into months that have none of their own", async () => {
    const env = await setup();
    const lastMonth = addMonths(monthStart(today()), -1).slice(0, 7);
    await prisma.salesTarget.create({
      data: {
        companyId: env.company.id,
        month: dateColumn(`${lastMonth}-01`),
        amount: 50000,
      },
    });
    const bar = await getHomeTopBar(env.admin);
    expect(bar.salesTarget!.target).toMatchObject({ amount: "50000.00", setFor: lastMonth });

    // Setting this month's own target replaces it from now on; changing it again updates it.
    await setSalesTarget(env.admin, { month: thisMonth(), amount: 60000 }, META);
    await setSalesTarget(env.admin, { month: thisMonth(), amount: 65000.5 }, META);
    expect((await getHomeTopBar(env.admin)).salesTarget!.target).toMatchObject({
      amount: "65000.50",
      setFor: thisMonth(),
    });
    expect(await prisma.salesTarget.count({ where: { companyId: env.company.id } })).toBe(2);
    const log = await prisma.auditLog.findMany({
      where: { companyId: env.company.id, entityType: "SalesTarget" },
      orderBy: { createdAt: "asc" },
    });
    expect(log.map((l) => [l.action, l.summary])).toEqual([
      ["CREATE", `Monthly sales target for ${thisMonth()}: 60000.00`],
      ["UPDATE", `Monthly sales target for ${thisMonth()}: 65000.50 (was 60000.00)`],
    ]);
  });

  it("lets only the owner set a target, for this month or a later one", async () => {
    const env = await setup();
    for (const ctx of [env.accounts, env.sales, env.production]) {
      await expectAppError(
        setSalesTarget(ctx, { month: thisMonth(), amount: 1000 }, META),
        "FORBIDDEN",
      );
    }
    const lastMonth = addMonths(monthStart(today()), -1).slice(0, 7);
    const past = await expectAppError(
      setSalesTarget(env.admin, { month: lastMonth, amount: 1000 }, META),
      "VALIDATION",
    );
    expect(past.details).toHaveProperty("month");
    await expect(setSalesTarget(env.admin, { month: thisMonth(), amount: 0 })).rejects.toThrow();
    await expect(setSalesTarget(env.admin, { month: "2026-13", amount: 10 })).rejects.toThrow();
    const nextMonth = addMonths(monthStart(today()), 1).slice(0, 7);
    expect(await setSalesTarget(env.admin, { month: nextMonth, amount: 1000 }, META)).toEqual({
      month: nextMonth,
      amount: "1000.00",
    });
    // A later month's target does not apply to this month.
    expect((await getHomeTopBar(env.admin)).salesTarget!.target).toBeNull();
  });
});

run("The Pulse", () => {
  beforeEach(resetDb);

  it("shows sales, money collected, deliveries and production for the period", async () => {
    const env = await setup();
    const first = await sell(env, 4); // 3,600
    await sell(env, 6); // 5,400
    await payments.receivePayment(env.accounts, {
      partyId: env.buyer.id,
      amount: 2000,
      method: "CASH",
    });
    await documents.createDeliveryChallan(env.admin, first.id);
    await project(env, "PRJ-1", "ACTIVE");
    await project(env, "PRJ-2", "ACTIVE", { targetDate: addDays(today(), -2) });
    await project(env, "PRJ-3", "PLANNED");
    await project(env, "PRJ-4", "ON_HOLD");
    await project(env, "PRJ-5", "COMPLETED", { completedAt: new Date() });
    await project(env, "PRJ-6", "COMPLETED", {
      completedAt: startOfDayInZone(addDays(monthStart(today()), -3), TZ),
    });

    const pulse = await getHomePulse(env.admin, { range: "TODAY" });
    expect(pulse).toMatchObject({ range: "TODAY", from: today(), to: today() });
    expect(pulse.sales).toEqual({
      net: "9000.00",
      invoices: 2,
      pieces: 10,
      collected: "2000.00",
      receipts: 1,
      refunded: "0.00",
    });
    expect(pulse.deliveries).toEqual({ challans: 1, pieces: 4, waiting: 1, late: 0 });
    expect(pulse.production).toEqual({
      active: 2,
      planned: 1,
      onHold: 1,
      late: 1,
      completed: 1,
    });

    // The month opens by default and holds today.
    const month = await getHomePulse(env.admin);
    expect(month).toMatchObject({ range: "MONTH", from: monthStart(today()), to: today() });
    expect(month.sales?.net).toBe("9000.00");

    // Yesterday's sale is not today's, but is this month's when the month started earlier.
    await prisma.invoice.updateMany({
      where: { orderId: first.id },
      data: { issueDate: startOfDayInZone(addDays(today(), -1), TZ) },
    });
    expect((await getHomePulse(env.admin, { range: "TODAY" })).sales?.net).toBe("5400.00");
    await expect(getHomePulse(env.admin, { range: "YEAR" })).rejects.toThrow();
  });

  it("leaves out the cards a role may not see", async () => {
    const env = await setup();
    const cards = async (ctx: Env["admin"]) => {
      const p = await getHomePulse(ctx);
      return {
        sales: p.sales !== null,
        deliveries: p.deliveries !== null,
        production: p.production !== null,
      };
    };
    expect(await cards(env.admin)).toEqual({ sales: true, deliveries: true, production: true });
    expect(await cards(env.accounts)).toEqual({ sales: true, deliveries: true, production: true });
    expect(await cards(env.sales)).toEqual({ sales: true, deliveries: true, production: false });
    expect(await cards(env.store)).toEqual({ sales: true, deliveries: true, production: true });
    expect(await cards(env.production)).toEqual({
      sales: false,
      deliveries: false,
      production: true,
    });
    expect(await cards(env.employee)).toEqual({
      sales: false,
      deliveries: false,
      production: false,
    });
  });
});
