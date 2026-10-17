import { Prisma } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * v6.4 F and A7: AI Center > Models lists Claude, OpenAI and Gemini models with
 * their prices from each provider's price page (where from, and when checked),
 * the owner can set their own price (who and when) or go back to the page's,
 * and a model with no price is blocked everywhere: it is never called, it
 * cannot be given work, its cost is never written as a known 0, and the owner
 * is told on Models, on AI Home and once a day per model in the inbox.
 */

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { askClaude, standInForClaude } from "@/modules/ai/claude";
import { getCostsWithLines } from "@/modules/ai/costs.service";
import { askHelp } from "@/modules/ai/help-ai.service";
import { recordHref } from "@/modules/reminders/links";
import { startTests } from "@/modules/ai/knowledge.service";
import { runModelTest } from "@/modules/ai/model-tests.service";
import { estimateOrderAi } from "@/modules/ai/orders/order-run.service";
import {
  costIn,
  hasPrice,
  priceBook,
  priceFor,
  setModelPrice,
  warnBlocked,
} from "@/modules/ai/prices.service";
import {
  getAiStatus,
  getModels,
  setAgentModel,
  setAiSwitch,
  setApiKey,
  setPin,
  setProviderKey,
  setTaskModel,
} from "@/modules/ai/settings.service";

import { passAllBooks } from "../fixtures/ai-books";
import { claudeMessage } from "../fixtures/claude";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const PIN = "2468";

const KEYS = {
  anthropic: "sk-ant-api03-test0123456789abcdWXYZ",
  openai: "sk-proj-openaitestkey0123456789",
  google: "AIzaSyTestGeminiKey0123456789abcdefg",
};

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
  const join = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  const pm = await join(roles.PRODUCTION_MANAGER, "pm");
  await passAllBooks(company.id);
  // AI on, with a key of every provider and the models each one offers.
  await setAiSwitch(owner, true);
  await setApiKey(owner, { key: KEYS.anthropic });
  await setProviderKey(owner, { provider: "openai", key: KEYS.openai });
  await setProviderKey(owner, { provider: "google", key: KEYS.google });
  // Setting a model's price asks for the owner's PIN.
  await setPin(owner, { pin: PIN });
  const readAt = new Date().toISOString();
  await prisma.aiSettings.update({
    where: { companyId: company.id },
    data: {
      providerModels: {
        openai: {
          readAt,
          models: [
            { id: "gpt-6.1-sol", label: "gpt-6.1-sol" },
            { id: "gpt-test", label: "gpt-test" },
          ],
        },
        google: {
          readAt,
          models: [
            { id: "gemini-4-argon", label: "Gemini 4 Argon" },
            { id: "gemini-test", label: "Gemini Test" },
          ],
        },
      },
    },
  });
  return { company, owner, pm };
}

type Env = Awaited<ReturnType<typeof setup>>;

const ask = (env: Env, more: Partial<Parameters<typeof askClaude>[1]> = {}) =>
  askClaude(env.company.id, {
    task: "text.write",
    why: "Word the notes",
    system: "Be brief.",
    maxTokens: 300,
    messages: [{ role: "user", content: "Facts" }],
    costOk: true,
    ...more,
  });

/** Gives work to a model as v6.3 allowed, without a price (a company's data before v6.4). */
async function assignedBefore(env: Env, tasks: Record<string, string>, agents = {}) {
  await prisma.aiSettings.update({
    where: { companyId: env.company.id },
    data: { models: tasks, agentModels: agents },
  });
}

