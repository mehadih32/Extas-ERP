import { beforeEach, describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { formatDay } from "@/lib/format";
import { prisma } from "@/lib/prisma";
import type { CompanyContext } from "@/modules/auth/context";
import * as compliance from "@/modules/compliance/compliance.service";
import * as employees from "@/modules/hr/employee.service";
import * as catalog from "@/modules/inventory/catalog.service";
import * as matrix from "@/modules/inventory/matrix.service";
import * as stock from "@/modules/inventory/stock.service";
import * as styles from "@/modules/inventory/style.service";
import * as materials from "@/modules/materials/material.service";
import * as purchaseOrders from "@/modules/materials/purchase-order.service";
import * as notes from "@/modules/notepad/note.service";
import * as parties from "@/modules/parties/party.service";
import * as projects from "@/modules/production/project.service";
import { runReminders } from "@/modules/reminders/engine";
import * as inbox from "@/modules/reminders/notification.service";
import * as reminders from "@/modules/reminders/reminder.service";
import * as rules from "@/modules/reminders/rules";
import * as tasks from "@/modules/reminders/task.service";
import * as orders from "@/modules/sales/order.service";

import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const TZ = "Asia/Dhaka";

/** A calendar day `n` days from today in company time, e.g. "2026-10-12". */
function dayFromToday(n: number) {
  const d = new Date(`${localDay(new Date(), TZ)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** A Dhaka wall-clock time `n` days from today, as an instant. */
const at = (n: number, time = "10:00") => new Date(`${dayFromToday(n)}T${time}:00+06:00`);

/**
 * A company with one person per built-in role (the Employee is Nazrul, linked
 * to his employee profile) and Hasina, an employee with no login.
 */
async function setup(name = "Extras") {
  const { company, roles } = await makeCompany(name);
  const member = async (role: keyof typeof roles, who: string) => {
    const user = await makeUser(`${who}@${company.slug}.test`);
    await addToCompany(user.id, company.id, roles[role]);
    return { user, ctx: await contextFor(user.id, company.id) };
  };
  const admin = await member("SUPER_ADMIN", "admin");
  const pm = await member("PRODUCTION_MANAGER", "production");
  const sales = await member("SALES_EXECUTIVE", "sales");
  const accounts = await member("ACCOUNTS", "accounts");
  const store = await member("WAREHOUSE_TEAM", "store");
  const staff = await member("EMPLOYEE", "nazrul");
  const hire = (name: string) =>
    employees.createEmployee(admin.ctx, { name, joinDate: "2025-01-01", salary: 15000 });
  const nazrul = await hire("Nazrul Islam");
  await employees.grantPortalAccess(admin.ctx, nazrul.id, { userId: staff.user.id });
  const hasina = await hire("Hasina Begum");
  return { company, admin, pm, sales, accounts, store, staff, nazrul, hasina };
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

/** The subjects in a person's in-app inbox, sorted. */
const subjects = async (ctx: CompanyContext) =>
  (await inbox.listNotifications(ctx, { take: 100 })).items.map((n) => n.subject ?? "").sort();

const fire = (env: Env, now: Date) => runReminders(now, { companyId: env.company.id });

const makeProject = (env: Env, targetIn: number) =>
  projects.createProject(env.pm.ctx, {
    name: "Classic Polo run",
    targetDate: dayFromToday(targetIn),
    targetQuantity: 1000,
  });

async function makePurchaseOrder(env: Env, expectedIn: number) {
  const supplier = (
    await parties.createParty(env.admin.ctx, { kind: "SUPPLIER", name: "Narayanganj Fabrics" })
  ).party;
  const fabric = await materials.createMaterial(env.pm.ctx, {
    name: "Single Jersey 180 GSM",
    kind: "FABRIC",
    unit: "METER",
    supplierId: supplier.id,
  });
  return purchaseOrders.createPurchaseOrder(env.pm.ctx, {
    supplierId: supplier.id,
    expectedDate: dayFromToday(expectedIn),
    lines: [{ materialId: fabric.id, quantity: 500, unitPrice: 175 }],
  });
}

async function makeSalesOrder(env: Env, shipIn: number) {
  const ctx = env.admin.ctx;
  const size = await catalog.createSize(ctx, { name: "M" });
  const navy = await catalog.createColor(ctx, { name: "Navy", hexCode: "#1f2a44" });
  const tops = await catalog.createCategory(ctx, { name: "Tops" });
  const style = await styles.createStyle(ctx, {
    code: "EX-PL-001",
    name: "Classic Polo",
    categoryId: tops.id,
    wholesalePrice: 900,
  });
  await matrix.generateMatrix(ctx, style.id, { colorIds: [navy.id], sizeIds: [size.id] });
  const variant = await prisma.productVariant.findFirstOrThrow({ where: { styleId: style.id } });
  await stock.adjustStock(ctx, {
    variantId: variant.id,
    quantity: 100,
    type: "OPENING",
    unitCost: 500,
  });
  const buyer = (await parties.createParty(ctx, { kind: "BUYER", name: "Rahim Traders" })).party;
  return orders.createOrder(ctx, {
    channel: "WHOLESALE",
    partyId: buyer.id,
    lines: [{ variantId: variant.id, quantity: 10 }],
    shipmentDate: dayFromToday(shipIn),
  });
}

const makeLicence = (env: Env, expiresIn: number, extra: Record<string, unknown> = {}) =>
  compliance.createCompliance(env.admin.ctx, {
    type: "TRADE_LICENSE",
    number: "TRAD/DNCC/123",
    issuingAuthority: "Dhaka North City Corporation",
    expiryDate: dayFromToday(expiresIn),
    ...extra,
  });

const factoryVisit = (env: Env, dueIn: number) =>
  tasks.createTask(env.admin.ctx, {
    title: "Factory visit",
    assigneeId: env.nazrul.id,
    dueAt: `${dayFromToday(dueIn)}T10:30:00+06:00`,
    priority: "HIGH",
  });

type Tab = Awaited<ReturnType<typeof notes.listNotes>>;
const routineOf = async (ctx: CompanyContext, now: Date) =>
  (await notes.listNotes(ctx, { tab: "DAILY_ROUTINE" }, now)) as Extract<Tab, { total: number }>;
const planOf = async (ctx: CompanyContext, now: Date) =>
  (await notes.listNotes(ctx, { tab: "NEXT_3_DAYS" }, now)) as Extract<Tab, { days: unknown }>;
const generalOf = async (ctx: CompanyContext, search?: string) =>
  (await notes.listNotes(ctx, { tab: "GENERAL", search })) as Extract<Tab, { items: unknown }>;

run("notepad and planner", () => {
  beforeEach(resetDb);

  it("ticks routine items for the day only", async () => {
    const env = await setup();
    const me = env.staff.ctx;
    const plan = await notes.createNote(me, {
      tab: "DAILY_ROUTINE",
      content: "Check the cutting plan",
    });
    await notes.createNote(me, { tab: "DAILY_ROUTINE", content: "Count the finished cartons" });
    await notes.markNote(me, plan.id, { done: true }, at(0));
    expect(await routineOf(me, at(0))).toMatchObject({ date: dayFromToday(0), done: 1, total: 2 });
    // The next morning the list starts fresh.
    const tomorrow = await routineOf(me, at(1));
    expect(tomorrow).toMatchObject({ date: dayFromToday(1), done: 0, total: 2 });
    expect(tomorrow.items[0]).toMatchObject({
      content: "Check the cutting plan",
      done: false,
      lastDoneOn: dayFromToday(0),
    });
    expect(await notes.markNote(me, plan.id, { done: false }, at(0))).toMatchObject({
      done: false,
      lastDoneOn: null,
    });
  });

  it("plans three days ahead and carries unfinished items over", async () => {
    const env = await setup();
    const me = env.staff.ctx;
    const cut = await notes.createNote(
      me,
      { tab: "NEXT_3_DAYS", content: "Cut 500 polos", planDate: dayFromToday(0) },
      at(0),
    );
    const sew = await notes.createNote(
      me,
      { tab: "NEXT_3_DAYS", content: "Start sewing", planDate: dayFromToday(1) },
      at(0),
    );
    await notes.createNote(
      me,
      { tab: "NEXT_3_DAYS", content: "Quality check", planDate: dayFromToday(2) },
      at(0),
    );
    for (const planDate of [dayFromToday(3), dayFromToday(-1), undefined]) {
      await expectAppError(
        notes.createNote(me, { tab: "NEXT_3_DAYS", content: "Out of the plan", planDate }, at(0)),
        "VALIDATION",
      );
    }
    const plan = await planOf(me, at(0));
    expect(plan.days.map((d) => [d.date, d.items.map((i) => i.content)])).toEqual([
      [dayFromToday(0), ["Cut 500 polos"]],
      [dayFromToday(1), ["Start sewing"]],
      [dayFromToday(2), ["Quality check"]],
    ]);
    expect(plan.overdue).toEqual([]);

    // The next day: the cutting was not finished, so it is carried over.
    await notes.markNote(me, sew.id, { done: true }, at(1));
    const next = await planOf(me, at(1));
    expect(next.overdue.map((i) => i.content)).toEqual(["Cut 500 polos"]);
    expect(next.days.map((d) => d.date)).toEqual([
      dayFromToday(1),
      dayFromToday(2),
      dayFromToday(3),
    ]);
    expect(next.days[0]!.items).toMatchObject([{ content: "Start sewing", done: true }]);
    // An overdue item keeps its day when edited, or moves into the plan.
    expect(
      await notes.updateNote(me, cut.id, { content: "Cut 500 navy polos" }, at(1)),
    ).toMatchObject({ planDate: dayFromToday(0) });
    expect(
      (await notes.updateNote(me, cut.id, { planDate: dayFromToday(3) }, at(1))).planDate,
    ).toBe(dayFromToday(3));
    await expectAppError(
      notes.updateNote(me, cut.id, { planDate: dayFromToday(0) }, at(1)),
      "VALIDATION",
    );
    // Done items are not carried over; the quality check was never done.
    await notes.markNote(me, cut.id, { done: true }, at(5));
    expect((await planOf(me, at(5))).overdue.map((i) => i.content)).toEqual(["Quality check"]);
  });

  it("keeps general notes, pinned first, and moves notes between tabs", async () => {
    const env = await setup();
    const me = env.admin.ctx;
    const mills = await notes.createNote(me, {
      tab: "GENERAL",
      title: "Fabric mills",
      content: "Narayanganj Fabrics: ask for the new GSM chart",
    });
    const piping = await notes.createNote(me, {
      tab: "GENERAL",
      content: "Buyer wants navy piping",
      isPinned: true,
    });
    expect((await generalOf(me)).items.map((n) => n.id)).toEqual([piping.id, mills.id]);
    expect((await generalOf(me, "gsm")).items.map((n) => n.id)).toEqual([mills.id]);
    // A plan item needs its day.
    await expectAppError(
      notes.updateNote(me, mills.id, { tab: "NEXT_3_DAYS" }, at(0)),
      "VALIDATION",
    );
    expect(
      await notes.updateNote(
        me,
        mills.id,
        { tab: "NEXT_3_DAYS", planDate: dayFromToday(1) },
        at(0),
      ),
    ).toMatchObject({ tab: "NEXT_3_DAYS", planDate: dayFromToday(1), done: false });
    await expectAppError(
      notes.updateNote(me, piping.id, { planDate: dayFromToday(1) }, at(0)),
      "VALIDATION",
    );
    expect((await notes.updateNote(me, mills.id, { tab: "GENERAL" }, at(0))).planDate).toBeNull();
    await expect(notes.createNote(me, { tab: "GENERAL", content: "  " })).rejects.toThrow(ZodError);
  });

  it("keeps notes private and in their owner's order", async () => {
    const env = await setup();
    const me = env.staff.ctx;
    const ids: string[] = [];
    for (const content of ["One", "Two", "Three"]) {
      ids.push((await notes.createNote(me, { tab: "DAILY_ROUTINE", content })).id);
    }
    await notes.reorderNotes(me, { tab: "DAILY_ROUTINE", ids: [ids[2], ids[0], ids[1]] });
    expect((await routineOf(me, at(0))).items.map((n) => n.content)).toEqual([
      "Three",
      "One",
      "Two",
    ]);

    const other = env.admin.ctx;
    expect((await routineOf(other, at(0))).items).toEqual([]);
    await expectAppError(notes.markNote(other, ids[0]!, { done: true }), "NOT_FOUND");
    await expectAppError(notes.updateNote(other, ids[0]!, { content: "Mine now" }), "NOT_FOUND");
    await expectAppError(notes.deleteNote(other, ids[0]!), "NOT_FOUND");
    await expectAppError(
      notes.reorderNotes(other, { tab: "DAILY_ROUTINE", ids: [ids[0]!] }),
      "NOT_FOUND",
    );
    await expectAppError(notes.reorderNotes(me, { tab: "GENERAL", ids: [ids[0]!] }), "NOT_FOUND");
    expect(await notes.deleteNote(me, ids[0]!)).toEqual({ id: ids[0], deleted: true });
  });
});

run("tasks and the in-app inbox", () => {
  beforeEach(resetDb);

  it("gives staff tasks in the app and tells the creator when they are done", async () => {
    const env = await setup();
    const visit = await tasks.createTask(
      env.admin.ctx,
      {
        title: "Factory visit",
        description: "Check the sewing line",
        assigneeId: env.nazrul.id,
        dueAt: `${dayFromToday(2)}T10:30:00+06:00`,
        priority: "HIGH",
      },
      undefined,
      at(0),
    );
    expect(visit).toMatchObject({
      status: "TODO",
      priority: "HIGH",
      dueDay: dayFromToday(2),
      dueTime: "10:30",
      overdue: false,
      assignee: { id: env.nazrul.id, name: "Nazrul Islam", hasLogin: true },
      createdBy: { id: env.admin.user.id },
    });
    expect((await inbox.listNotifications(env.staff.ctx)).items).toMatchObject([
      {
        subject: "New task: Factory visit",
        body: `admin gave you a task, due ${formatDay(dayFromToday(2))} 10:30. Check the sewing line`,
        read: false,
        link: { type: "Task", id: visit.id },
      },
    ]);
    expect(await subjects(env.admin.ctx)).toEqual([]);

    // Hasina has no login yet: the task says so, and there is no one to tell.
    const sweep = await tasks.createTask(env.admin.ctx, {
      title: "Sweep the store",
      assigneeId: env.hasina.id,
      dueAt: dayFromToday(1),
    });
    expect(sweep).toMatchObject({ dueTime: null, assignee: { hasLogin: false } });
    expect(await prisma.notificationLog.count()).toBe(1);

    // Nazrul sees his open tasks in the portal and works through them.
    expect((await tasks.myTasks(env.staff.ctx)).items.map((t) => t.title)).toEqual([
      "Factory visit",
    ]);
    await tasks.setMyTaskStatus(env.staff.ctx, visit.id, { status: "IN_PROGRESS" });
    const done = await tasks.setMyTaskStatus(
      env.staff.ctx,
      visit.id,
      { status: "DONE" },
      undefined,
      at(2, "12:00"),
    );
    expect(done).toMatchObject({ status: "DONE", completedAt: at(2, "12:00") });
    expect((await inbox.listNotifications(env.admin.ctx)).items).toMatchObject([
      { subject: "Task done: Factory visit", body: 'Nazrul Islam finished "Factory visit".' },
    ]);
    expect((await tasks.myTasks(env.staff.ctx)).items).toEqual([]);
    expect((await tasks.myTasks(env.staff.ctx, { status: "DONE" })).items.map((t) => t.id)).toEqual(
      [visit.id],
    );
    await expectAppError(
      tasks.setMyTaskStatus(env.staff.ctx, visit.id, { status: "DONE" }),
      "CONFLICT",
    );
    await expectAppError(
      tasks.setMyTaskStatus(env.staff.ctx, sweep.id, { status: "DONE" }),
      "NOT_FOUND",
    );
    await expect(
      tasks.setMyTaskStatus(env.staff.ctx, visit.id, { status: "CANCELLED" }),
    ).rejects.toThrow(ZodError);
    await expectAppError(
      tasks.updateTask(env.admin.ctx, visit.id, { title: "Factory visit (Gazipur)" }),
      "CONFLICT",
    );
    // Without an employee profile there are no portal tasks.
    await expectAppError(tasks.myTasks(env.sales.ctx), "NOT_FOUND");

    // Handing a task to Nazrul tells him; cancelling it tells him too.
    await tasks.updateTask(env.admin.ctx, sweep.id, { assigneeId: env.nazrul.id });
    await tasks.setTaskStatus(env.admin.ctx, sweep.id, { status: "CANCELLED" });
    expect(await subjects(env.staff.ctx)).toEqual([
      "New task: Factory visit",
      "New task: Sweep the store",
      "Task cancelled: Sweep the store",
    ]);
    await expectAppError(
      tasks.setMyTaskStatus(env.staff.ctx, sweep.id, { status: "IN_PROGRESS" }),
      "CONFLICT",
    );

    // People who left cannot be given tasks.
    await prisma.employee.update({ where: { id: env.hasina.id }, data: { status: "RESIGNED" } });
    await expectAppError(
      tasks.createTask(env.admin.ctx, { title: "Count the stock", assigneeId: env.hasina.id }),
      "VALIDATION",
    );
    const audit = await prisma.auditLog.findMany({
      where: { entityType: "Task", entityId: visit.id },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.summary)).toEqual([
      `Task "Factory visit" for Nazrul Islam, due ${formatDay(dayFromToday(2))} 10:30`,
      'Task "Factory visit": to do -> in progress',
      'Task "Factory visit": in progress -> done',
    ]);
  });

  it("lists tasks by status, person, due day and words", async () => {
    const env = await setup();
    const visit = await factoryVisit(env, 1);
    const late = await tasks.createTask(env.pm.ctx, {
      title: "Send the size set",
      projectId: (await makeProject(env, 30)).id,
      dueAt: dayFromToday(-2),
    });
    const someday = await tasks.createTask(env.pm.ctx, { title: "Tidy the sample room" });
    const titles = async (query: Record<string, unknown>) =>
      (await tasks.listTasks(env.admin.ctx, query, at(0))).items.map((t) => t.title);

    expect(await titles({})).toEqual([late.title, visit.title, someday.title]);
    expect(await titles({ overdue: "true" })).toEqual([late.title]);
    expect(await titles({ assigneeId: env.nazrul.id })).toEqual([visit.title]);
    expect(await titles({ mine: "true" })).toEqual([visit.title]);
    expect(await titles({ from: dayFromToday(0), to: dayFromToday(1) })).toEqual([visit.title]);
    expect(await titles({ search: "SAMPLE" })).toEqual([someday.title]);
    expect((await tasks.getTask(env.admin.ctx, late.id, at(0))).overdue).toBe(true);
    await tasks.setTaskStatus(env.admin.ctx, late.id, { status: "DONE" });
    expect(await titles({ open: "true" })).toEqual([visit.title, someday.title]);
    const first = await tasks.listTasks(env.admin.ctx, { take: 1 }, at(0));
    expect(first.nextCursor).toBe(first.items[0]!.id);
    expect(
      (await tasks.listTasks(env.admin.ctx, { take: 5, cursor: first.nextCursor }, at(0))).items,
    ).toHaveLength(2);
    expect(await tasks.deleteTask(env.admin.ctx, someday.id)).toEqual({
      id: someday.id,
      deleted: true,
    });
    await expectAppError(tasks.getTask(env.admin.ctx, someday.id), "NOT_FOUND");
  });

  it("keeps each inbox to its owner, in this company", async () => {
    const env = await setup();
    await tasks.createTask(env.admin.ctx, { title: "Order thread", assigneeId: env.nazrul.id });
    await tasks.createTask(env.admin.ctx, { title: "Book the van", assigneeId: env.nazrul.id });
    const page = await inbox.listNotifications(env.staff.ctx, { take: 1 });
    expect(page).toMatchObject({ unread: 2, items: [{ subject: "New task: Book the van" }] });
    const rest = await inbox.listNotifications(env.staff.ctx, { take: 1, cursor: page.nextCursor });
    expect(rest.items.map((n) => n.subject)).toEqual(["New task: Order thread"]);

    await expectAppError(inbox.markNotificationRead(env.admin.ctx, page.items[0]!.id), "NOT_FOUND");
    expect((await inbox.markNotificationRead(env.staff.ctx, page.items[0]!.id)).read).toBe(true);
    expect(await inbox.unreadCount(env.staff.ctx)).toEqual({ unread: 1 });
    expect(
      (await inbox.listNotifications(env.staff.ctx, { unread: "true" })).items.map(
        (n) => n.subject,
      ),
    ).toEqual(["New task: Order thread"]);
    expect(await inbox.markAllNotificationsRead(env.staff.ctx)).toEqual({ updated: 1, unread: 0 });

    // The same person in another company sees nothing from this one.
    const other = await makeCompany("Other Co");
    await addToCompany(env.staff.user.id, other.company.id, other.roles.EMPLOYEE);
    const there = await contextFor(env.staff.user.id, other.company.id);
    expect(await inbox.listNotifications(there)).toMatchObject({ items: [], unread: 0 });
  });
});

run("reminders set by hand", () => {
  beforeEach(resetDb);

  it("lets anyone remind themselves and managers remind others", async () => {
    const env = await setup();
    const call = await reminders.createReminder(
      env.staff.ctx,
      {
        title: "Call Rahim Traders",
        message: "About the advance",
        day: dayFromToday(1),
        time: "10:00",
      },
      undefined,
      at(0),
    );
    expect(call).toMatchObject({
      status: "SCHEDULED",
      automatic: false,
      day: dayFromToday(1),
      time: "10:00",
      repeat: null,
      recipients: [{ kind: "user", id: env.staff.user.id, inApp: true }],
    });
    const later = (raw: Record<string, unknown>, ctx = env.staff.ctx) =>
      reminders.createReminder(
        ctx,
        { title: "Follow up", day: dayFromToday(1), ...raw },
        undefined,
        at(0),
      );
    await expectAppError(later({ userIds: [env.admin.user.id] }), "FORBIDDEN");
    await expectAppError(later({ employeeIds: [env.hasina.id] }), "FORBIDDEN");
    await expectAppError(later({ day: dayFromToday(-1) }), "VALIDATION");
    await expect(later({ remindAt: at(1).toISOString() })).rejects.toThrow(ZodError);

    const meeting = await reminders.createReminder(
      env.pm.ctx,
      {
        title: "Buyer meeting",
        remindAt: `${dayFromToday(1)}T15:00:00+06:00`,
        userIds: [env.pm.user.id, env.admin.user.id],
        employeeIds: [env.nazrul.id, env.hasina.id],
      },
      undefined,
      at(0),
    );
    expect(meeting.recipients.map((r) => [r.name, r.inApp]).sort()).toEqual([
      ["Hasina Begum", false],
      ["Nazrul Islam", true],
      ["admin", true],
      ["production", true],
    ]);
    const other = await setup("Other Co");
    await expectAppError(later({ userIds: [other.admin.user.id] }, env.pm.ctx), "VALIDATION");
    await expectAppError(later({ employeeIds: [other.nazrul.id] }, env.pm.ctx), "VALIDATION");
    await expectAppError(later({ taskId: "missing" }, env.pm.ctx), "NOT_FOUND");

    // Nothing goes out before its time, then each goes once.
    expect((await fire(env, at(1, "09:59"))).manual).toBe(0);
    expect(await fire(env, at(1, "10:00"))).toEqual({ manual: 1, automatic: 0, messages: 1 });
    expect((await inbox.listNotifications(env.staff.ctx)).items).toMatchObject([
      { subject: "Call Rahim Traders", body: "About the advance", reminderId: call.id },
    ]);
    // Pm, admin and Nazrul's login; Hasina waits for WhatsApp.
    expect(await fire(env, at(1, "15:00"))).toEqual({ manual: 1, automatic: 0, messages: 3 });
    expect(await fire(env, at(1, "15:05"))).toEqual({ manual: 0, automatic: 0, messages: 0 });
    expect((await reminders.getReminder(env.pm.ctx, meeting.id)).status).toBe("SENT");

    // Who sees it: its maker and the people on it; reminders.manage sees all.
    expect((await reminders.listReminders(env.staff.ctx)).items.map((r) => r.title)).toEqual([
      "Buyer meeting",
      "Call Rahim Traders",
    ]);
    await reminders.getReminder(env.sales.ctx, meeting.id);
    await expectAppError(reminders.getReminder(env.store.ctx, meeting.id), "NOT_FOUND");
    await expectAppError(reminders.listReminders(env.staff.ctx, { all: "true" }), "FORBIDDEN");
    expect((await reminders.listReminders(env.sales.ctx, { all: "true" })).items).toHaveLength(2);
    // Only its maker (or reminders.manage) changes it.
    await expectAppError(reminders.deleteReminder(env.staff.ctx, meeting.id), "FORBIDDEN");

    // Dealt with: by anyone it went to, and their message about it is read.
    const handled = await reminders.acknowledgeReminder(
      env.staff.ctx,
      meeting.id,
      undefined,
      at(1, "16:00"),
    );
    expect(handled).toMatchObject({
      status: "ACKNOWLEDGED",
      acknowledgedAt: at(1, "16:00"),
      acknowledgedBy: { id: env.staff.user.id },
    });
    const messages = await inbox.listNotifications(env.staff.ctx);
    expect(messages.items.find((n) => n.reminderId === meeting.id)!.read).toBe(true);
    expect(messages.unread).toBe(1);
  });

  it("changes, cancels and deletes a reminder until it goes out", async () => {
    const env = await setup();
    const visit = await reminders.createReminder(
      env.admin.ctx,
      {
        title: "Bank visit",
        day: dayFromToday(2),
        userIds: [env.admin.user.id],
        employeeIds: [env.nazrul.id],
      },
      undefined,
      at(0),
    );
    expect(visit.time).toBe("09:00");
    // Changing only the users keeps the staff on it.
    const moved = await reminders.updateReminder(
      env.admin.ctx,
      visit.id,
      { day: dayFromToday(3), userIds: [env.pm.user.id] },
      undefined,
      at(0),
    );
    expect(moved).toMatchObject({ day: dayFromToday(3), time: "09:00" });
    expect(moved.recipients.map((r) => r.name).sort()).toEqual(["Nazrul Islam", "production"]);
    await expectAppError(
      reminders.updateReminder(
        env.admin.ctx,
        visit.id,
        { day: dayFromToday(-1) },
        undefined,
        at(0),
      ),
      "VALIDATION",
    );
    await expectAppError(reminders.acknowledgeReminder(env.admin.ctx, visit.id), "CONFLICT");

    expect((await reminders.cancelReminder(env.admin.ctx, visit.id)).status).toBe("CANCELLED");
    await expectAppError(reminders.cancelReminder(env.admin.ctx, visit.id), "CONFLICT");
    await expectAppError(
      reminders.updateReminder(env.admin.ctx, visit.id, { title: "Bank visit (Motijheel)" }),
      "CONFLICT",
    );
    expect((await fire(env, at(3, "09:00"))).manual).toBe(0);
    expect(await reminders.deleteReminder(env.admin.ctx, visit.id)).toEqual({
      id: visit.id,
      deleted: true,
    });
    await expectAppError(reminders.getReminder(env.admin.ctx, visit.id), "NOT_FOUND");
  });

  it("repeats, and fires once after the server was off", async () => {
    const env = await setup();
    const vat = await reminders.createReminder(
      env.accounts.ctx,
      {
        title: "File the VAT return",
        day: dayFromToday(1),
        time: "10:00",
        repeat: { every: "WEEK" },
      },
      undefined,
      at(0),
    );
    expect(vat.repeat).toEqual({
      every: "WEEK",
      interval: 1,
      until: null,
      description: "Every week",
    });
    expect(await fire(env, at(1, "10:00"))).toMatchObject({ manual: 1, messages: 1 });
    expect(await reminders.getReminder(env.accounts.ctx, vat.id)).toMatchObject({
      status: "SCHEDULED",
      day: dayFromToday(8),
      time: "10:00",
      sentAt: at(1, "10:00"),
    });
    // Dealt with for this week; it stays on for the next.
    expect(
      await reminders.acknowledgeReminder(env.accounts.ctx, vat.id, undefined, at(1, "11:00")),
    ).toMatchObject({ status: "SCHEDULED", acknowledgedAt: at(1, "11:00") });

    // Off for three weeks: one message, then on to the next week to come.
    expect(await fire(env, at(23, "12:00"))).toMatchObject({ manual: 1, messages: 1 });
    expect((await reminders.getReminder(env.accounts.ctx, vat.id)).day).toBe(dayFromToday(29));
    expect(await subjects(env.accounts.ctx)).toEqual([
      "File the VAT return",
      "File the VAT return",
    ]);

    // With a last day it stops after it.
    const ending = await reminders.updateReminder(
      env.accounts.ctx,
      vat.id,
      { repeat: { every: "WEEK", until: dayFromToday(30) } },
      undefined,
      at(23, "13:00"),
    );
    expect(ending.repeat?.description).toBe(`Every week until ${formatDay(dayFromToday(30))}`);
    await fire(env, at(29, "10:00"));
    expect((await reminders.getReminder(env.accounts.ctx, vat.id)).status).toBe("SENT");
  });
});

run("automatic reminders", () => {
  beforeEach(resetDb);

  it("tells the people who can act on each date, once per step", async () => {
    const env = await setup();
    const project = await makeProject(env, 7);
    const po = await makePurchaseOrder(env, 3);
    const order = await makeSalesOrder(env, 7);
    await makeLicence(env, 30);
    const visit = await factoryVisit(env, 1);

    expect(await fire(env, at(0, "08:59"))).toEqual({ manual: 0, automatic: 0, messages: 0 });
    expect(await fire(env, at(0, "09:00"))).toEqual({ manual: 0, automatic: 5, messages: 10 });

    const deadline = `Production deadline: ${project.code} Classic Polo run`;
    const goods = `Goods due in-house: ${po.number} from Narayanganj Fabrics`;
    const shipment = `Shipment due: ${order.number} for Rahim Traders`;
    const renewal = "Renewal due: Trade licence TRAD/DNCC/123";
    const taskDue = "Task due: Factory visit";
    expect(await subjects(env.admin.ctx)).toEqual(
      [deadline, goods, shipment, renewal, taskDue].sort(),
    );
    expect(await subjects(env.pm.ctx)).toEqual([goods, deadline].sort());
    expect(await subjects(env.sales.ctx)).toEqual([shipment]);
    expect(await subjects(env.accounts.ctx)).toEqual([renewal]);
    expect(await subjects(env.store.ctx)).toEqual([]);
    expect(await subjects(env.staff.ctx)).toEqual(["New task: Factory visit", taskDue]);

    const sent = await prisma.reminder.findMany({
      where: { companyId: env.company.id, sourceKey: { not: null } },
    });
    const byType = (type: string) => sent.find((r) => r.type === type)!;
    expect(byType("GOODS_IN_HOUSE")).toMatchObject({
      sourceKey: `GOODS_IN_HOUSE:${po.id}:${dayFromToday(3)}:d3`,
      status: "SENT",
      offsetDays: 3,
      purchaseOrderId: po.id,
      title: goods,
      message: `Expected in-house ${formatDay(dayFromToday(3))} (in 3 days). Nothing received yet · 1 item`,
    });
    expect(byType("COMPLIANCE_EXPIRY").message).toBe(
      `Expires ${formatDay(dayFromToday(30))} (in 30 days). Trade licence · Issued by Dhaka North City Corporation`,
    );
    expect(byType("TASK_DUE")).toMatchObject({
      sourceKey: `TASK_DUE:${visit.id}:${dayFromToday(1)}:d1`,
      message: `Due ${formatDay(dayFromToday(1))} 10:30 (tomorrow). Assigned to Nazrul Islam · High priority`,
    });
    expect(byType("SHIPMENT").message).toMatch(
      new RegExp(`^Ship by ${formatDay(dayFromToday(7))} \\(in 7 days\\)\\. Order status: `),
    );
    expect(byType("PRODUCTION_DEADLINE").message).toMatch(
      /^Target date .* \(in 7 days\)\. Stage: .* · 0 of 1,000 pcs made$/,
    );

    // Each person's list shows the alerts they were told about.
    expect(
      (await reminders.listReminders(env.accounts.ctx, { automatic: "true" })).items.map(
        (r) => r.title,
      ),
    ).toEqual([renewal]);
    // Automatic reminders follow their record and cannot be edited by hand.
    await expectAppError(
      reminders.updateReminder(env.admin.ctx, byType("SHIPMENT").id, { title: "Ship it" }),
      "CONFLICT",
    );

    // Run again at once: nothing new. Tomorrow only the task, due that day.
    expect((await fire(env, at(0, "09:30"))).automatic).toBe(0);
    expect((await fire(env, at(1, "09:00"))).automatic).toBe(1);
  });

  it("waits for the send time, steps towards the date and repeats while overdue", async () => {
    const env = await setup();
    const project = await makeProject(env, 7);
    const step = async (n: number, time = "09:00") => (await fire(env, at(n, time))).automatic;
    expect(await step(0, "08:30")).toBe(0);
    expect(await step(0)).toBe(1); // a week before
    expect(await step(2)).toBe(0); // 5 days left: the week-before alert already went out
    expect(await step(4)).toBe(1); // 3 days before
    expect(await step(6)).toBe(1); // the day before
    expect(await step(7)).toBe(1); // on the day
    expect(await step(8)).toBe(1); // a day late
    expect(await step(10)).toBe(0); // 3 days late: every 3 days
    expect(await step(11)).toBe(1); // 4 days late
    const sent = await prisma.reminder.findMany({
      where: { projectId: project.id },
      orderBy: { remindAt: "asc" },
    });
    expect(sent.map((r) => r.sourceKey!.split(":").at(-1))).toEqual([
      "d7",
      "d3",
      "d1",
      "d0",
      "late0",
      "late1",
    ]);
    expect(sent[4]!.message).toContain("(overdue, 1 day ago)");
    expect(sent.map((r) => r.offsetDays)).toEqual([7, 3, 1, 0, -1, -4]);

    // A new target date starts the alerts again; a project on hold is paused.
    await projects.updateProject(env.pm.ctx, project.id, { targetDate: dayFromToday(20) });
    expect(await step(13)).toBe(1);
    await projects.setProjectStatus(env.pm.ctx, project.id, { status: "ON_HOLD" });
    expect(await step(17)).toBe(0);
  });

  it("follows each company's settings", async () => {
    const env = await setup();
    await makeProject(env, 7);
    const rule = await rules.updateRule(env.admin.ctx, "PRODUCTION_DEADLINE", {
      daysBefore: [10, 2, 2],
      sendTime: "08:00",
      notifyManagers: false,
      userIds: [env.sales.user.id],
      employeeIds: [env.nazrul.id, env.hasina.id],
    });
    expect(rule).toMatchObject({ daysBefore: [10, 2], sendTime: "08:00", customised: true });
    expect((await rules.listRules(env.admin.ctx)).find((r) => r.type === "SHIPMENT")).toMatchObject(
      { customised: false, daysBefore: [7, 3, 1, 0], managerPermissions: ["sales.order.create"] },
    );

    // 7 days left: inside the 10-day window, at the company's own time.
    expect((await fire(env, at(0, "08:00"))).automatic).toBe(1);
    expect(await subjects(env.sales.ctx)).toHaveLength(1);
    expect(await subjects(env.staff.ctx)).toHaveLength(1);
    expect(await subjects(env.pm.ctx)).toEqual([]);
    expect(await subjects(env.admin.ctx)).toEqual([]);
    const [alert] = (await reminders.listReminders(env.admin.ctx, { all: "true" })).items;
    expect(alert!.recipients.map((r) => [r.kind, r.name, r.inApp]).sort()).toEqual([
      ["employee", "Hasina Begum", false],
      ["employee", "Nazrul Islam", true],
      ["user", "sales", true],
    ]);

    // Turned off, nothing goes out; back on, the step due is sent.
    await rules.updateRule(env.admin.ctx, "PRODUCTION_DEADLINE", { isActive: false });
    expect((await fire(env, at(5, "08:00"))).automatic).toBe(0);
    await rules.updateRule(env.admin.ctx, "PRODUCTION_DEADLINE", { isActive: true });
    expect((await fire(env, at(5, "08:00"))).automatic).toBe(1);

    await expectAppError(
      rules.updateRule(env.admin.ctx, "BIRTHDAY", { isActive: true }),
      "NOT_FOUND",
    );
    const other = await setup("Other Co");
    await expectAppError(
      rules.updateRule(env.admin.ctx, "SHIPMENT", { userIds: [other.admin.user.id] }),
      "VALIDATION",
    );
    await expectAppError(
      rules.updateRule(env.admin.ctx, "SHIPMENT", { employeeIds: [other.nazrul.id] }),
      "VALIDATION",
    );
    await expect(rules.updateRule(env.admin.ctx, "SHIPMENT", { sendTime: "9am" })).rejects.toThrow(
      ZodError,
    );
    await expect(rules.updateRule(env.admin.ctx, "SHIPMENT", {})).rejects.toThrow(ZodError);
  });

  it("marks a task's alerts dealt with when it is done", async () => {
    const env = await setup();
    const visit = await factoryVisit(env, 1);
    expect((await fire(env, at(1, "09:00"))).automatic).toBe(1);
    await tasks.setMyTaskStatus(
      env.staff.ctx,
      visit.id,
      { status: "DONE" },
      undefined,
      at(1, "11:00"),
    );
    expect(
      (await prisma.reminder.findMany({ where: { taskId: visit.id } })).map((r) => [
        r.status,
        r.acknowledgedById,
      ]),
    ).toEqual([["ACKNOWLEDGED", env.staff.user.id]]);
    expect((await fire(env, at(3, "09:00"))).automatic).toBe(0);
  });

  it("keeps each company's alerts to its own people", async () => {
    const extras = await setup();
    const other = await setup("Other Co");
    await makeProject(extras, 7);
    expect((await runReminders(at(0, "09:00"))).automatic).toBe(1);
    expect(await subjects(extras.admin.ctx)).toHaveLength(1);
    expect(await subjects(other.admin.ctx)).toEqual([]);
    const agenda = await reminders.upcoming(other.admin.ctx, { days: 10 }, at(0, "08:00"));
    expect(agenda.days.flatMap((d) => d.items)).toEqual([]);
  });
});

run("coming up", () => {
  beforeEach(resetDb);

  it("shows each person the dates their role lets them see", async () => {
    const env = await setup();
    await makeProject(env, 6);
    await makePurchaseOrder(env, 3);
    await makeSalesOrder(env, 5);
    await makeLicence(env, 6);
    await factoryVisit(env, 1);
    await reminders.createReminder(
      env.staff.ctx,
      { title: "Collect the payslip", day: dayFromToday(2), time: "11:00" },
      undefined,
      at(0),
    );
    await reminders.createReminder(
      env.admin.ctx,
      { title: "Bank visit", day: dayFromToday(4) },
      undefined,
      at(0),
    );
    const kinds = async (ctx: CompanyContext) => {
      const agenda = await reminders.upcoming(ctx, { days: 7 }, at(0, "08:00"));
      expect(agenda).toMatchObject({ today: dayFromToday(0), until: dayFromToday(6) });
      expect(agenda.days).toHaveLength(7);
      return agenda.days.flatMap((d) => d.items.map((i) => i.kind)).sort();
    };
    expect(await kinds(env.admin.ctx)).toEqual([
      "COMPLIANCE_EXPIRY",
      "GOODS_IN_HOUSE",
      "PRODUCTION_DEADLINE",
      "REMINDER",
      "SHIPMENT",
      "TASK_DUE",
    ]);
    expect(await kinds(env.pm.ctx)).toEqual(["GOODS_IN_HOUSE", "PRODUCTION_DEADLINE", "TASK_DUE"]);
    expect(await kinds(env.sales.ctx)).toEqual(["SHIPMENT", "TASK_DUE"]);
    expect(await kinds(env.accounts.ctx)).toEqual([
      "COMPLIANCE_EXPIRY",
      "GOODS_IN_HOUSE",
      "PRODUCTION_DEADLINE",
      "SHIPMENT",
    ]);
    expect(await kinds(env.store.ctx)).toEqual([
      "GOODS_IN_HOUSE",
      "PRODUCTION_DEADLINE",
      "SHIPMENT",
    ]);
    expect(await kinds(env.staff.ctx)).toEqual(["REMINDER", "TASK_DUE"]);

    // Two days on, the task is overdue and listed as such.
    const later = await reminders.upcoming(env.staff.ctx, { days: 3 }, at(2, "08:00"));
    expect(later.overdue).toMatchObject([
      {
        kind: "TASK_DUE",
        title: "Factory visit",
        date: dayFromToday(1),
        time: "10:30",
        daysLeft: -1,
      },
    ]);
    expect(later.days[0]!.items).toMatchObject([
      { kind: "REMINDER", title: "Collect the payslip", time: "11:00", daysLeft: 0 },
    ]);
  });
});
