import type Anthropic from "@anthropic-ai/sdk";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * v6.3 D: AI with Claude, OpenAI and Gemini. Each provider's key is kept
 * locked and tested for free by reading its models from the provider; any
 * task and any agent can run on any provider's model through the one door,
 * with its cost per provider (a model with no price is blocked since v6.4,
 * tests/integration/ai-model-prices.test.ts) and a monthly limit per
 * provider; a model that is not built in does a task on Do only after it
 * passes that task's test; and every safety rule is the same on every
 * provider. The providers are a local stand-in speaking their HTTP APIs.
 */

import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { askClaude, standInForClaude, toolInputOf } from "@/modules/ai/claude";
import { aiMay, setControlCell } from "@/modules/ai/control.service";
import { getCosts, setBudget } from "@/modules/ai/costs.service";
import { runModelTest } from "@/modules/ai/model-tests.service";
import { setModelPrice } from "@/modules/ai/prices.service";
import {
  getAiStatus,
  getModels,
  removeProviderKey,
  setAgentModel,
  setAiSwitch,
  setApiKey,
  setPin,
  setProviderKey,
  setTaskModel,
  testProviderKey,
} from "@/modules/ai/settings.service";

import { passAllBooks } from "../fixtures/ai-books";
import { claudeMessage } from "../fixtures/claude";
import { type FakeAi, geminiTool, openaiText, openaiTool, startFakeAi } from "../fixtures/fake-ai";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

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

const PIN = "2468";

async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const join = async (roleId: string, who: string) => {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  await passAllBooks(company.id);
  // Setting a model's price asks for the owner's PIN.
  await setPin(owner, { pin: PIN });
  return { company, owner, pm: await join(roles.PRODUCTION_MANAGER, "pm") };
}

type Env = Awaited<ReturnType<typeof setup>>;

const ask = (env: Env, more: Partial<Parameters<typeof askClaude>[1]> = {}) =>
  askClaude(env.company.id, {
    task: "text.write",
    why: "Word the notes",
    system: "Be brief.",
    maxTokens: 300,
    messages: [{ role: "user", content: "Facts" }],
    ...more,
  });

