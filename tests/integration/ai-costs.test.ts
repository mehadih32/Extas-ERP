import Anthropic from "@anthropic-ai/sdk";
import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * AI cost tracking: every call to Claude writes a cost line (who asked, the
 * task, why, the record, the model, the tokens, the cost in dollars and taka);
 * the budget and limits are checked before each call (stop, or go on with the
 * small model); the owner is told once at the alert percentage; big work asks
 * first; Budget & Costs shows it by period with breakdowns, and as PDF or Excel.
 */
const signedIn = vi.hoisted(() => ({ ctx: null as unknown }));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/modules/auth/context", async (original) => {
  const real = await original<typeof import("@/modules/auth/context")>();
  const { AppError } = await import("@/lib/errors");
  const ctx = () => signedIn.ctx as import("@/modules/auth/context").CompanyContext;
  return {
    ...real,
    requireCompany: async () => ctx(),
    requirePermission: async (...keys: string[]) => {
      if (keys.some((k) => !ctx().permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx();
    },
    requireAnyPermission: async (...keys: string[]) => {
      if (!keys.some((k) => ctx().permissions.has(k as never))) {
        throw new AppError("FORBIDDEN", "You do not have permission to do this.");
      }
      return ctx();
    },
  };
});

import { addDays, localDay, startOfDayInZone } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { AiAskFirst, askClaude, type ClaudeRequest, standInForClaude } from "@/modules/ai/claude";
import { costsFile } from "@/modules/ai/costs-export";
import { getCosts, getMonthCost, recordCost, setBudget } from "@/modules/ai/costs.service";
import { setAiSwitch, setApiKey, setAssistantName } from "@/modules/ai/settings.service";
import { recordHref } from "@/modules/reminders/links";
import { createRole } from "@/modules/rbac/role.service";
import {
  getAiRecordCostAction,
  getCostsAction,
  setBudgetAction,
} from "@/server/actions/ai.actions";

import { claudeMessage } from "../fixtures/claude";
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

