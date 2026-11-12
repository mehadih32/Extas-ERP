import { beforeEach, describe, expect, it } from "vitest";

import { addDays, dateColumn, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { taDates } from "@/modules/ai/orders/order-run";
import * as ta from "@/modules/ta/ta.service";
import { DEFAULT_TA_STEPS } from "@/modules/ta/ta-rules";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function expectAppError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
}

/** Extas with the owner, a sales executive and a production manager; another company. */
async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return { user, ctx: await contextFor(user.id, company.id) };
  };
  const owner = await member("SUPER_ADMIN", "owner");
  const sales = await member("SALES_EXECUTIVE", "rahim");
  const production = await member("PRODUCTION_MANAGER", "karim");
  const accounts = await member("ACCOUNTS", "nila");
  const other = await makeCompany("Other House");
  const outsiderUser = await makeUser(`boss@${other.company.slug}.test`);
  await addToCompany(outsiderUser.id, other.company.id, other.roles.SUPER_ADMIN);
  const outsider = { user: outsiderUser, ctx: await contextFor(outsiderUser.id, other.company.id) };
  return { company, other: other.company, owner, sales, production, accounts, outsider };
}

type Env = Awaited<ReturnType<typeof setup>>;
let seq = 0;

/** A wholesale order shipping on `ship`, made (audit CREATE) by `maker`. */
async function order(env: Env, ship: string | null, maker = env.sales.user.id) {
  seq += 1;
  const row = await prisma.salesOrder.create({
    data: {
      companyId: env.company.id,
      number: `SO-TA-${seq}`,
      channel: "WHOLESALE",
      shipmentDate: ship ? dateColumn(ship) : null,
    },
  });
  await prisma.auditLog.create({
    data: {
      companyId: env.company.id,
      userId: maker,
      action: "CREATE",
      entityType: "SalesOrder",
      entityId: row.id,
    },
  });
  return row;
}

