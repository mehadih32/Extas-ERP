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
    // A step the ERP ticked is taken back only with a reason (activity log); the ERP
    // then leaves it to be ticked by hand.
    const tech = got.steps.find((s) => s.key === "TECH_PACK")!;
    await expectAppError(
      ta.markTaDone(env.production.ctx, { stepId: tech.id, done: false }),
      "VALIDATION",
    );
    await ta.markTaDone(env.production.ctx, {
      stepId: tech.id,
      done: false,
      reason: "Buyer reopened the fit comments",
    });
    again = await ta.orderTa(env.production.ctx, o.id);
    expect(again.steps.find((s) => s.key === "TECH_PACK")!.done).toBe(false);
    const log = await prisma.auditLog.findFirst({
      where: { entityId: o.id, summary: { contains: "Buyer reopened the fit comments" } },
    });
    expect(log?.summary).toContain("tick taken back");
    await ta.markTaDone(env.production.ctx, { stepId: tech.id, done: true });
    again = await ta.orderTa(env.production.ctx, o.id);
    expect(again.steps.find((s) => s.key === "TECH_PACK")).toMatchObject({
      done: true,
      doneHow: "MANUAL",
    });

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

  it("tells each step that becomes late once, in one combined message: the maker and the owner", async () => {
    // Made today, shipping in 70 days: every step is still ahead.
    const o = await order(env, addDays(today, 70), env.sales.user.id);
    await ta.orderTa(env.sales.ctx, o.id);
    // 40 days on: tech pack, booking, fabric in-house, PP sample and cutting are late
    // (64, 62, 35, 34 and 32 days before the ship date).
    const later = new Date(Date.now() + 40 * 86_400_000);
    const first = await ta.runTaClock(later);
    expect(first.told).toBe(5);
    // One message each, not one per step.
    expect(first.messages).toBe(2);
    const messages = await prisma.notificationLog.findMany({
      where: { companyId: env.company.id, channel: "IN_APP" },
    });
    expect(messages.map((m) => m.userId).sort()).toEqual(
      [env.sales.user.id, env.owner.user.id].sort(),
    );
    expect(messages.some((m) => m.userId === env.production.user.id)).toBe(false);
    const toOwner = messages.find((m) => m.userId === env.owner.user.id)!;
    expect(toOwner.subject).toBe(`T&A late: 5 steps on 1 order`);
    expect(toOwner.entityId).toBe(o.id);
    expect(toOwner.body).toContain("Tech pack approval");
    expect(toOwner.body).toContain("ship date is at risk");
    // Run again (another hour, a restart): nothing twice.
    const second = await ta.runTaClock(later);
    expect(second).toEqual({ told: 0, messages: 0 });
    expect(await prisma.notificationLog.count({ where: { companyId: env.company.id } })).toBe(
      messages.length,
    );
  });

  it("never floods: steps already past their day when made, and draft orders, are not told", async () => {
    // The first run of the clock on an order shipping in 30 days: its first five steps
    // were already past their day when its T&A was made.
    const old = await order(env, addDays(today, 30));
    const first = await ta.runTaClock(new Date());
    expect(first.told).toBe(0);
    const colours = (await ta.orderTa(env.sales.ctx, old.id)).steps.filter(
      (s) => s.colour === "red",
    );
    expect(colours).toHaveLength(5); // still shown late on the screen
    // A draft order's steps are never told, even when they become late.
    const draft = await order(env, addDays(today, 70));
    await prisma.salesOrder.update({ where: { id: draft.id }, data: { status: "DRAFT" } });
    await ta.orderTa(env.sales.ctx, draft.id);
    const later = await ta.runTaClock(new Date(Date.now() + 40 * 86_400_000));
    // Only the first order's sewing, packing and ship steps, which became late since.
    expect(later.told).toBe(3);
    const sent = await prisma.notificationLog.findMany({
      where: { companyId: env.company.id },
    });
    expect(sent.length).toBeGreaterThan(0);
    expect(sent.every((m) => m.entityId === old.id)).toBe(true);
    expect(sent.some((m) => m.body?.includes(draft.number))).toBe(false);
  });

  it("ticks fabric steps only from fabric bookings and this order's own fabric", async () => {
    const o = await order(env, addDays(today, 90));
    const mine = await prisma.productionProject.create({
      data: {
        companyId: env.company.id,
        code: "PRJ-TA-A",
        name: "Polo",
        salesOrderId: o.id,
        targetDate: dateColumn(addDays(today, 80)),
        targetQuantity: 1000,
      },
    });
    const other = await order(env, addDays(today, 90));
    const theirs = await prisma.productionProject.create({
      data: {
        companyId: env.company.id,
        code: "PRJ-TA-B",
        name: "Tee",
        salesOrderId: other.id,
        targetDate: dateColumn(addDays(today, 80)),
        targetQuantity: 1000,
      },
    });
    const supplier = await prisma.party.create({
      data: { companyId: env.company.id, code: "SUP-TA-1", kind: "SUPPLIER", name: "Mill" },
    });
    const material = async (kind: "FABRIC" | "TRIM", name: string) =>
      prisma.rawMaterial.create({
        data: {
          companyId: env.company.id,
          code: `RM-${name}`,
          kind,
          name,
          unit: kind === "FABRIC" ? "KG" : "PCS",
        },
      });
    const fabric = await material("FABRIC", "Pique 220");
    const trim = await material("TRIM", "Button");
    let n = 0;
    const po = async (
      projectId: string,
      item: { id: string },
      received: number,
      stage: "DRAFT" | "APPROVED" = "APPROVED",
    ) => {
      n += 1;
      const row = await prisma.purchaseOrder.create({
        data: {
          companyId: env.company.id,
          number: `PO-TA-${n}`,
          supplierId: supplier.id,
          orderDate: dateColumn(today),
          projectId,
          lines: {
            create: [
              {
                rawMaterialId: item.id,
                quantity: 100,
                receivedQty: received,
                unitPrice: 1,
                amount: 100,
              },
            ],
          },
        },
      });
      await prisma.booking.create({
        data: {
          companyId: env.company.id,
          orderId: row.id,
          source: "SUPPLIER_PO",
          category: "KNITWEAR",
          terms: "",
          stage,
        },
      });
      return row;
    };
    // An approved trims booking is not "fabric booked".
    await po(mine.id, trim, 0);
    let got = await ta.orderTa(env.sales.ctx, o.id);
    expect(got.steps.find((s) => s.key === "FABRIC_BOOKING")!.done).toBe(false);
    // The other order's fabric, all received, does not tick this order's fabric in-house.
    await po(theirs.id, fabric, 100);
    got = await ta.orderTa(env.sales.ctx, o.id);
    expect(got.steps.find((s) => s.key === "FABRIC_IN_HOUSE")!.done).toBe(false);
    // This order's own approved fabric booking, received in full: both tick.
    await po(mine.id, fabric, 100);
    got = await ta.orderTa(env.sales.ctx, o.id);
    expect(got.steps.find((s) => s.key === "FABRIC_BOOKING")).toMatchObject({
      done: true,
      doneHow: "AUTO",
    });
    expect(got.steps.find((s) => s.key === "FABRIC_IN_HOUSE")!.done).toBe(true);
  });

  it("keeps the starting steps' own keys when renamed on the first save", async () => {
    const template = await ta.getTaTemplate(env.owner.ctx);
    await ta.saveTaTemplate(env.owner.ctx, {
      dueSoonDays: 3,
      steps: template.steps.map((s) =>
        s.key === "PACKING" ? { ...s, name: "Final packing", daysBeforeShip: 9 } : s,
      ),
    });
    const saved = await ta.taTemplateOf(env.company.id);
    expect(saved.find((s) => s.key === "PACKING")).toMatchObject({
      name: "Final packing",
      daysBeforeShip: 9,
    });
    expect(taDates(addDays(today, 100), saved).find((d) => d.key === "packed")!.by).toBe(
      addDays(today, 91),
    );
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