async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const other = await makeCompany("Extas Uttara");
  const join = async (roleId: string, who: string, companyId = company.id) => {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, companyId, roleId);
    return contextFor(user.id, companyId);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  const watcherRole = await createRole(owner, {
    name: "AI Watcher",
    permissions: ["dashboard.view", "ai.view"],
  });
  return {
    company,
    other: other.company,
    otherRoles: other.roles,
    owner,
    pm: await join(roles.PRODUCTION_MANAGER, "pm"),
    watcher: await join(watcherRole.id, "watcher"),
    outsider: await join(other.roles.SUPER_ADMIN, "outsider", other.company.id),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Claude answers every call with these token counts, recording the model asked for. */
function standIn(usage: Partial<Anthropic.Usage> = {}, fail?: Error) {
  const models: string[] = [];
  standInForClaude(async ({ body }) => {
    models.push(body.model);
    if (fail) throw fail;
    return claudeMessage("Done.", body.model, usage);
  });
  return models;
}

async function switchOn(env: Env) {
  await setAiSwitch(env.owner, true);
  await setApiKey(env.owner, { key: KEY });
}

const write = (extra: Partial<ClaudeRequest> = {}): ClaudeRequest => ({
  task: "text.write",
  why: "Tech pack notes for EX-PL-001",
  maxTokens: 500,
  messages: [{ role: "user", content: "Facts" }],
  ...extra,
});

/** A cost line written straight into the log, `daysAgo` days back (company time, at noon). */
async function line(
  companyId: string,
  cost: string,
  opts: {
    daysAgo?: number;
    at?: Date;
    userId?: string | null;
    task?: string;
    model?: string;
    agent?: string;
    record?: { type: string; id: string; label: string };
  } = {},
) {
  const day = addDays(localDay(new Date(), TZ), -(opts.daysAgo ?? 0));
  const at =
    opts.at ??
    new Date(Math.min(Date.now() - 1000, startOfDayInZone(day, TZ).getTime() + 12 * 3600 * 1000));
  return prisma.aiUsage.create({
    data: {
      companyId,
      userId: opts.userId ?? null,
      agent: opts.agent ?? "Mehedi 2.0",
      task: opts.task ?? "text.write",
      module: "Reports",
      why: `Seeded ${cost}`,
      recordType: opts.record?.type ?? null,
      recordId: opts.record?.id ?? null,
      recordLabel: opts.record?.label ?? null,
      model: opts.model ?? "claude-sonnet-5-5",
      costUsd: new Prisma.Decimal(cost).dividedBy(122).toDecimalPlaces(6),
      cost,
      usdRate: 122,
      result: "OK",
      createdAt: at,
    },
  });
}

const BUDGET = {
  monthly: "",
  daily: "",
  perOrder: "",
  perStaffMonthly: "",
  perAgentMonthly: "",
  askAbove: "",
  alertPercent: "80",
  atLimit: "STOP",
  usdRate: "122",
};

run("AI cost tracking", () => {
  let env: Env;
  beforeEach(async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.spyOn(console, "error").mockImplementation(() => {});
    await resetDb();
    env = await setup();
  });
  afterEach(() => {
    standInForClaude(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("writes a cost line for every call: who, task, why, record, model, tokens and cost", async () => {
    standIn({ input_tokens: 10_000, output_tokens: 2_000, cache_read_input_tokens: 5_000 });
    // Off: nothing is called and nothing is written.
    await expectAppError(askClaude(env.company.id, write()), "UNAVAILABLE", /switched off/);
    expect(await prisma.aiUsage.count()).toBe(0);

    await switchOn(env);
    await askClaude(
      env.company.id,
      write({
        userId: env.pm.user.id,
        record: { type: "ProductionProject", id: "proj-1", label: "EX-PL-001" },
      }),
    );
    const row = await prisma.aiUsage.findFirstOrThrow();
    // Sonnet 5.5: 10,000 in × $2 + 2,000 out × $10 + 5,000 cache × $0.20 per million = $0.041.
    expect(row).toMatchObject({
      companyId: env.company.id,
      userId: env.pm.user.id,
      agent: "Mehedi 2.0",
      task: "text.write",
      module: "Reports",
      why: "Tech pack notes for EX-PL-001",
      recordType: "ProductionProject",
      recordId: "proj-1",
      recordLabel: "EX-PL-001",
      model: "claude-sonnet-5-5",
      inputTokens: 10_000,
      outputTokens: 2_000,
      cacheReadTokens: 5_000,
      result: "OK",
      note: null,
    });
    expect(row.costUsd.toFixed(6)).toBe("0.041000");
    // At the default 122 taka to the dollar: 5.002, rounded to 5.00.
    expect(row.cost.toFixed(2)).toBe("5.00");
    expect(row.usdRate.toFixed(2)).toBe("122.00");
    expect(row.durationMs).toBeGreaterThanOrEqual(0);

    // The agent is the AI's name, or the expert that did the work.
    await setAssistantName(env.owner, { name: "Extas AI" });
    await askClaude(env.company.id, write());
    await askClaude(env.company.id, write({ agent: "X05 Fit expert" }));
    const agents = await prisma.aiUsage.findMany({ orderBy: { createdAt: "asc" } });
    expect(agents.map((a) => a.agent)).toEqual(["Mehedi 2.0", "Extas AI", "X05 Fit expert"]);
    expect(agents[1]!.userId).toBeNull();
  });

  it("writes a failed call at no cost, with the reason people read", async () => {
    await switchOn(env);
    standIn(
      {},
      Anthropic.APIError.generate(429, { error: { message: "slow" } }, undefined, new Headers()),
    );
    await expectAppError(askClaude(env.company.id, write()), "UNAVAILABLE", /busy/);
    const row = await prisma.aiUsage.findFirstOrThrow();
    expect(row).toMatchObject({
      result: "FAILED",
      inputTokens: 0,
      outputTokens: 0,
      note: "The AI is busy. Try again in a minute.",
    });
    expect(row.cost.toFixed(2)).toBe("0.00");
  });

  it("stops new work at the monthly or daily budget, or goes on with the small model", async () => {
    await switchOn(env);
    const models = standIn();
    await setBudget(env.owner, { ...BUDGET, monthly: "100" });
    // Last month's spending does not count towards this month.
    const monthStart = startOfDayInZone(`${localDay(new Date(), TZ).slice(0, 7)}-01`, TZ);
    await line(env.company.id, "500.00", { at: new Date(monthStart.getTime() - 3600_000) });
    await askClaude(env.company.id, write());
    expect(models).toEqual(["claude-sonnet-5-5"]);

    await line(env.company.id, "100.00");
    await expectAppError(
      askClaude(env.company.id, write()),
      "UNAVAILABLE",
      /this month's budget \(BDT 100\.00\).*New AI work stops/,
    );
    expect(models).toHaveLength(1);
    const stopped = await prisma.aiUsage.findFirstOrThrow({ where: { result: "STOPPED" } });
    expect(stopped).toMatchObject({ model: "claude-sonnet-5-5", inputTokens: 0 });
    expect(stopped.cost.toFixed(2)).toBe("0.00");
    expect(stopped.note).toMatch(/this month's budget/);

    // The owner's other choice: small work goes on with the small model.
    await setBudget(env.owner, { ...BUDGET, monthly: "100", atLimit: "CHEAPER" });
    const answer = await askClaude(env.company.id, write());
    expect(answer.model).toBe("claude-haiku-5-5");
    expect(models.at(-1)).toBe("claude-haiku-5-5");
    const cheaper = await prisma.aiUsage.findFirstOrThrow({
      where: { result: "OK", model: "claude-haiku-5-5" },
    });
    expect(cheaper.note).toMatch(/small model/);

    // The daily limit, the same way.
    await setBudget(env.owner, { ...BUDGET, daily: "50" });
    await expectAppError(askClaude(env.company.id, write()), "UNAVAILABLE", /today's limit/);
  });

  it("always stops at a person's or an order's limit; the agent limit follows the owner's choice", async () => {
    await switchOn(env);
    const models = standIn();
    const project = { type: "ProductionProject", id: "proj-1", label: "EX-PL-001" };
    await setBudget(env.owner, {
      ...BUDGET,
      perStaffMonthly: "20",
      perOrder: "30",
      perAgentMonthly: "40",
      atLimit: "CHEAPER",
    });
    await line(env.company.id, "20.00", { userId: env.pm.user.id });
    await expectAppError(
      askClaude(env.company.id, write({ userId: env.pm.user.id })),
      "UNAVAILABLE",
      /Your AI use this month has reached its limit \(BDT 20\.00\)/,
    );
    // Someone else still works.
    await askClaude(env.company.id, write({ userId: env.owner.user.id }));

    await line(env.company.id, "30.00", { record: project, agent: "X05 Fit expert" });
    await expectAppError(
      askClaude(env.company.id, write({ record: project })),
      "UNAVAILABLE",
      /AI work on EX-PL-001 has reached its limit/,
    );
    // The same agent on another record: past its month, on the small model.
    await line(env.company.id, "10.00", { agent: "X05 Fit expert" });
    await askClaude(env.company.id, write({ agent: "X05 Fit expert" }));
    expect(models.at(-1)).toBe("claude-haiku-5-5");
    // Another agent is not held by it.
    await askClaude(env.company.id, write());
    expect(models.at(-1)).toBe("claude-sonnet-5-5");
    expect(await prisma.aiUsage.count({ where: { result: "STOPPED" } })).toBe(2);
  });

  it("asks first before big work without a budget, or above the owner's line", async () => {
    await switchOn(env);
    const models = standIn();
    const costing: ClaudeRequest = {
      task: "costing",
      why: "Costing for EX-PL-001",
      maxTokens: 4_000,
      messages: [{ role: "user", content: "x".repeat(3_500) }],
    };
    const error = await expectAppError(
      askClaude(env.company.id, costing),
      "CONFLICT",
      /big work and may cost about BDT/,
    );
    expect(error).toBeInstanceOf(AiAskFirst);
    // 1,000 tokens in × $4 + 4,000 out × $20 per million = $0.084, about BDT 10.25.
    expect((error as AiAskFirst).estimate).toMatchObject({
      model: "claude-opus-5-5",
      usd: "0.0840",
      cost: "10.25",
      currency: "BDT",
    });
    expect(models).toHaveLength(0);
    expect(await prisma.aiUsage.count()).toBe(0);
    // The person saw the estimate and said go on.
    await askClaude(env.company.id, { ...costing, costOk: true });
    expect(models).toEqual(["claude-opus-5-5"]);

    // With a monthly budget, big work goes on; the owner's line still asks.
    await setBudget(env.owner, { ...BUDGET, monthly: "5000", askAbove: "5" });
    await expectAppError(
      askClaude(env.company.id, costing),
      "CONFLICT",
      /above the BDT 5\.00 you asked to be asked about/,
    );
    await setBudget(env.owner, { ...BUDGET, monthly: "5000", askAbove: "50" });
    await askClaude(env.company.id, costing);
    // Small work never asks.
    await askClaude(env.company.id, write());
    expect(models).toHaveLength(3);
  });

  it("tells the owner once a month when the alert percentage is passed", async () => {
    await switchOn(env);
    standIn({ input_tokens: 10_000, output_tokens: 2_000 });
    await setBudget(env.owner, { ...BUDGET, monthly: "100", alertPercent: "80" });
    await line(env.company.id, "70.00");
    await askClaude(env.company.id, write());
    expect(await prisma.notificationLog.count()).toBe(0);

    await line(env.company.id, "10.00");
    await askClaude(env.company.id, write());
    await askClaude(env.company.id, write());
    const sent = await prisma.notificationLog.findMany();
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      userId: env.owner.user.id,
      subject: "AI has used 90% of this month's budget",
      entityType: "AiBudget",
      entityId: env.company.id,
    });
    expect(sent[0]!.body).toMatch(/BDT 89\.76 of BDT 100\.00 is spent/);
    expect(recordHref(env.owner, { type: "AiBudget", id: env.company.id })).toBe("/ai/costs");
    expect(recordHref(env.pm, { type: "AiBudget", id: env.company.id })).toBeNull();
    const month = await getMonthCost(env.owner);
    expect(month).toMatchObject({ spent: "94.64", calls: 5, budget: "100.00", percent: 95 });
  });

  it("shows the costs by period, broken down, with the costliest calls and every line", async () => {
    const project = { type: "ProductionProject", id: "proj-1", label: "EX-PL-001" };
    await line(env.company.id, "12.00", {
      userId: env.pm.user.id,
      task: "techpack.draft",
      model: "claude-opus-5-5",
      record: project,
    });
    await line(env.company.id, "3.00", { userId: env.owner.user.id, daysAgo: 3 });
    await line(env.company.id, "5.00", { daysAgo: 10, agent: "X05 Fit expert" });
    await line(env.company.id, "7.00", { daysAgo: 40 });
    // Another store's spending stays there.
    await line(env.other.id, "999.00");

    const today = await getCosts(env.owner, { period: "today" });
    expect(today.totals).toMatchObject({ cost: "12.00", calls: 1 });
    expect(today.perDay).toHaveLength(1);
    expect(today.lines[0]).toMatchObject({
      who: "pm",
      task: "Tech pack draft and design",
      model: "Opus 5.5",
      record: "EX-PL-001",
      href: "/production/projects/proj-1",
    });

    const week = await getCosts(env.owner, { period: "7d" });
    expect(week.totals).toMatchObject({ cost: "15.00", calls: 2 });
    expect(week.perDay).toHaveLength(7);
    expect(week.perDay.at(-1)).toEqual({ day: localDay(new Date(), TZ), cost: "12.00" });

    const thirty = await getCosts(env.owner, { period: "30d" });
    expect(thirty.totals.cost).toBe("20.00");
    expect(thirty.by.task.map((t) => [t.label, t.cost])).toEqual([
      ["Tech pack draft and design", "12.00"],
      ["Report and document text (tech pack notes, contracts, summaries)", "8.00"],
    ]);
    expect(thirty.by.model.map((t) => t.label)).toEqual(["Opus 5.5", "Sonnet 5.5"]);
    expect(thirty.by.agent.map((t) => [t.label, t.cost])).toEqual([
      ["Mehedi 2.0", "15.00"],
      ["X05 Fit expert", "5.00"],
    ]);
    expect(thirty.by.person.map((t) => [t.label, t.cost])).toEqual([
      ["pm", "12.00"],
      ["The system", "5.00"],
      ["owner", "3.00"],
    ]);
    expect(thirty.by.record).toEqual([
      expect.objectContaining({ label: "EX-PL-001", cost: "12.00", calls: 1 }),
    ]);
    expect(thirty.top.map((t) => t.cost)).toEqual(["12.00", "5.00", "3.00"]);
    expect(thirty.people.map((p) => p.name)).toEqual(["owner", "pm"]);

    const custom = await getCosts(env.owner, {
      period: "custom",
      from: addDays(localDay(new Date(), TZ), -45),
      to: localDay(new Date(), TZ),
    });
    expect(custom.totals.cost).toBe("27.00");
    const onePerson = await getCosts(env.owner, { period: "30d", userId: env.pm.user.id });
    expect(onePerson.totals).toMatchObject({ cost: "12.00", calls: 1 });

    await expectAppError(
      getCosts(env.owner, { period: "custom", from: "2026-10-10", to: "2026-10-01" }),
      "VALIDATION",
      /ends before it starts/,
    );
    await expectAppError(
      getCosts(env.owner, { period: "custom", from: "2024-01-01", to: "2026-10-01" }),
      "VALIDATION",
      /a year or less/,
    );
    await expect(getCosts(env.owner, { period: "forever" })).rejects.toBeInstanceOf(ZodError);

    // The month so far, against no budget, and its projection.
    const month = await getCosts(env.owner);
    expect(month.query.period).toBe("month");
    expect(month.month.budget).toBeNull();
    expect(Number(month.month.projection)).toBeGreaterThanOrEqual(Number(month.month.spent));
    expect(month.stores).toEqual([]);
    expect((await getCosts(env.outsider, { period: "30d" })).totals.cost).toBe("999.00");
  });

  it("shows the owner each store's spending once they see two or more", async () => {
    await addToCompany(env.owner.user.id, env.other.id, env.otherRoles.SUPER_ADMIN);
    await line(env.company.id, "12.00");
    await line(env.other.id, "30.00");
    const costs = await getCosts(env.owner, { period: "today" });
    expect(costs.stores.map((s) => [s.name, s.cost, s.here])).toEqual([
      ["Extas", "12.00", true],
      ["Extas Uttara", "30.00", false],
    ]);
    expect((await getCosts(env.watcher, { period: "today" })).stores).toEqual([]);
  });

  it("lets only the owner set the budget, and checks what is typed", async () => {
    await expectAppError(setBudget(env.pm, BUDGET), "FORBIDDEN");
    await expectAppError(setBudget(env.watcher, BUDGET), "FORBIDDEN");
    await expect(setBudget(env.owner, { ...BUDGET, alertPercent: "5" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(setBudget(env.owner, { ...BUDGET, monthly: "lots" })).rejects.toBeInstanceOf(
      ZodError,
    );
    await expect(setBudget(env.owner, { ...BUDGET, usdRate: "0" })).rejects.toBeInstanceOf(
      ZodError,
    );

    await setBudget(env.owner, { ...BUDGET, monthly: "5,000", daily: "250.50", usdRate: "121.5" });
    const costs = await getCosts(env.owner);
    expect(costs.budget).toMatchObject({
      monthly: "5000.00",
      daily: "250.50",
      perOrder: null,
      alertPercent: 80,
      atLimit: "STOP",
      usdRate: "121.50",
    });
    expect(costs.can.manage).toBe(true);
    expect((await getCosts(env.watcher)).can.manage).toBe(false);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityType: "AiSettings" } });
    expect(audit.summary).toBe(
      "AI budget: monthly BDT 5000, daily BDT 250.50, alert at 80%, at the limit stop, 1 USD = 121.5",
    );

    // Through the screen's actions.
    signedIn.ctx = env.watcher;
    expect((await getCostsAction({ period: "7d" })).ok).toBe(true);
    const refused = await setBudgetAction(BUDGET);
    expect(refused.ok || refused.error.code).toBe("FORBIDDEN");
    signedIn.ctx = env.pm;
    const hidden = await getCostsAction();
    expect(hidden.ok || hidden.error.code).toBe("FORBIDDEN");
    signedIn.ctx = env.owner;
    expect((await setBudgetAction({ ...BUDGET, monthly: "" })).ok).toBe(true);
    expect((await getCosts(env.owner)).budget.monthly).toBeNull();
  });

  it("makes the costs as a PDF or an Excel file", async () => {
    await line(env.company.id, "12.00", { userId: env.pm.user.id });
    await line(env.company.id, "3.00", { daysAgo: 2 });
    const pdf = await costsFile(env.watcher, { period: "7d" }, "pdf");
    expect(pdf.mimeType).toBe("application/pdf");
    expect(pdf.fileName).toMatch(/AI costs .*\.pdf$/);
    expect(pdf.bytes.subarray(0, 4).toString()).toBe("%PDF");
    const xlsx = await costsFile(env.owner, { period: "30d" }, "xlsx");
    expect(xlsx.fileName).toMatch(/\.xlsx$/);
    expect(xlsx.bytes.subarray(0, 2).toString()).toBe("PK");
    const audit = await prisma.auditLog.findMany({ where: { action: "EXPORT" } });
    expect(audit.map((a) => a.summary)).toEqual([
      expect.stringMatching(/^Made the AI costs PDF for /),
      expect.stringMatching(/^Made the AI costs Excel file for /),
    ]);
  });

  it("shows AI on or off on a record, and its cost only to the people who see the AI Center", async () => {
    const project = { type: "ProductionProject", id: "proj-1", label: "EX-PL-001" };
    await line(env.company.id, "12.00", { record: project });
    await line(env.company.id, "3.00", { record: project });
    expect(await recordCost(env.owner, project)).toEqual({
      on: false,
      cost: "15.00",
      calls: 2,
      currency: "BDT",
    });
    await switchOn(env);
    expect(await recordCost(env.pm, project)).toEqual({
      on: true,
      cost: null,
      calls: 0,
      currency: "BDT",
    });
    expect((await recordCost(env.outsider, project)).cost).toBe("0.00");

    signedIn.ctx = env.watcher;
    const box = await getAiRecordCostAction("ProductionProject", "proj-1");
    expect(box.ok && box.data.cost).toBe("15.00");
    const wrong = await getAiRecordCostAction("Employee", "e-1");
    expect(wrong.ok || wrong.error.code).toBe("VALIDATION");
  });
});
