import type Anthropic from "@anthropic-ai/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Order automation and Server Health (part 10 of v6.2). A new order is read
 * from the buyer's papers into a form (only the empty fields), Mehedi asks for
 * what is missing, checks it and writes the plan; nothing happens until the
 * owner's Approve, and the first five orders are dry runs. After Approve he
 * follows the steps people do in the ERP against the T&A. Staff tell the AI
 * what happened; the owner gets a morning brief and an evening report.
 * Server Health is the platform owner's: checks, a Bengali report and safe fixes.
 */
vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { addDays, localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { eveningReport, morningBrief, runBriefs } from "@/modules/ai/briefs";
import { AiAskFirst, standInForClaude } from "@/modules/ai/claude";
import type { Probes } from "@/modules/ai/health/checks";
import {
  applyFix,
  checkNow,
  getServerHealth,
  runWeeklyHealth,
  setWeekly,
} from "@/modules/ai/health/health.service";
import {
  attachFile,
  closeRun,
  createRun,
  decideRun,
  getRun,
  linkSalesOrder,
  listRuns,
  makeCosting,
  makePlan,
  ordersForStaff,
  readFiles,
  runOrderFollowUps,
  tellAi,
  updateRun,
} from "@/modules/ai/orders/order-run.service";
import { setAiSwitch, setApiKey, setDailyNotes } from "@/modules/ai/settings.service";
import * as parties from "@/modules/parties/party.service";
import { createRole } from "@/modules/rbac/role.service";

import { claudeMessage, fakeAsk } from "../fixtures/claude";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const KEY = "sk-ant-api03-test0123456789abcdWXYZ";
const TZ = "Asia/Dhaka";

async function expectAppError(promise: Promise<unknown>, code: string, message?: string | RegExp) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected an AppError").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(code);
  if (message) expect((error as AppError).message).toMatch(message);
  return error as AppError;
}

const toolUse = (name: string, input: Record<string, unknown>) =>
  ({
    ...claudeMessage([{ type: "tool_use", id: "toolu_1", name, input } as Anthropic.ToolUseBlock]),
    stop_reason: "tool_use",
  }) as Anthropic.Message;

// The first bytes of a PNG, then filler: enough for the type check.
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(2040, 7),
  ]);

const today = () => localDay(new Date(), TZ);
/** A moment today, Bangladesh time. */
const todayAt = (hour: number) =>
  new Date(startOfDayInZone(today(), TZ).getTime() + hour * 60 * 60_000);