run("AI with Claude, OpenAI and Gemini", () => {
  let fake: FakeAi;
  let env: Env;

  /**
   * AI on, with the OpenAI and Gemini keys saved, their models read, and the
   * test models priced (since v6.4 a model with no price is blocked).
   */
  async function connect(...providers: Array<"openai" | "google">) {
    await setAiSwitch(env.owner, true);
    for (const p of providers) {
      await setProviderKey(env.owner, { provider: p, key: fake.keys[p] });
      expect((await testProviderKey(env.owner, p)).ok).toBe(true);
    }
    if (providers.includes("openai")) {
      await setModelPrice(env.owner, {
        model: "openai:gpt-test",
        input: "1.25",
        output: "10",
        pin: PIN,
      });
    }
    if (providers.includes("google")) {
      await setModelPrice(env.owner, {
        model: "google:gemini-test",
        input: "0.3",
        output: "2.5",
        pin: PIN,
      });
    }
  }

  beforeAll(async () => {
    fake = await startFakeAi();
  });
  afterAll(async () => {
    await fake.close();
  });
  beforeEach(async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("OPENAI_BASE_URL", `${fake.url}/openai`);
    vi.stubEnv("GEMINI_BASE_URL", `${fake.url}/gemini`);
    vi.stubEnv("ANTHROPIC_BASE_URL", fake.url);
    fake.calls.length = 0;
    fake.answers.openai.length = 0;
    fake.answers.google.length = 0;
    await resetDb();
    env = await setup();
  });
  afterEach(() => {
    standInForClaude(null);
    vi.unstubAllEnvs();
  });

  it("keeps each provider's key locked and tests it for free by reading its models", async () => {
    await expectAppError(
      setProviderKey(env.pm, { provider: "openai", key: fake.keys.openai }),
      "FORBIDDEN",
    );
    await expect(
      setProviderKey(env.owner, { provider: "openai", key: fake.keys.google }),
    ).rejects.toBeInstanceOf(ZodError);
    await setProviderKey(env.owner, { provider: "openai", key: fake.keys.openai });
    await setProviderKey(env.owner, { provider: "google", key: fake.keys.google });
    const row = await prisma.aiSettings.findUniqueOrThrow({ where: { companyId: env.company.id } });
    expect(JSON.stringify(row)).not.toContain(fake.keys.openai);
    expect(JSON.stringify(row)).not.toContain(fake.keys.google);
    const status = await getAiStatus(env.owner);
    expect(status.providers.map((p) => [p.id, p.key?.hint ?? null])).toEqual([
      ["anthropic", null],
      ["openai", fake.keys.openai.slice(-4)],
      ["google", fake.keys.google.slice(-4)],
    ]);

    // AI is still off: reading the models asks the provider nothing that costs.
    expect(await testProviderKey(env.owner, "openai")).toMatchObject({
      ok: true,
      note: "Works: 2 models offered",
    });
    expect(await testProviderKey(env.owner, "google")).toMatchObject({
      ok: true,
      note: "Works: 1 model offered",
    });
    await setApiKey(env.owner, { key: fake.keys.anthropic });
    expect(await testProviderKey(env.owner, "anthropic")).toMatchObject({ ok: true });
    expect(fake.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "GET /openai/models",
      "GET /gemini/models",
      "GET /v1/models",
    ]);
    expect(await prisma.aiUsage.count()).toBe(0);
    const models = await getModels(env.owner);
    const offered = Object.fromEntries(
      models.providers.map((p) => [p.id, p.models.map((m) => m.ref)]),
    );
    // Chat models only; the ERP's own Claude models are listed apart.
    expect(offered).toEqual({
      anthropic: ["claude-test-next"],
      openai: ["openai:gpt-test-mini", "openai:gpt-test"],
      google: ["google:gemini-test"],
    });

    // A wrong key is found out, in plain words.
    await setProviderKey(env.owner, {
      provider: "openai",
      key: "sk-proj-wrongkey0123456789abcdef",
    });
    expect(await testProviderKey(env.owner, "openai")).toMatchObject({
      ok: false,
      note: "OpenAI refused the key.",
    });
    expect((await getModels(env.owner)).providers.find((p) => p.id === "openai")!.models).toEqual(
      [],
    );
    await removeProviderKey(env.owner, "google");
    expect((await getAiStatus(env.owner)).providers.find((p) => p.id === "google")!.key).toBeNull();
    const audit = await prisma.auditLog.findMany({
      where: { companyId: env.company.id, entityType: "AiSettings" },
      orderBy: { createdAt: "asc" },
      select: { summary: true },
    });
    expect(audit.map((a) => a.summary)).toEqual(
      expect.arrayContaining([
        `Saved an OpenAI key ending ${fake.keys.openai.slice(-4)}`,
        `Saved a Gemini key ending ${fake.keys.google.slice(-4)}`,
        "Tested the OpenAI key: Works: 2 models offered",
        "Tested the OpenAI key: OpenAI refused the key.",
        "Removed the company's Gemini key",
      ]),
    );
    expect(JSON.stringify(audit)).not.toContain(fake.keys.openai);
  });

  it("runs any task on any provider's model through the same door, with its cost", async () => {
    await connect("openai", "google");
    // Only a model the provider offers the key.
    await expectAppError(
      setTaskModel(env.owner, { task: "text.write", model: "openai:gpt-unknown" }),
      "VALIDATION",
      /did not offer/,
    );
    // Only a model with a price (v6.4 A7).
    await expectAppError(
      setTaskModel(env.owner, { task: "text.write", model: "openai:gpt-test-mini" }),
      "VALIDATION",
      /gpt-test-mini \(OpenAI\) has no price yet, so it is blocked/,
    );
    await setTaskModel(env.owner, { task: "text.write", model: "openai:gpt-test" });
    await setTaskModel(env.owner, { task: "chat", model: "google:gemini-test" });

    const answer = await ask(env);
    expect(answer.model).toBe("openai:gpt-test");
    expect(answer.message.content).toEqual([
      { type: "text", text: "Answered by OpenAI.", citations: null },
    ]);
    const sent = fake.calls.at(-1)!;
    expect(sent).toMatchObject({
      path: "/openai/chat/completions",
      auth: `Bearer ${fake.keys.openai}`,
      body: {
        model: "gpt-test",
        max_completion_tokens: 300,
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Facts" },
        ],
      },
    });
    let line = await prisma.aiUsage.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(line).toMatchObject({
      provider: "openai",
      model: "openai:gpt-test",
      inputTokens: 1000,
      outputTokens: 200,
      costKnown: true,
      result: "OK",
    });
    // 1,000 × $1.25 + 200 × $10 per million.
    expect(line.costUsd.toFixed(6)).toBe("0.003250");

    // The owner's new price counts from the next call.
    await setModelPrice(env.owner, {
      model: "openai:gpt-test",
      input: "2.5",
      output: "10",
      pin: PIN,
    });
    fake.answers.openai.push(openaiText("Second answer."));
    await ask(env);
    line = await prisma.aiUsage.findFirstOrThrow({ orderBy: { createdAt: "desc" } });
    expect(line.costKnown).toBe(true);
    expect(line.costUsd.toFixed(6)).toBe("0.004500");

    // Gemini, with a tool call and its answer on the next turn.
    const tools: Anthropic.Tool[] = [
      {
        name: "find_order",
        description: "Finds an order.",
        input_schema: {
          type: "object",
          properties: { number: { type: "string" } },
          required: ["number"],
        },
      },
    ];
    fake.answers.google.push(geminiTool("find_order", { number: "PO-2026-00042" }, "sig-1"));
    const first = await ask(env, {
      task: "chat",
      tools,
      messages: [{ role: "user", content: "Due?" }],
    });
    expect(first.model).toBe("google:gemini-test");
    expect(toolInputOf(first.message, "find_order")).toEqual({ number: "PO-2026-00042" });
    const call = first.message.content.find((b) => b.type === "tool_use")!;
    await ask(env, {
      task: "chat",
      tools,
      messages: [
        { role: "user", content: "Due?" },
        { role: "assistant", content: first.message.content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: (call as Anthropic.ToolUseBlock).id,
              content: "5 November",
            },
          ],
        },
      ],
    });
    const gemini = fake.calls.at(-1)!;
    expect(gemini.path).toBe("/gemini/models/gemini-test:generateContent");
    expect(gemini.auth).toBe(fake.keys.google);
    expect(gemini.body).toMatchObject({
      contents: [
        { role: "user", parts: [{ text: "Due?" }] },
        {
          role: "model",
          parts: [
            {
              functionCall: { name: "find_order", args: { number: "PO-2026-00042" } },
              thoughtSignature: "sig-1",
            },
          ],
        },
        {
          role: "user",
          parts: [
            { functionResponse: { name: "find_order", response: { content: "5 November" } } },
          ],
        },
      ],
    });

    // A provider's refusal is said in plain words and costs nothing.
    fake.answers.openai.push({ status: 429, json: { error: { message: "Rate limit reached" } } });
    await expectAppError(ask(env), "UNAVAILABLE", /OpenAI is busy or the key is out of credit/);
    expect(await prisma.aiUsage.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).toMatchObject(
      {
        provider: "openai",
        result: "FAILED",
      },
    );

    const costs = await getCosts(env.owner, { period: "today" });
    expect(costs.by.provider).toEqual([
      expect.objectContaining({ key: "anthropic", calls: 0 }),
      expect.objectContaining({ key: "openai", calls: 3, priceUnknown: 0 }),
      expect.objectContaining({ key: "google", calls: 2, priceUnknown: 0 }),
    ]);
    expect(costs.totals.priceUnknown).toBe(0);
    expect(costs.lines.find((l) => l.provider === "Gemini")).toMatchObject({
      costKnown: true,
      model: "Gemini Test (Gemini)",
    });
  });

  it("gives an agent its own model, and runs on Claude when a provider's key is removed", async () => {
    const calls: Array<{ provider: string; model: string }> = [];
    standInForClaude(async ({ provider, body }) => {
      calls.push({ provider, model: body.model });
      return claudeMessage("Done.", body.model);
    });
    await connect("openai", "google");
    await setApiKey(env.owner, { key: fake.keys.anthropic });

    await expectAppError(
      setAgentModel(env.pm, { agent: "X05", model: "google:gemini-test" }),
      "FORBIDDEN",
    );
    await expectAppError(
      setAgentModel(env.owner, { agent: "X99", model: "google:gemini-test" }),
      "VALIDATION",
    );
    await setAgentModel(env.owner, { agent: "X05", model: "google:gemini-test" });
    await ask(env, { agent: "X05 Textile Engineer: Fabric" });
    await ask(env, { agent: "X03 Designer" });
    await ask(env, { task: "chat" });
    await setAgentModel(env.owner, { agent: "mehedi", model: "openai:gpt-test" });
    await ask(env, { task: "chat" });
    expect(calls).toEqual([
      { provider: "google", model: "gemini-test" },
      { provider: "anthropic", model: "claude-sonnet-5-5" },
      { provider: "anthropic", model: "claude-sonnet-5-5" },
      { provider: "openai", model: "gpt-test" },
    ]);
    expect((await getModels(env.owner)).agents.find((a) => a.key === "X05")).toMatchObject({
      model: "google:gemini-test",
      modelLabel: "Gemini Test (Gemini)",
    });

    // The OpenAI key is removed: Mehedi 2.0's work goes on, on the task's own Claude model.
    await removeProviderKey(env.owner, "openai");
    await ask(env, { task: "chat" });
    expect(calls.at(-1)).toEqual({ provider: "anthropic", model: "claude-sonnet-5-5" });
    expect((await prisma.aiUsage.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).note).toBe(
      "No OpenAI key: ran on Sonnet 5.5 instead of gpt-test (OpenAI)",
    );
  });

  it("keeps a model that is not built in at Ask until it passes the task's test; the safety rules stay", async () => {
    await connect("openai", "google");
    await setControlCell(env.owner, { node: "b:production", state: "DO" });
    expect((await aiMay(env.company.id, "ai.production.costing")).state).toBe("DO");

    await setTaskModel(env.owner, { task: "costing", model: "openai:gpt-test" });
    expect(await aiMay(env.company.id, "ai.production.costing")).toMatchObject({
      state: "ASK",
      why: expect.stringContaining(
        'Do waits for gpt-test (OpenAI) to pass the "Costing and pricing" test',
      ),
    });
    let costing = (await getModels(env.owner)).tasks.find((t) => t.key === "costing")!;
    expect(costing.test).toMatchObject({ state: "NONE", text: "Not tested" });
    // The ERP's own models need no test.
    expect((await getModels(env.owner)).tasks.find((t) => t.key === "chat")!.test.state).toBe(
      "BUILT_IN",
    );

    // Wrong answers: not passed, with the reason.
    await expectAppError(
      runModelTest(env.pm, { task: "costing", model: "openai:gpt-test" }),
      "FORBIDDEN",
    );
    fake.answers.openai.push(
      openaiTool("answer", { fobPerPiece: 1.57 }),
      openaiTool("answer", { perPieceUsd: 0.55, totalUsd: 1650 }),
    );
    const failed = await runModelTest(env.owner, { task: "costing", model: "openai:gpt-test" });
    expect(failed).toMatchObject({ passed: false, right: 1, total: 2 });
    expect(failed.details[0]).toMatchObject({ ok: false, why: expect.stringContaining("1.75") });
    const asked = fake.calls.filter((c) => c.path === "/openai/chat/completions").at(-2)!;
    expect(asked.body).toMatchObject({
      model: "gpt-test",
      tools: [{ type: "function", function: { name: "answer" } }],
    });
    expect((await aiMay(env.company.id, "ai.production.costing")).state).toBe("ASK");
    costing = (await getModels(env.owner)).tasks.find((t) => t.key === "costing")!;
    expect(costing.test).toMatchObject({ state: "FAILED", last: { right: 1, total: 2 } });

    // Right answers: passed, and Do is Do again.
    fake.answers.openai.push(
      openaiTool("answer", { fobPerPiece: 1.75 }),
      openaiTool("answer", { perPieceUsd: 0.55, totalUsd: 1650 }),
    );
    expect(
      await runModelTest(env.owner, { task: "costing", model: "openai:gpt-test" }),
    ).toMatchObject({ passed: true, right: 2, total: 2 });
    expect((await aiMay(env.company.id, "ai.production.costing")).state).toBe("DO");
    expect(
      await prisma.aiUsage.count({
        where: { agent: "Model test", why: { contains: "Model test" } },
      }),
    ).toBe(4);

    // An agent's own untested model holds Do at Ask too.
    await setAgentModel(env.owner, { agent: "X05", model: "google:gemini-test" });
    expect((await aiMay(env.company.id, "ai.production.costing")).state).toBe("ASK");
    await setAgentModel(env.owner, { agent: "X05", model: null });
    expect((await aiMay(env.company.id, "ai.production.costing")).state).toBe("DO");

    // Every safety rule is the same on every provider.
    await setTaskModel(env.owner, { task: "message.draft", model: "openai:gpt-test" });
    await expectAppError(
      setControlCell(env.owner, { node: "k:ai.buyer.reply", state: "DO" }),
      "VALIDATION",
      /never Do/,
    );
    await expectAppError(
      setControlCell(env.owner, { node: "k:accounts.payments.record", state: "DO" }),
      "VALIDATION",
      /PIN/,
    );
    expect(await aiMay(env.company.id, "production.projects.delete")).toMatchObject({
      state: "OFF",
      why: "This is not something the AI may ever do.",
    });

    // AI off: no test runs, nothing is kept.
    await setAiSwitch(env.owner, false);
    const before = await prisma.aiModelTest.count();
    await expectAppError(
      runModelTest(env.owner, { task: "costing", model: "openai:gpt-test" }),
      "UNAVAILABLE",
      /switched off/,
    );
    expect(await prisma.aiModelTest.count()).toBe(before);
  });

  it("holds each provider to its own monthly limit", async () => {
    standInForClaude(async ({ body }) =>
      claudeMessage("Done.", body.model, { input_tokens: 1000, output_tokens: 200 }),
    );
    await connect("openai");
    await setApiKey(env.owner, { key: fake.keys.anthropic });
    await setModelPrice(env.owner, {
      model: "openai:gpt-test",
      input: "1.25",
      output: "10",
      pin: PIN,
    });
    await setTaskModel(env.owner, { task: "text.write", model: "openai:gpt-test" });
    await setBudget(env.owner, {
      limit_openai: "0.10",
      alertPercent: 80,
      atLimit: "STOP",
      usdRate: "122",
    });
    await ask(env);
    await expectAppError(ask(env), "UNAVAILABLE", /the OpenAI limit for the month/);
    // Claude's work is not held by OpenAI's limit.
    await ask(env, { task: "chat" });
    const costs = await getCosts(env.owner, { period: "today" });
    expect(costs.budget.providerLimits).toEqual({ anthropic: null, openai: "0.10", google: null });
    expect(costs.by.provider.find((p) => p.key === "openai")).toMatchObject({
      calls: 2,
      limit: "0.10",
    });
    expect(costs.by.provider.find((p) => p.key === "anthropic")).toMatchObject({ calls: 1 });
    await expect(
      setBudget(env.owner, {
        limit_google: "abc",
        alertPercent: 80,
        atLimit: "STOP",
        usdRate: "122",
      }),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