run("T&A calendar for every order", () => {
  let env: Env;
  let today: string;
  beforeEach(async () => {
    await resetDb();
    env = await setup();
    today = localDay(new Date(), env.company.timezone);
  });

  it("makes each order's dates from the template, the same days the AI order runs use", async () => {
    const ship = addDays(today, 100);
    const o = await order(env, ship);
    const got = await ta.orderTa(env.sales.ctx, o.id);
    expect(got.steps.map((s) => [s.name, s.dueOn])).toEqual(
      DEFAULT_TA_STEPS.map((s) => [s.name, addDays(ship, -s.daysBeforeShip)]),
    );
    expect(got.steps.every((s) => s.colour === "green")).toBe(true);
    expect(got.atRisk).toBe(false);
    // The AI order runs' T&A matches the template's days.
    const ai = Object.fromEntries(taDates(ship).map((d) => [d.key, d.by]));
    const due = Object.fromEntries(got.steps.map((s) => [s.key, s.dueOn]));
    expect(ai).toEqual({
      techPack: due.TECH_PACK,
      booking: due.FABRIC_BOOKING,
      cutting: due.CUTTING,
      packed: due.PACKING,
      ship: due.SHIP,
    });

    // The company's own template: new orders and the AI runs follow it; orders that
    // have their T&A keep it.
    const template = await ta.getTaTemplate(env.owner.ctx);
    await ta.saveTaTemplate(env.owner.ctx, {
      dueSoonDays: 5,
      steps: template.steps.map((s) => ({
        ...s,
        daysBeforeShip: s.name === "Packing and final inspection" ? 10 : s.daysBeforeShip,
      })),
    });
    const saved = await ta.taTemplateOf(env.company.id);
    expect(saved.find((s) => s.key === "PACKING")!.daysBeforeShip).toBe(10);
    expect(taDates(ship, saved).find((d) => d.key === "packed")!.by).toBe(addDays(ship, -10));
    const second = await order(env, ship);
    const secondTa = await ta.orderTa(env.sales.ctx, second.id);
    expect(secondTa.steps.find((s) => s.key === "PACKING")!.dueOn).toBe(addDays(ship, -10));
    const firstAgain = await ta.orderTa(env.sales.ctx, o.id);
    expect(firstAgain.steps.find((s) => s.key === "PACKING")!.dueOn).toBe(addDays(ship, -7));
    // Only company.settings changes the template.
    await expectAppError(ta.getTaTemplate(env.sales.ctx), "FORBIDDEN");

    // A new ship date moves the days not changed by hand; a changed day stays (audit-logged).
    const packing = firstAgain.steps.find((s) => s.key === "PACKING")!;
    await ta.changeTaDate(env.sales.ctx, {
      stepId: packing.id,
      dueOn: addDays(ship, -3),
      reason: "Buyer gave more time",
    });
    const audit = await prisma.auditLog.findFirst({
      where: { entityId: o.id, action: "UPDATE", summary: { contains: "Packing" } },
    });
    expect(audit?.summary).toContain(addDays(ship, -3));
    await prisma.salesOrder.update({
      where: { id: o.id },
      data: { shipmentDate: dateColumn(addDays(ship, 10)) },
    });
    const moved = await ta.orderTa(env.sales.ctx, o.id);
    expect(moved.steps.find((s) => s.key === "SHIP")!.dueOn).toBe(addDays(ship, 10));
    expect(moved.steps.find((s) => s.key === "PACKING")!.dueOn).toBe(addDays(ship, -3));
  });

  it("ticks steps from the ERP's records and by hand", async () => {
    const o = await order(env, addDays(today, 90));
    const project = await prisma.productionProject.create({
      data: {
        companyId: env.company.id,
        code: "PRJ-TA-1",
        name: "Polo",
        salesOrderId: o.id,
        targetDate: dateColumn(addDays(today, 80)),
        targetQuantity: 1000,
      },
    });
    await prisma.techPack.create({
      data: { companyId: env.company.id, projectId: project.id, status: "APPROVED" },
    });
    await prisma.cuttingReport.create({
      data: {
        companyId: env.company.id,
        projectId: project.id,
        number: "CUT-TA-1",
        cutOn: dateColumn(today),
        lines: [],
      },
    });
    const got = await ta.orderTa(env.production.ctx, o.id);
    const state = Object.fromEntries(got.steps.map((s) => [s.key, [s.done, s.doneHow]]));
    expect(state.TECH_PACK).toEqual([true, "AUTO"]);
    expect(state.CUTTING).toEqual([true, "AUTO"]);
    expect(state.FABRIC_BOOKING).toEqual([false, null]);
    expect(state.SHIP).toEqual([false, null]);

    // The PP sample has no record in the ERP: ticked by hand, and the tick can be taken back.
    const pp = got.steps.find((s) => s.key === "PP_SAMPLE")!;
    await ta.markTaDone(env.production.ctx, { stepId: pp.id, done: true });
    let again = await ta.orderTa(env.production.ctx, o.id);
    expect(again.steps.find((s) => s.key === "PP_SAMPLE")).toMatchObject({
      done: true,
      doneHow: "MANUAL",
      doneBy: env.production.user.name,
    });
    await ta.markTaDone(env.production.ctx, { stepId: pp.id, done: false });
    // A step the ERP ticked cannot be taken back by hand.
    const tech = got.steps.find((s) => s.key === "TECH_PACK")!;
    await expectAppError(
      ta.markTaDone(env.production.ctx, { stepId: tech.id, done: false }),
      "CONFLICT",
    );

    // Shipped: packing and ship tick themselves.
    await prisma.salesOrder.update({ where: { id: o.id }, data: { status: "SHIPPED" } });
    again = await ta.orderTa(env.production.ctx, o.id);
    expect(again.steps.find((s) => s.key === "PACKING")!.done).toBe(true);
    expect(again.steps.find((s) => s.key === "SHIP")!.done).toBe(true);
  });

  it("colours steps green, yellow and red and says when the ship date is at risk", async () => {
    // Ship in 40 days: tech pack (64) and booking (62) are late, fabric in-house (35) is
    // 5 days off, the rest further.
    const o = await order(env, addDays(today, 40));
    await ta.saveTaTemplate(env.owner.ctx, {
      ...(await ta.getTaTemplate(env.owner.ctx)),
      dueSoonDays: 5,
    });
    const got = await ta.orderTa(env.sales.ctx, o.id);
    const colour = Object.fromEntries(got.steps.map((s) => [s.key, s.colour]));
    expect(colour).toMatchObject({
      TECH_PACK: "red",
      FABRIC_BOOKING: "red",
      FABRIC_IN_HOUSE: "yellow",
      PP_SAMPLE: "green",
      SHIP: "green",
    });
    expect(got.atRisk).toBe(true);

    // Done steps are not late, and a late step off the critical path does not put it at risk.
    for (const s of got.steps.filter((s) => s.colour === "red")) {
      await ta.markTaDone(env.sales.ctx, { stepId: s.id, done: true });
    }
    expect((await ta.orderTa(env.sales.ctx, o.id)).atRisk).toBe(false);

    const calendar = await ta.taCalendar(env.sales.ctx, { view: "month", on: addDays(today, 5) });
    const listed = calendar.days.flatMap((d) => d.items);
    expect(listed.some((i) => i.orderId === o.id && i.key === "FABRIC_IN_HOUSE")).toBe(true);
    const lateOnly = await ta.taCalendar(env.sales.ctx, { status: "late" });
    expect(lateOnly.days.flatMap((d) => d.items).every((i) => i.colour === "red")).toBe(true);
  });

  it("tells each late step once: the order's maker and the owner", async () => {
    const o = await order(env, addDays(today, 30), env.sales.user.id);
    const first = await ta.runTaClock(new Date());
    // Tech pack, booking, fabric in-house, PP sample and cutting (64, 62, 35, 34, 32 days).
    expect(first.told).toBe(5);
    const messages = await prisma.notificationLog.findMany({
      where: { companyId: env.company.id, entityType: "SalesOrder", entityId: o.id },
    });
    expect(new Set(messages.map((m) => m.userId))).toEqual(
      new Set([env.sales.user.id, env.owner.user.id]),
    );
    expect(messages.some((m) => m.userId === env.production.user.id)).toBe(false);
    expect(messages.find((m) => m.subject?.includes("Tech pack approval"))?.body).toContain(
      "ship date is at risk",
    );
    // Run again (another hour, a restart): nothing twice.
    const second = await ta.runTaClock(new Date());
    expect(second.told).toBe(0);
    expect(
      await prisma.notificationLog.count({ where: { entityId: o.id, entityType: "SalesOrder" } }),
    ).toBe(messages.length);
  });

  it("keeps each company's T&A to itself, and to those whose role sees orders", async () => {
    const o = await order(env, addDays(today, 60));
    await expectAppError(ta.orderTa(env.outsider.ctx, o.id), "NOT_FOUND");
    const mine = await ta.orderTa(env.sales.ctx, o.id);
    await expectAppError(
      ta.changeTaDate(env.outsider.ctx, { stepId: mine.steps[0]!.id, dueOn: today }),
      "NOT_FOUND",
    );
    await expectAppError(
      ta.markTaDone(env.outsider.ctx, { stepId: mine.steps[0]!.id, done: true }),
      "NOT_FOUND",
    );
    const theirs = await ta.taCalendar(env.outsider.ctx, { view: "month", on: today });
    expect(theirs.days.flatMap((d) => d.items)).toEqual([]);
    expect(await prisma.orderTaStep.count({ where: { companyId: env.other.id } })).toBe(0);
    // A member whose role sees neither sales nor production; one who sees but cannot change.
    const acc = env.accounts.ctx;
    if (!acc.can("sales.view") && !acc.can("production.view")) {
      await expectAppError(ta.orderTa(acc, o.id), "FORBIDDEN");
      await expectAppError(ta.taCalendar(acc, {}), "FORBIDDEN");
    } else if (!acc.can("sales.order.create") && !acc.can("production.manage")) {
      await expectAppError(
        ta.markTaDone(acc, { stepId: mine.steps[0]!.id, done: true }),
        "FORBIDDEN",
      );
    }
  });
});