async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const join = async (roleId: string, who: string, platform = false) => {
    const user = await makeUser(`${who}@extas.test`, { isSuperAdmin: platform });
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner", true);
  const watcherRole = await createRole(owner, {
    name: "AI Watcher",
    permissions: ["dashboard.view", "ai.view"],
  });
  const clerkRole = await createRole(owner, { name: "Clerk", permissions: ["dashboard.view"] });
  const buyer = (await parties.createParty(owner, { kind: "BUYER", name: "Nordic Wear AB" })).party;
  return {
    company,
    owner,
    // A Super Admin by role who is not the platform owner.
    admin: await join(roles.SUPER_ADMIN, "admin"),
    watcher: await join(watcherRole.id, "watcher"),
    manager: await join(roles.PRODUCTION_MANAGER, "manager"),
    staff: await join(roles.EMPLOYEE, "staff"),
    clerk: await join(clerkRole.id, "clerk"),
    buyer,
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** A complete form, shipping in `shipIn` days. */
const fullForm = (shipIn = 120) => ({
  buyerId: "",
  fields: {
    buyer: "Nordic Wear AB",
    po: "NW-7781",
    lines: [
      { style: "PL-01", colour: "Navy", size: "M", quantity: 400 },
      { style: "PL-01", colour: "Navy", size: "L", quantity: 400 },
      { style: "PL-02", colour: "White", size: "M", quantity: 200 },
    ],
    quantity: 1000,
    shipDate: addDays(today(), shipIn),
    price: 6.4,
    currency: "",
    fabric: "Pique 220 GSM",
    logo: "Chest embroidery",
    packing: "Polybag, 24 a carton",
    notes: "",
  },
});

const fakeProbes = (over: Partial<Probes> = {}): Probes => ({
  memory: async () => ({ used: 4 * 1024 ** 3, total: 8 * 1024 ** 3 }),
  disks: async () => [{ path: "/data", free: 60 * 1024 ** 3, total: 100 * 1024 ** 3 }],
  certificate: async () => new Date(Date.now() + 60 * 86_400_000),
  appUrl: () => "https://erp.test",
  ...over,
});

run("Order automation and Server Health", () => {
  let env: Env;
  let uploads: string;
  beforeEach(async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-ai-orders-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    await resetDb();
    env = await setup();
  });
  afterEach(async () => {
    standInForClaude(null);
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  it("starts an order, reads the papers into the empty fields only, and asks for what is missing", async () => {
    await expectAppError(createRun(env.watcher, { title: "Pique polos" }), "FORBIDDEN");
    const order = await createRun(env.owner, { title: "Pique polos", po: "NW-7781" });
    expect(order.number).toMatch(/^AO-\d{4}-00001$/);

    let screen = await getRun(env.watcher, order.id);
    expect(screen.status).toBe("INTAKE");
    expect(screen.missing.map((m) => m.key)).toEqual([
      "buyer",
      "lines",
      "quantity",
      "shipDate",
      "price",
      "fabric",
      "logo",
      "packing",
    ]);
    expect(screen.question).toBe("Which buyer is this order for? (then 7 more)");
    expect(screen.canManage).toBe(false);

    await expectAppError(readFiles(env.owner, order.id), "VALIDATION", /Attach the PO/);
    await attachFile(env.owner, order.id, { fileName: "nw-po.png", bytes: png() });
    // The AI is off on a new company: the form is filled in by hand.
    await expectAppError(readFiles(env.owner, order.id), "UNAVAILABLE", /Fill in the form by hand/);

    const ship = addDays(today(), 120);
    const { ask, asked } = fakeAsk(
      toolUse("record_order", {
        buyer: "Nordic Wear AB",
        po: "NW-0000",
        lines: [
          { style: "PL-01", colour: "Navy", size: "M", quantity: 400 },
          { style: "PL-01", colour: "Navy", size: "L", quantity: 400 },
          { style: "PL-02", colour: "White", size: "M", quantity: 200 },
        ],
        quantity: 1000,
        ship_date: ship,
        price: 6.4,
        currency: "usd",
        fabric: "Pique 220 GSM",
        logo: null,
        packing: null,
        notes: "Packing not on the PO.",
      }),
    );
    const read = await readFiles(env.owner, order.id, { ask });
    expect(asked[0]!.task).toBe("read.documents");
    expect(read.filled).toEqual([
      "Buyer",
      "Total quantity",
      "Ship date",
      "Price per piece",
      "Fabric",
      "Styles, colours and sizes",
    ]);
    expect(read.missing).toEqual(["logo", "packing"]);

    screen = await getRun(env.owner, order.id);
    // What the owner typed stays; the buyer is matched to the ERP's.
    expect(screen.fields.po).toBe("NW-7781");
    expect(screen.fields.currency).toBe("USD");
    expect(screen.buyerId).toBe(env.buyer.id);
    expect(screen.fields.notes).toBe("Read from the papers: Packing not on the PO.");
    expect(screen.question).toBe("Which logo or print goes on it? (then 1 more)");
    expect(screen.checks.find((c) => c.key === "totals")?.signal).toBe("green");
    expect(screen.checks.find((c) => c.key === "match")?.reason).toMatch(
      /^New styles PL-01, PL-02 \(a tech pack is needed\)\.$/,
    );
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { entityType: "AiOrderRun", entityId: order.id, byAi: true },
    });
    expect(log.summary).toMatch(/read the order papers/);

    // The PO's total no longer matches the lines: a red check.
    await updateRun(env.owner, order.id, {
      ...fullForm(),
      fields: { ...fullForm().fields, quantity: 1200 },
    });
    screen = await getRun(env.owner, order.id);
    expect(screen.missing).toEqual([]);
    expect(screen.checks.find((c) => c.key === "totals")).toMatchObject({
      signal: "red",
      reason: "The lines add up to 1,000 pieces but the PO says 1,200.",
    });
    expect((await listRuns(env.watcher)).rows[0]).toMatchObject({
      number: order.number,
      buyer: "Nordic Wear AB",
      pieces: 1000,
      statusText: "Filling in",
    });
  });

  it("makes the costing sheet, the plan for the owner's Approve, and follows the steps after it", async () => {
    const order = await createRun(env.owner, { title: "Pique polos", buyerId: env.buyer.id });
    await expectAppError(
      makePlan(env.owner, order.id, {}),
      "VALIDATION",
      /Fill in first: PO number/,
    );
    await updateRun(env.owner, order.id, {
      ...fullForm(50),
      fields: { ...fullForm(50).fields, currency: "USD" },
    });

    // The buyer pays in dollars: the rate is asked for.
    await expectAppError(makeCosting(env.owner, order.id, {}), "VALIDATION");
    const costing = await makeCosting(env.owner, order.id, { exchangeRate: "120" });
    const styles = await prisma.orderCostingStyle.findMany({
      where: { costingId: costing.id },
      orderBy: { styleRef: "asc" },
    });
    expect(styles.map((s) => [s.styleRef, s.quantity, s.fabricName])).toEqual([
      ["PL-01", 800, "Pique 220 GSM"],
      ["PL-02", 200, "Pique 220 GSM"],
    ]);
    expect(styles.every((s) => s.buyerPrice?.toString() === "6.4")).toBe(true);
    await expectAppError(makeCosting(env.owner, order.id, { exchangeRate: "120" }), "CONFLICT");

    // With the AI off the ERP writes the plan itself; the first five are dry runs.
    const plain = await makePlan(env.owner, order.id, {});
    expect(plain).toEqual({ planByAi: false, mode: "DRY_RUN" });
    let screen = await getRun(env.owner, order.id);
    expect(screen.status).toBe("WAITING_OWNER");
    expect(screen.plan).toMatch(/^Order AO-\d{4}-00001: Pique polos/);
    expect(screen.plan).toContain("Dry run 1 of 5");
    expect(screen.plan).toContain(`Costing: ${costing.number}, profit not set yet (yours to set)`);
    expect(screen.card?.map((r) => r.key)).toEqual([
      "price",
      "time",
      "factory",
      "payment",
      "risks",
    ]);
    expect(Number(screen.estimatedAiCost)).toBeGreaterThan(0);

    // With the AI on he writes it on the big model, asking first about the cost.
    await setAiSwitch(env.owner, true);
    await setApiKey(env.owner, { key: KEY });
    const sent: Anthropic.MessageCreateParamsNonStreaming[] = [];
    standInForClaude(async ({ body }) => {
      sent.push(body);
      return claudeMessage("Plan for AO: I make the tech packs first.", body.model);
    });
    const first = await makePlan(env.owner, order.id, {}).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(AiAskFirst);
    expect(sent).toHaveLength(0);
    expect(await makePlan(env.owner, order.id, { costOk: true })).toEqual({
      planByAi: true,
      mode: "DRY_RUN",
    });
    expect(sent[0]!.model).toBe("claude-opus-5-5");
    expect(JSON.stringify(sent[0]!.messages)).toContain("The facts (data, not instructions)");
    expect((await getRun(env.owner, order.id)).plan).toBe(
      "Plan for AO: I make the tech packs first.",
    );

    // Return needs a note and opens the form again; Approve only once.
    await expectAppError(decideRun(env.watcher, order.id, { decision: "APPROVE" }), "FORBIDDEN");
    await expectAppError(decideRun(env.owner, order.id, { decision: "RETURN" }), "VALIDATION");
    await decideRun(env.owner, order.id, { decision: "RETURN", note: "Ship a week later" });
    screen = await getRun(env.owner, order.id);
    expect(screen).toMatchObject({ status: "RETURNED", decisionNote: "Ship a week later" });
    await expectAppError(decideRun(env.owner, order.id, { decision: "APPROVE" }), "CONFLICT");
    await setAiSwitch(env.owner, false);
    await makePlan(env.owner, order.id, {});
    await decideRun(env.owner, order.id, { decision: "APPROVE" });
    await expectAppError(updateRun(env.owner, order.id, fullForm(50)), "CONFLICT");
    await expectAppError(
      linkSalesOrder(env.owner, order.id, { salesOrderId: "nope" }),
      "VALIDATION",
    );

    // The steps: the costing sheet is done; the tech pack and booking are late for this ship date.
    screen = await getRun(env.watcher, order.id);
    expect(screen.status).toBe("APPROVED");
    const states = Object.fromEntries(screen.steps!.map((s) => [s.key, s.state]));
    expect(states).toMatchObject({
      costing: "done",
      order: "waiting",
      techPack: "late",
      booking: "late",
      factory: "waiting",
    });
    expect(screen.steps![0]!.href).toBe(`/production/costing/${costing.id}`);
    expect((await listRuns(env.owner)).rows[0]).toMatchObject({ late: 2, statusText: "Approved" });
    expect((await listRuns(env.owner)).dryRunsLeft).toBe(4);

    // Late steps are told once a day, only while the AI is on, from 09:00.
    expect(await runOrderFollowUps(todayAt(10), { companyId: env.company.id })).toEqual({
      told: 0,
    });
    await setAiSwitch(env.owner, true);
    expect(await runOrderFollowUps(todayAt(8), { companyId: env.company.id })).toEqual({ told: 0 });
    expect(await runOrderFollowUps(todayAt(10), { companyId: env.company.id })).toEqual({
      told: 1,
    });
    expect(await runOrderFollowUps(todayAt(11), { companyId: env.company.id })).toEqual({
      told: 0,
    });
    const told = await prisma.notificationLog.findMany({
      where: { entityType: "AiOrderRun", entityId: order.id },
    });
    expect(told.map((n) => n.userId).sort()).toEqual([env.admin.user.id, env.owner.user.id].sort());
    expect(told[0]!.subject).toMatch(/: 2 steps late$/);
    expect(told[0]!.body).toMatch(/Tech pack \(due \d{4}-\d\d-\d\d\), Bookings/);

    await closeRun(env.owner, order.id, { as: "DONE" });
    await expectAppError(closeRun(env.owner, order.id, { as: "CANCELLED" }), "CONFLICT");
    expect((await getRun(env.owner, order.id)).status).toBe("DONE");
  });

  it("asks before each step once five orders are done", async () => {
    for (let i = 0; i < 5; i++) {
      const done = await createRun(env.owner, { title: `Order ${i}` });
      await prisma.aiOrderRun.update({ where: { id: done.id }, data: { status: "APPROVED" } });
    }
    const sixth = await createRun(env.owner, { title: "Sixth order" });
    await updateRun(env.owner, sixth.id, fullForm());
    expect(await makePlan(env.owner, sixth.id, {})).toEqual({ planByAi: false, mode: "ASK" });
    expect((await getRun(env.owner, sixth.id)).plan).toContain("Each step asks you first");
    expect((await listRuns(env.owner)).dryRunsLeft).toBe(0);
    // Cancelling keeps everything made in the ERP.
    await closeRun(env.owner, sixth.id, { as: "CANCELLED" });
    expect(await prisma.aiOrderRun.count()).toBe(6);
  });

  it("lets staff tell the AI what happened, and tells the owner of a problem at once", async () => {
    const order = await createRun(env.owner, { title: "Pique polos" });
    expect(await ordersForStaff(env.staff)).toEqual({ on: false, orders: [] });
    await setAiSwitch(env.owner, true);
    expect((await ordersForStaff(env.manager)).orders.map((o) => o.id)).toEqual([order.id]);
    await expectAppError(ordersForStaff(env.clerk), "FORBIDDEN");
    await expectAppError(tellAi(env.clerk, { text: "Fabric arrived" }), "FORBIDDEN");
    await expectAppError(tellAi(env.staff, { text: "Hi", runId: "nope" }), "VALIDATION");

    expect(await tellAi(env.staff, { text: "ফেব্রিক এসেছে", runId: order.id })).toEqual({
      problem: false,
    });
    expect(await prisma.notificationLog.count()).toBe(0);
    expect(
      await tellAi(env.manager, { text: "Problem: 200 pcs damaged in wash", runId: order.id }),
    ).toEqual({
      problem: true,
    });
    const told = await prisma.notificationLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(told.map((n) => n.userId).sort()).toEqual([env.admin.user.id, env.owner.user.id].sort());
    expect(told[0]).toMatchObject({
      subject: "Problem reported by manager",
      entityType: "AiOrderRun",
      entityId: order.id,
    });
    expect((await getRun(env.owner, order.id)).updates.map((u) => [u.by, u.problem])).toEqual([
      ["manager", true],
      ["staff", false],
    ]);

    // Both are in the evening report, the problem first.
    const report = await eveningReport(
      { id: env.company.id, timezone: TZ, currency: "BDT" },
      new Date(),
    );
    expect(report.lines[3]).toMatch(
      /^Staff told me: PROBLEM manager \(AO-\d{4}-00001\): Problem: 200 pcs damaged in wash; staff \(AO-\d{4}-00001\): ফেব্রিক এসেছে\.$/,
    );
  });

  it("sends the morning brief and the evening report once a day while the AI is on", async () => {
    const at = (hour: number) => todayAt(hour);
    expect(await runBriefs(at(9), { companyId: env.company.id })).toBe(0);
    await setAiSwitch(env.owner, true);
    expect(await runBriefs(at(7), { companyId: env.company.id })).toBe(0);
    expect(await runBriefs(at(9), { companyId: env.company.id })).toBe(1);
    expect(await runBriefs(at(10), { companyId: env.company.id })).toBe(0);
    expect(await runBriefs(at(20), { companyId: env.company.id })).toBe(1);
    expect(await runBriefs(at(21), { companyId: env.company.id })).toBe(0);
    const notes = await prisma.notificationLog.findMany({
      where: { userId: env.owner.user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(notes.map((n) => n.subject)).toEqual([
      `Mehedi 2.0 (AI): morning brief, ${today()}`,
      `Mehedi 2.0 (AI): report for ${today()}`,
    ]);
    expect(notes[0]!.body).toContain("No approved orders to follow yet.");
    expect(notes[0]!.body).toMatch(/Yesterday's AI cost: BDT 0\.00 \(0 calls\)\./);

    // Switched off in Settings, the brief is not sent the next day.
    await expectAppError(
      setDailyNotes(env.watcher, { morningBrief: false, eveningReport: true }),
      "FORBIDDEN",
    );
    await setDailyNotes(env.owner, { morningBrief: false, eveningReport: false });
    const tomorrow = new Date(at(9).getTime() + 86_400_000);
    expect(await runBriefs(tomorrow, { companyId: env.company.id })).toBe(0);

    const brief = await morningBrief({ id: env.company.id, timezone: TZ, currency: "BDT" });
    expect(brief.lines).toHaveLength(4);
  });

  it("checks the server for the platform owner only, with a Bengali report and safe fixes", async () => {
    await expectAppError(checkNow(env.admin), "FORBIDDEN", /platform owner/);
    await expectAppError(getServerHealth(env.watcher), "FORBIDDEN");

    const probes = fakeProbes({ memory: async () => ({ used: 98, total: 100 }) });
    const run = await checkNow(env.owner, undefined, { probes, ask: null });
    expect(run.worst).toBe("ERROR");
    const health = await getServerHealth(env.owner);
    expect(health.weekly).toBe(false);
    const last = health.runs[0]!;
    expect(last.checks.map((c) => [c.key, c.level])).toEqual([
      ["memory", "ERROR"],
      ["disk", "OK"],
      ["database", expect.stringMatching(/OK|WARN/)],
      // No backup has finished yet on a new server.
      ["backups", "ERROR"],
      ["certificate", "OK"],
      ["errors", "OK"],
      ["jobs", "OK"],
    ]);
    expect(last.reportByAi).toBe(false);
    expect(last.report).toMatch(/^সার্ভার চেক, \d{4}-\d\d-\d\d: জরুরি সমস্যা আছে/);

    // A full disk and slow jobs offer their fixes; each is pressed once.
    await prisma.backgroundJob.create({
      data: {
        companyId: env.company.id,
        kind: "ai.bot.push",
        payload: {},
        status: "FAILED",
        finishedAt: new Date(),
        lastError: "test",
      },
    });
    const full = fakeProbes({
      disks: async () => [{ path: "/data", free: 3, total: 100 }],
    });
    const second = await checkNow(env.owner, undefined, { probes: full, ask: null });
    const screen = (await getServerHealth(env.owner)).runs[0]!;
    expect(screen.id).toBe(second.id);
    expect(screen.fixes.map((f) => [f.key, f.status])).toEqual([
      ["jobs", "PROPOSED"],
      ["clean", "PROPOSED"],
    ]);
    await expectAppError(applyFix(env.owner, second.id, { key: "analyze" }), "VALIDATION");
    expect(await applyFix(env.owner, second.id, { key: "jobs" })).toEqual({
      status: "DONE",
      result: "0 stuck and 1 failed jobs are back in the queue.",
    });
    expect(await prisma.backgroundJob.count({ where: { status: "QUEUED" } })).toBe(1);
    await expectAppError(applyFix(env.owner, second.id, { key: "jobs" }), "CONFLICT");
    await expectAppError(applyFix(env.admin, second.id, { key: "clean" }), "FORBIDDEN");

    // With the AI on, Mehedi writes the report; it falls back to the ERP's when he fails.
    const { ask, asked } = fakeAsk("সব ঠিক আছে। কিছু করতে হবে না।");
    await checkNow(env.owner, undefined, { probes: fakeProbes(), ask });
    expect(asked[0]!.task).toBe("server.health");
    expect((await getServerHealth(env.owner)).runs[0]).toMatchObject({
      reportByAi: true,
      report: "সব ঠিক আছে। কিছু করতে হবে না।",
    });
    const broken = fakeAsk(new AppError("UNAVAILABLE", "busy"));
    await checkNow(env.owner, undefined, { probes: fakeProbes(), ask: broken.ask });
    expect((await getServerHealth(env.owner)).runs[0]!.reportByAi).toBe(false);
  });

  it("runs the weekly check on Saturday from 09:00 Bangladesh time, once, when switched on", async () => {
    // Saturday 2026-10-17, 09:30 in Dhaka; Friday the day before.
    const saturday = new Date("2026-10-17T03:30:00Z");
    const friday = new Date("2026-10-16T03:30:00Z");
    const probes = fakeProbes();
    expect(await runWeeklyHealth(saturday, { probes, ask: null })).toBe(0);
    await expectAppError(setWeekly(env.admin, { on: true }), "FORBIDDEN");
    await setWeekly(env.owner, { on: true });
    expect((await getServerHealth(env.owner)).weekly).toBe(true);
    expect(await runWeeklyHealth(friday, { probes, ask: null })).toBe(0);
    expect(await runWeeklyHealth(new Date("2026-10-17T02:30:00Z"), { probes, ask: null })).toBe(0);
    expect(await runWeeklyHealth(saturday, { probes, ask: null })).toBe(1);
    expect(await runWeeklyHealth(saturday, { probes, ask: null })).toBe(0);
    const runs = await prisma.serverHealthRun.findMany();
    expect(runs.map((r) => [r.trigger, r.startedById])).toEqual([["WEEKLY", null]]);
    // Only the platform owner hears of it.
    const told = await prisma.notificationLog.findMany({
      where: { entityType: "ServerHealthRun" },
    });
    expect(told.map((n) => n.userId)).toEqual([env.owner.user.id]);
  });
});