run("Model prices for Claude, OpenAI and Gemini (v6.4 F, A7)", () => {
  let env: Env;
  let sent: Array<{ provider: string; model: string }>;

  beforeEach(async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    await resetDb();
    env = await setup();
    sent = [];
    standInForClaude(async ({ provider, body }) => {
      sent.push({ provider, model: body.model });
      return claudeMessage("Done.", body.model, { input_tokens: 10_000, output_tokens: 2_000 });
    });
  });
  afterEach(() => {
    standInForClaude(null);
    vi.unstubAllEnvs();
  });

  it("lists each provider's models with the price page's prices, where from and when checked", async () => {
    const m = await getModels(env.owner);
    expect(m.priceSections.map((s) => [s.provider, s.label])).toEqual([
      ["anthropic", "Claude"],
      ["openai", "OpenAI"],
      ["google", "Gemini"],
    ]);
    const claude = m.priceSections[0]!;
    expect(claude.sourceUrl).toBe("https://platform.claude.com/docs/en/about-claude/pricing");
    expect(claude.checkedOn).toBe("2026-10-16");
    expect(claude.rows.find((r) => r.model === "claude-opus-5-5")).toMatchObject({
      label: "Opus 5.5",
      state: "erp",
      builtIn: true,
      input: "4",
      output: "20",
      cacheRead: "0.2",
      cacheWrite: "5",
      batchInput: "2",
      batchOutput: "10",
      sourceUrl: "https://platform.claude.com/docs/en/about-claude/pricing",
      checkedOn: "2026-10-16",
      setBy: null,
    });
    expect(claude.rows.find((r) => r.model === "claude-haiku-5-5")!.notes).toEqual([
      "Prompts over 100,000 tokens: $0.50 input, $2.50 output, $0.05 cache read, $0.625 cache write, $0.25 batch input, $1.25 batch output",
    ]);
    // Older models are listed apart.
    expect(claude.older.map((r) => r.model)).toContain("claude-opus-4-5");
    const openai = m.priceSections[1]!;
    expect(openai.rows.find((r) => r.model === "openai:gpt-6.1-sol")).toMatchObject({
      label: "GPT-6.1 Sol",
      state: "erp",
      input: "2",
      cacheWrite: "2.5",
    });
    expect(openai.older.find((r) => r.model === "openai:gpt-5")).toMatchObject({
      cacheWrite: null,
    });
    const gemini = m.priceSections[2]!;
    expect(gemini.rows.find((r) => r.model === "google:gemini-4-argon")!.notes).toEqual([
      "From 1 Dec 2026: $4 input, $20 output, $0.20 cache read, $2 batch input, $10 batch output",
    ]);
    expect(m.blocked).toEqual([]);
  });

  it("keeps the owner's own price with who set it and when, and goes back to the page's when cleared", async () => {
    await expectAppError(
      setModelPrice(env.pm, { model: "claude-opus-5-5", input: "3", output: "15" }),
      "FORBIDDEN",
    );
    await setModelPrice(env.owner, {
      model: "claude-opus-5-5",
      input: "3",
      output: "15",
      cacheWrite: "3.75",
      pin: PIN,
    });
    let row = (await getModels(env.owner)).priceSections[0]!.rows.find(
      (r) => r.model === "claude-opus-5-5",
    )!;
    expect(row).toMatchObject({
      state: "owner",
      input: "3",
      output: "15",
      cacheRead: null,
      cacheWrite: "3.75",
      setBy: "owner",
      // The page's price stays in view.
      list: { input: "4", output: "20" },
    });
    expect(row.setAt).toBeTruthy();

    // A call is worked out at the owner's price: 10,000 × $3 + 2,000 × $15.
    await setTaskModel(env.owner, { task: "text.write", model: "claude-opus-5-5" });
    await ask(env);
    const line = await prisma.aiUsage.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(line).toMatchObject({ model: "claude-opus-5-5", costKnown: true, result: "OK" });
    expect(line.costUsd.toFixed(6)).toBe("0.060000");

    await setModelPrice(env.owner, { model: "claude-opus-5-5", input: "", output: "", pin: PIN });
    row = (await getModels(env.owner)).priceSections[0]!.rows.find(
      (r) => r.model === "claude-opus-5-5",
    )!;
    expect(row).toMatchObject({ state: "erp", input: "4", output: "20", setBy: null });
    const audit = await prisma.auditLog.findMany({
      where: { companyId: env.company.id, entityType: "AiSettings" },
      select: { summary: true },
    });
    expect(audit.map((a) => a.summary)).toEqual(
      expect.arrayContaining([
        "Opus 5.5: price set to $3 input, $15 output, $3.75 cache write per million tokens",
        "Opus 5.5: price set back to the built-in price list",
      ]),
    );
  });

  it("asks for the owner's PIN to set or clear a price, and never takes a price of 0", async () => {
    const price = { model: "openai:gpt-test", input: "1.25", output: "10" };
    // No PIN yet: the owner is told to set one first (the screen's PIN box shows it).
    await prisma.aiSettings.update({
      where: { companyId: env.company.id },
      data: { pinHash: null },
    });
    const notSet = await expectAppError(setModelPrice(env.owner, price), "VALIDATION");
    expect(notSet.details?.pinNotSet).toHaveLength(1);
    await setPin(env.owner, { pin: PIN });
    const none = await expectAppError(
      setModelPrice(env.owner, price),
      "VALIDATION",
      "Give your PIN to set a model's price.",
    );
    expect(none.details?.pin).toEqual(["Give your PIN to set a model's price"]);
    await expectAppError(
      setModelPrice(env.owner, { ...price, pin: "1357" }),
      "VALIDATION",
      "The PIN is not right.",
    );
    expect(await hasPrice(env.company.id, "openai:gpt-test")).toBe(false);
    await setModelPrice(env.owner, { ...price, pin: PIN });
    expect(await hasPrice(env.company.id, "openai:gpt-test")).toBe(true);

    // Clearing needs it too; a model on no price list is then blocked again.
    const cleared = { model: "openai:gpt-test", input: "", output: "" };
    await expectAppError(
      setModelPrice(env.owner, cleared),
      "VALIDATION",
      "Give your PIN to clear a model's price.",
    );
    expect(await hasPrice(env.company.id, "openai:gpt-test")).toBe(true);
    await setModelPrice(env.owner, { ...cleared, pin: PIN });
    expect(await hasPrice(env.company.id, "openai:gpt-test")).toBe(false);
    await expectAppError(
      setTaskModel(env.owner, { task: "text.write", model: "openai:gpt-test" }),
      "VALIDATION",
      /gpt-test \(OpenAI\) has no price yet, so it is blocked/,
    );

    // A price of 0 is refused on its field, before the PIN is even looked at.
    await expect(
      setModelPrice(env.owner, { ...price, input: "0", pin: PIN }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(await hasPrice(env.company.id, "openai:gpt-test")).toBe(false);
    // A 0 kept before v6.4 is no price at all: blocked, never counted as free work.
    await prisma.aiModelPrice.create({
      data: {
        companyId: env.company.id,
        model: "openai:gpt-test",
        provider: "openai",
        inputPerM: new Prisma.Decimal(0),
        outputPerM: new Prisma.Decimal(10),
      },
    });
    expect(await hasPrice(env.company.id, "openai:gpt-test")).toBe(false);
    await prisma.aiModelPrice.updateMany({
      where: { companyId: env.company.id, model: "openai:gpt-test" },
      data: { inputPerM: new Prisma.Decimal(1.25), cacheReadPerM: new Prisma.Decimal(0) },
    });
    // A cache price of 0 is no cache price: cache reading is charged as plain input.
    const book = await priceBook(env.company.id);
    expect(priceFor(book, "openai:gpt-test")).toMatchObject({ input: 1.25, cacheRead: null });
    expect(costIn(book, "openai:gpt-test", { input: 0, output: 0, cacheRead: 1_000_000 })).toEqual({
      usd: 1.25,
      known: true,
    });

    const audit = await prisma.auditLog.findMany({
      where: {
        companyId: env.company.id,
        entityType: "AiSettings",
        summary: { startsWith: "gpt-test" },
      },
      select: { summary: true },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.summary)).toEqual([
      "gpt-test (OpenAI): price set to $1.25 input, $10 output per million tokens",
      "gpt-test (OpenAI): price set back to none (blocked until it has one)",
    ]);
  });

  it("will not give work to a model with no price, and marks it in the pickers", async () => {
    const m = await getModels(env.owner);
    const offered = (p: string) => m.providers.find((x) => x.id === p)!.models;
    expect(offered("openai")).toEqual([
      { ref: "openai:gpt-6.1-sol", label: "gpt-6.1-sol", priced: true },
      { ref: "openai:gpt-test", label: "gpt-test", priced: false },
    ]);
    expect(offered("google").find((x) => x.ref === "google:gemini-test")!.priced).toBe(false);

    await expectAppError(
      setTaskModel(env.owner, { task: "text.write", model: "openai:gpt-test" }),
      "VALIDATION",
      "gpt-test (OpenAI) has no price yet, so it is blocked. Add its price in AI Center > Models.",
    );
    await expectAppError(
      setAgentModel(env.owner, { agent: "X05", model: "google:gemini-test" }),
      "VALIDATION",
      /Gemini Test \(Gemini\) has no price yet, so it is blocked/,
    );
    // A model on the price list, and one the owner priced, can be given work.
    await setTaskModel(env.owner, { task: "text.write", model: "openai:gpt-6.1-sol" });
    await setModelPrice(env.owner, {
      model: "openai:gpt-test",
      input: "1.25",
      output: "10",
      pin: PIN,
    });
    await setTaskModel(env.owner, { task: "chat", model: "openai:gpt-test" });
    await ask(env, { task: "chat" });
    expect(sent.at(-1)).toEqual({ provider: "openai", model: "gpt-test" });
    const line = await prisma.aiUsage.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(line.costKnown).toBe(true);
    expect(line.costUsd.toFixed(6)).toBe("0.032500");
  });

  it("blocks every AI call on a model with no price, before anything is sent", async () => {
    await assignedBefore(
      env,
      {
        chat: "openai:gpt-test",
        "help.answer": "openai:gpt-test",
        "order.plan": "openai:gpt-test",
      },
      { X05: "google:gemini-test" },
    );
    const blockedLine =
      "gpt-test (OpenAI) has no price yet, so it is blocked. Add its price in AI Center > Models.";

    // Mehedi 2.0's chat, an agent's work, the Help AI and a model's test.
    await expectAppError(ask(env, { task: "chat" }), "UNAVAILABLE", blockedLine);
    await expectAppError(
      ask(env, { agent: "X05 Textile Engineer: Fabric" }),
      "UNAVAILABLE",
      /Gemini Test \(Gemini\) has no price yet, so it is blocked/,
    );
    await expectAppError(
      askHelp(env.owner, { question: "How do I add a buyer?" }),
      "UNAVAILABLE",
      blockedLine,
    );
    await expectAppError(
      runModelTest(env.owner, { task: "costing", model: "openai:gpt-test" }),
      "UNAVAILABLE",
      blockedLine,
    );
    expect(await prisma.aiModelTest.count()).toBe(0);
    expect(sent).toEqual([]);

    // The cost lines say it was stopped, and never count it as a call that cost 0.
    const lines = await prisma.aiUsage.findMany({ orderBy: { createdAt: "asc" } });
    expect(lines.map((l) => [l.model, l.result, l.inputTokens, l.note])).toEqual([
      ["openai:gpt-test", "STOPPED", 0, blockedLine],
      [
        "google:gemini-test",
        "STOPPED",
        0,
        expect.stringContaining("Gemini Test (Gemini) has no price"),
      ],
      ["openai:gpt-test", "STOPPED", 0, blockedLine],
      ["openai:gpt-test", "STOPPED", 0, blockedLine],
    ]);

    // A book test on a blocked model does not start.
    await assignedBefore(env, { chat: "openai:gpt-test", "knowledge.test": "openai:gpt-test" });
    const runs = await prisma.aiTestRun.count();
    await expectAppError(
      startTests(env.owner, { books: ["K1"], costOk: true }),
      "UNAVAILABLE",
      blockedLine,
    );
    expect(await prisma.aiTestRun.count()).toBe(runs);

    // Once it has a price, the same work runs and its cost is known.
    await setModelPrice(env.owner, {
      model: "openai:gpt-test",
      input: "1.25",
      output: "10",
      pin: PIN,
    });
    await ask(env, { task: "chat" });
    expect(sent).toEqual([{ provider: "openai", model: "gpt-test" }]);
  });

  it("does not count blocked work in an order's AI estimate as nothing", async () => {
    const before = await estimateOrderAi(env.company.id, 2);
    expect(before.blocked).toEqual([]);
    expect(before.cost.gt(0)).toBe(true);
    await assignedBefore(env, { "order.plan": "openai:gpt-test" });
    const after = await estimateOrderAi(env.company.id, 2);
    expect(after.blocked).toEqual(["gpt-test (OpenAI)"]);
  });

  it("warns the owner on Models, on AI Home and once a day per model in the inbox", async () => {
    await assignedBefore(
      env,
      { chat: "openai:gpt-test", "text.write": "openai:gpt-test", costing: "claude-opus-5-5" },
      { X05: "google:gemini-test" },
    );
    const status = await getAiStatus(env.owner);
    expect(status.blockedModels).toEqual([
      {
        model: "openai:gpt-test",
        label: "gpt-test (OpenAI)",
        where: [
          "Report and document text (tech pack notes, contracts, summaries)",
          "Questions and answers",
        ],
      },
      {
        model: "google:gemini-test",
        label: "Gemini Test (Gemini)",
        where: [expect.stringMatching(/^X05 /)],
      },
    ]);
    const models = await getModels(env.owner);
    expect(models.blocked).toEqual(status.blockedModels);
    expect(models.tasks.find((t) => t.key === "chat")).toMatchObject({ blocked: true });
    expect(models.tasks.find((t) => t.key === "costing")).toMatchObject({ blocked: false });
    expect(models.agents.find((a) => a.key === "X05")).toMatchObject({ blocked: true });
    // An unpriced model in use is listed in its provider's section, blocked.
    expect(models.priceSections[1]!.rows.find((r) => r.model === "openai:gpt-test")).toMatchObject({
      state: "blocked",
      input: null,
      inUse: true,
    });

    const inbox = (userId: string) =>
      prisma.notificationLog.findMany({ where: { userId }, orderBy: { createdAt: "asc" } });
    await expectAppError(ask(env, { task: "chat" }), "UNAVAILABLE");
    await expectAppError(ask(env), "UNAVAILABLE");
    let mine = await inbox(env.owner.user.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      subject: "gpt-test (OpenAI) is blocked: it has no price",
      entityType: "AiModelPrice",
      entityId: "openai:gpt-test",
    });
    expect(mine[0]!.body).toContain("Add its price in AI Center > Models");
    // The notice opens the prices on Models.
    expect(recordHref(env.owner, { type: "AiModelPrice", id: "openai:gpt-test" })).toBe(
      "/ai/models#ai-prices-heading",
    );
    expect(recordHref(env.pm, { type: "AiModelPrice", id: "openai:gpt-test" })).toBeNull();
    // Only the people who manage the AI are told.
    expect(await inbox(env.pm.user.id)).toEqual([]);
    // Another blocked model: its own notice.
    await expectAppError(ask(env, { agent: "X05 Textile Engineer: Fabric" }), "UNAVAILABLE");
    mine = await inbox(env.owner.user.id);
    expect(mine.map((n) => n.entityId)).toEqual(["openai:gpt-test", "google:gemini-test"]);

    // The next day it is told again, once, even when two tries come at once.
    const tomorrow = new Date(Date.now() + 26 * 3600_000);
    const tries = await Promise.all(
      [1, 2, 3].map(() =>
        warnBlocked(
          env.company.id,
          "openai:gpt-test",
          { label: "gpt-test (OpenAI)", work: "Chat" },
          tomorrow,
        ),
      ),
    );
    expect(tries.filter(Boolean)).toHaveLength(1);
    expect(await inbox(env.owner.user.id)).toHaveLength(3);
    // The notice's day is no price: the model stays blocked.
    expect((await getModels(env.owner)).blocked.map((b) => b.model)).toContain("openai:gpt-test");

    // Priced: no longer blocked anywhere.
    await setModelPrice(env.owner, {
      model: "openai:gpt-test",
      input: "1.25",
      output: "10",
      pin: PIN,
    });
    expect((await getAiStatus(env.owner)).blockedModels.map((b) => b.model)).toEqual([
      "google:gemini-test",
    ]);
  });

  it("leaves calls from before v6.4 without a price as they are: price unknown", async () => {
    await prisma.aiUsage.create({
      data: {
        companyId: env.company.id,
        agent: "Mehedi 2.0",
        task: "chat",
        module: "AI",
        why: "An old question",
        model: "openai:gpt-old",
        provider: "openai",
        costKnown: false,
        inputTokens: 1000,
        outputTokens: 200,
        costUsd: new Prisma.Decimal(0),
        cost: new Prisma.Decimal(0),
        usdRate: new Prisma.Decimal(122),
        durationMs: 900,
        result: "OK",
      },
    });
    const { costs, lines } = await getCostsWithLines(env.owner, { period: "today" });
    expect(costs.totals.priceUnknown).toBe(1);
    expect(lines.find((l) => l.why === "An old question")).toMatchObject({
      costKnown: false,
    });
  });
});
