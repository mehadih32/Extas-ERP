import Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * The AI Center: AI starts off and costs nothing until the owner turns it on;
 * every AI feature goes through one door (askClaude) that obeys the switch,
 * the pause, the key and the model per task; Control says what the AI may do
 * (Do / Ask / Off), with money, prices and buyer messages held at Ask; the AI
 * asks for what is Off and never deletes; only ai.manage changes any of it.
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

import { visibleNavItems } from "@/components/shell/nav-items";
import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { aiText, forgetAiTexts } from "@/modules/ai/ai-text";
import { aiOn, askClaude, askerFor, standInForClaude } from "@/modules/ai/claude";
import {
  aiMay,
  applyPreset,
  endGrant,
  getControl,
  giveGrant,
  setControlCell,
  useGrant,
} from "@/modules/ai/control.service";
import { getAiLogs } from "@/modules/ai/logs.service";
import {
  answerDeletion,
  answerPermission,
  askDeletion,
  askPermission,
  getRequests,
} from "@/modules/ai/requests.service";
import {
  getAiStatus,
  getModels,
  removeApiKey,
  setAiPaused,
  setAiSwitch,
  setApiKey,
  setAssistantName,
  setFableAllowed,
  setPin,
  setTaskModel,
} from "@/modules/ai/settings.service";
import type { CompanyContext } from "@/modules/auth/context";
import { intakeParserFor } from "@/modules/production/ai-intake";
import { createProject } from "@/modules/production/project.service";
import { createRole } from "@/modules/rbac/role.service";
import {
  getAiStatusAction,
  getControlAction,
  setAiSwitchAction,
  setControlCellAction,
} from "@/server/actions/ai.actions";

import { passAllBooks } from "../fixtures/ai-books";
import { claudeMessage } from "../fixtures/claude";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const KEY = "sk-ant-api03-test0123456789abcdWXYZ";

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
  const other = await makeCompany("Other Apparel");
  const join = async (roleId: string, who: string, companyId = company.id) => {
    const user = await makeUser(`${who}@extas.test`);
    await addToCompany(user.id, companyId, roleId);
    return contextFor(user.id, companyId);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner");
  // Do counts only once Mehedi 2.0 has passed his books' tests (tested in ai-mehedi).
  await passAllBooks(company.id);
  const watcherRole = await createRole(owner, {
    name: "AI Watcher",
    permissions: ["dashboard.view", "ai.view"],
  });
  return {
    company,
    owner,
    pm: await join(roles.PRODUCTION_MANAGER, "pm"),
    accounts: await join(roles.ACCOUNTS, "accounts"),
    watcher: await join(watcherRole.id, "watcher"),
    outsider: await join(other.roles.SUPER_ADMIN, "outsider", other.company.id),
  };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** A stand-in for Claude that records each call and answers with `answer`. */
function standIn(answer: Anthropic.Message | Error = claudeMessage("Worded by Claude.")) {
  const calls: Array<{ apiKey: string; body: Anthropic.MessageCreateParamsNonStreaming }> = [];
  standInForClaude(async ({ apiKey, body }) => {
    calls.push({ apiKey, body });
    if (answer instanceof Error) throw answer;
    return { ...answer, model: body.model };
  });
  return calls;
}

/** Turns AI on with the company's own key. */
async function switchOn(env: Env) {
  await setAiSwitch(env.owner, true);
  await setApiKey(env.owner, { key: KEY });
}

run("AI Center", () => {
  let env: Env;
  beforeEach(async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    await resetDb();
    forgetAiTexts();
    env = await setup();
  });
  afterEach(() => {
    standInForClaude(null);
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("starts off: no AI call is made and every feature works its own way", async () => {
    const calls = standIn();
    expect(await getAiStatus(env.owner)).toMatchObject({
      enabled: false,
      paused: false,
      working: false,
      offText: "AI is switched off. The owner turns it on in AI Center.",
      key: null,
      pinSet: false,
      assistantName: "Mehedi 2.0",
      can: { manage: true },
    });
    expect(await aiOn(env.company.id)).toBe(false);
    expect(await askerFor(env.company.id)).toBeNull();
    expect(await intakeParserFor(env.company.id)).toBeNull();
    expect(
      await aiText(env.company.id, { instructions: "Word it.", facts: { a: 1 }, why: "Test" }),
    ).toBeNull();
    await expectAppError(
      askClaude(env.company.id, {
        task: "text.write",
        why: "Test",
        maxTokens: 100,
        messages: [{ role: "user", content: "Hi" }],
      }),
      "UNAVAILABLE",
      /switched off/,
    );
    expect(await aiMay(env.company.id, "production.view")).toMatchObject({
      state: "OFF",
      why: expect.stringContaining("switched off"),
    });
    expect(calls).toHaveLength(0);
    // No settings row is written just by looking.
    expect(await prisma.aiSettings.count()).toBe(0);
  });

  it("is turned on and off only by the owner, and keeps the Claude key sealed", async () => {
    await expectAppError(setAiSwitch(env.pm, true), "FORBIDDEN");
    await expectAppError(setApiKey(env.watcher, { key: KEY }), "FORBIDDEN");

    await setAiSwitch(env.owner, true);
    expect(await getAiStatus(env.owner)).toMatchObject({
      enabled: true,
      working: false,
      offText: expect.stringContaining("no Claude key"),
      changedBy: "owner",
    });
    // On, but without a key nothing is called.
    expect(await aiOn(env.company.id)).toBe(false);

    await expect(
      setApiKey(env.owner, { key: "not-a-key-at-all-0123456789" }),
    ).rejects.toBeInstanceOf(ZodError);
    await setApiKey(env.owner, { key: KEY });
    const status = await getAiStatus(env.owner);
    expect(status).toMatchObject({
      working: true,
      offText: null,
      key: { own: true, hint: "WXYZ" },
    });
    expect(JSON.stringify(status)).not.toContain(KEY);
    const row = await prisma.aiSettings.findUniqueOrThrow({ where: { companyId: env.company.id } });
    expect(row.apiKeySealed).not.toContain(KEY);
    expect(await aiOn(env.company.id)).toBe(true);

    // The server's key stands in once the company's own is removed.
    await removeApiKey(env.owner);
    expect(await aiOn(env.company.id)).toBe(false);
    vi.stubEnv("AI_API_KEY", "sk-ant-server-key-0123456789");
    expect((await getAiStatus(env.owner)).key).toEqual({ own: false, hint: null, setAt: null });
    expect(await aiOn(env.company.id)).toBe(true);

    await setAiSwitch(env.owner, false);
    expect(await aiOn(env.company.id)).toBe(false);

    const audit = await prisma.auditLog.findMany({
      where: { companyId: env.company.id, entityType: "AiSettings" },
      orderBy: { createdAt: "asc" },
    });
    expect(audit.map((a) => a.summary)).toEqual([
      "Turned AI on",
      "Saved a Claude key ending WXYZ",
      "Removed the company's Claude key",
      "Turned AI off",
    ]);
    expect(JSON.stringify(audit)).not.toContain(KEY);
    // Another company's AI is untouched.
    expect((await getAiStatus(env.outsider)).enabled).toBe(false);
  });

  it("calls Claude only through the AI Center, on the model chosen for the task", async () => {
    const calls = standIn();
    await switchOn(env);

    const answer = await askClaude(env.company.id, {
      task: "text.write",
      why: "Word the notes",
      system: "Be brief.",
      maxTokens: 1024,
      effort: "low",
      messages: [{ role: "user", content: "Facts" }],
    });
    expect(answer.model).toBe("claude-sonnet-5-5");
    expect(calls[0]).toMatchObject({
      apiKey: KEY,
      body: {
        model: "claude-sonnet-5-5",
        max_tokens: 1024,
        system: "Be brief.",
        output_config: { effort: "low" },
      },
    });

    // The owner picks another model for a task; Fable runs only while allowed.
    await setTaskModel(env.owner, { task: "text.write", model: "claude-haiku-5-5" });
    await setTaskModel(env.owner, { task: "costing", model: "claude-fable-5-1" });
    const ask = (await askerFor(env.company.id, env.owner.user.id))!;
    await ask({
      task: "text.write",
      why: "t",
      maxTokens: 10,
      messages: [{ role: "user", content: "x" }],
    });
    await ask({
      task: "costing",
      why: "c",
      maxTokens: 10,
      messages: [{ role: "user", content: "x" }],
      costOk: true,
    });
    expect(calls.slice(1).map((c) => c.body.model)).toEqual([
      "claude-haiku-5-5",
      "claude-opus-5-5",
    ]);
    await setFableAllowed(env.owner, true);
    await ask({
      task: "costing",
      why: "c",
      maxTokens: 10,
      messages: [{ role: "user", content: "x" }],
      costOk: true,
    });
    expect(calls.at(-1)!.body.model).toBe("claude-fable-5-1");
    const models = await getModels(env.owner);
    expect(models.tasks.find((t) => t.key === "costing")).toMatchObject({
      system: "claude-opus-5-5",
      chosen: "claude-fable-5-1",
      runsOn: "claude-fable-5-1",
    });
    await setTaskModel(env.owner, { task: "text.write", model: null });
    expect(
      (await getModels(env.owner)).tasks.find((t) => t.key === "text.write")!.chosen,
    ).toBeNull();
    await expectAppError(
      setTaskModel(env.pm, { task: "text.write", model: "claude-haiku-5-5" }),
      "FORBIDDEN",
    );

    // AI wording: only the facts are sent, and the answer is kept.
    const words = await aiText(env.company.id, {
      instructions: "Word the making notes.",
      facts: { style: "EX-PL-001" },
      why: "Tech pack notes",
    });
    expect(words).toBe("Worded by Claude.");
    expect(calls.at(-1)!.body.messages).toEqual([
      { role: "user", content: JSON.stringify({ style: "EX-PL-001" }) },
    ]);

    // Paused: nothing is called until it is resumed.
    await setAiPaused(env.owner, true);
    expect((await getAiStatus(env.owner)).paused).toBe(true);
    const before = calls.length;
    await expectAppError(
      askClaude(env.company.id, {
        task: "chat",
        why: "q",
        maxTokens: 10,
        messages: [{ role: "user", content: "x" }],
      }),
      "UNAVAILABLE",
      /paused/,
    );
    expect(await aiMay(env.company.id, "production.view")).toMatchObject({ state: "OFF" });
    expect(calls).toHaveLength(before);
    await setAiPaused(env.owner, false);
    expect(await aiOn(env.company.id)).toBe(true);
  });

  it("explains Claude's failures in plain words", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    await switchOn(env);
    const request = {
      task: "chat" as const,
      why: "q",
      maxTokens: 10,
      messages: [{ role: "user" as const, content: "x" }],
    };
    standIn(
      Anthropic.APIError.generate(
        401,
        { error: { message: "invalid x-api-key" } },
        undefined,
        new Headers(),
      ),
    );
    await expectAppError(askClaude(env.company.id, request), "UNAVAILABLE", /refused the key/);
    standIn(
      Anthropic.APIError.generate(404, { error: { message: "model" } }, undefined, new Headers()),
    );
    await expectAppError(askClaude(env.company.id, request), "UNAVAILABLE", /Models/);
    standIn(
      Anthropic.APIError.generate(
        429,
        { error: { message: "slow down" } },
        undefined,
        new Headers(),
      ),
    );
    await expectAppError(askClaude(env.company.id, request), "UNAVAILABLE", /busy/);
    standIn(new Error("socket hang up"));
    await expectAppError(askClaude(env.company.id, request), "UNAVAILABLE", /could not answer/);
    // A failed wording keeps the screen's own words.
    expect(await aiText(env.company.id, { instructions: "i", facts: {}, why: "w" })).toBeNull();
  });

  it("sets what the AI may do: areas, exceptions, locked cells, buyer cells and presets", async () => {
    await switchOn(env);
    const may = (key: string, record?: { type: string; id: string }) =>
      aiMay(env.company.id, key, record).then((m) => m.state);

    expect(await may("production.manage")).toBe("ASK");
    await setControlCell(env.owner, { node: "b:production", state: "DO" });
    expect(await may("production.manage")).toBe("DO");
    expect(await may("ai.production.costing")).toBe("DO");
    // Approving and sending a booking still asks, even with Production on Do.
    expect(await may("production.bookings.approve")).toBe("ASK");
    expect(await may("ai.production.booking.send")).toBe("ASK");
    expect(await may("sales.view")).toBe("ASK");

    await setControlCell(env.owner, { node: "k:production.stock_intake", state: "OFF" });
    const control = await getControl(env.owner);
    const find = (node: typeof control.tree, ref: string): typeof control.tree | undefined =>
      node.ref === ref ? node : node.children?.map((c) => find(c, ref)).find(Boolean);
    expect(find(control.tree, "k:production.stock_intake")).toMatchObject({
      state: "OFF",
      exception: true,
    });
    expect(find(control.tree, "k:production.bookings.approve")).toMatchObject({
      state: "ASK",
      locked: true,
      heldAtAsk: true,
    });
    expect(find(control.tree, "k:ai.buyer.reply")).toMatchObject({ most: "ASK" });

    // What goes to a buyer is never Do.
    await expectAppError(
      setControlCell(env.owner, { node: "k:ai.buyer.reply", state: "DO" }),
      "VALIDATION",
      /never Do/,
    );
    await setControlCell(env.owner, { node: "b:all", state: "DO" });
    expect(await may("ai.buyer.reply")).toBe("ASK");
    expect(await may("ai.sales.invoice.send")).toBe("ASK");
    expect(await may("accounts.payments.record")).toBe("ASK");
    expect(await may("accounts.view")).toBe("DO");
    // Not cells at all: the AI may never do these.
    expect(await may("company.roles.manage")).toBe("OFF");
    expect(await may("backups.manage")).toBe("OFF");
    expect(await may("ai.manage")).toBe("OFF");

    await expectAppError(
      setControlCell(env.pm, { node: "b:production", state: "DO" }),
      "FORBIDDEN",
    );
    await expect(
      setControlCell(env.owner, { node: "k:nothing", state: "DO" }),
    ).rejects.toBeInstanceOf(ZodError);

    // Presets.
    await applyPreset(env.owner, "all-off");
    expect(await may("production.view")).toBe("OFF");
    await applyPreset(env.owner, "techpack-and-booking");
    expect(await may("production.bookings.supplier")).toBe("DO");
    expect(await may("ai.production.techpack.draft")).toBe("DO");
    expect(await may("production.bookings.approve")).toBe("ASK");
    expect(await may("sales.view")).toBe("OFF");
    await applyPreset(env.owner, "accounts-today");
    expect(await aiMay(env.company.id, "accounts.view")).toMatchObject({
      state: "DO",
      why: "Accounts open today",
    });
    // Recording money is locked: the area grant does not open it.
    expect(await may("accounts.receipts.record")).toBe("OFF");
    expect(await may("sales.view")).toBe("OFF");
    await expectAppError(applyPreset(env.owner, "everything-on"), "VALIDATION");

    const summaries = (
      await prisma.auditLog.findMany({
        where: { companyId: env.company.id, entityType: "AiControl" },
        orderBy: { createdAt: "asc" },
      })
    ).map((a) => a.summary);
    expect(summaries[0]).toMatch(/Production.*Do/);
    expect(summaries.length).toBeGreaterThanOrEqual(6);
  });

  it("opens a cell for a while, and closes it when the time is up or the owner ends it", async () => {
    await switchOn(env);
    await setControlCell(env.owner, { node: "b:all", state: "OFF" });
    const today = localDay(new Date(), env.company.timezone);

    await expectAppError(
      giveGrant(env.owner, { node: "k:accounts.view", scope: "UNTIL", until: addDays(today, -1) }),
      "VALIDATION",
    );
    // Opening a locked money cell asks for the PIN, which must be set first.
    const grant = { node: "k:accounts.receipts.record", scope: "UNTIL", until: addDays(today, 2) };
    await expectAppError(giveGrant(env.owner, grant), "VALIDATION", /^Set your PIN first/);
    await setPin(env.owner, { pin: "8642" });
    await expectAppError(giveGrant(env.owner, grant), "VALIDATION", /Give your PIN/);
    await expectAppError(
      giveGrant(env.owner, { ...grant, pin: "1111" }),
      "VALIDATION",
      /not right/,
    );
    expect(await prisma.aiGrant.count()).toBe(0);
    await giveGrant(env.owner, { ...grant, pin: "8642" });
    expect((await aiMay(env.company.id, "accounts.receipts.record")).state).toBe("DO");
    // An unlocked cell needs no PIN.
    await giveGrant(env.owner, { node: "k:accounts.view", scope: "TODAY" });
    const control = await getControl(env.owner);
    expect(control.grants).toHaveLength(2);
    const money = control.grants.find((g) => g.scope === "UNTIL")!;
    expect(money).toMatchObject({ scope: "UNTIL", by: "owner" });

    await endGrant(env.owner, money.id);
    expect((await aiMay(env.company.id, "accounts.receipts.record")).state).toBe("OFF");
    expect((await getControl(env.owner)).grants).toHaveLength(1);

    // A grant that has run out opens nothing.
    await prisma.aiGrant.create({
      data: {
        companyId: env.company.id,
        node: "b:production",
        scope: "TODAY",
        expiresAt: new Date(Date.now() - 60_000),
      },
    });
    expect((await aiMay(env.company.id, "production.view")).state).toBe("OFF");
    await expectAppError(endGrant(env.pm, money.id), "FORBIDDEN");
  });

  it("asks for the PIN before a locked cell goes to Do, on Control and on a chat card", async () => {
    await switchOn(env);
    const cell = { node: "k:accounts.payments.record", state: "DO" };
    await expectAppError(setControlCell(env.owner, cell), "VALIDATION", /^Set your PIN first/);
    await setPin(env.owner, { pin: "8642" });
    await expectAppError(setControlCell(env.owner, cell), "VALIDATION", /Give your PIN/);
    await expectAppError(
      setControlCell(env.owner, { ...cell, pin: "1111" }),
      "VALIDATION",
      "The PIN is not right.",
    );
    expect((await aiMay(env.company.id, "accounts.payments.record")).state).toBe("ASK");
    await setControlCell(env.owner, { ...cell, pin: "8642" });
    expect((await aiMay(env.company.id, "accounts.payments.record")).state).toBe("DO");
    // Ask, Off and areas never need it (an area on Do still holds its locked cells at Ask).
    await setControlCell(env.owner, { node: "k:accounts.payments.record", state: "ASK" });
    await setControlCell(env.owner, { node: "b:accounts", state: "DO" });
    expect((await aiMay(env.company.id, "accounts.payments.record")).state).toBe("ASK");
  });

  it("asks for what is Off, and the owner answers: only this task, for today, always or no", async () => {
    await switchOn(env);
    await setControlCell(env.owner, { node: "b:all", state: "OFF" });
    const order = { type: "ProductionProject", id: "proj-1", label: "EX-PL-001 Classic Polo" };

    const asked = await askPermission(env.company.id, {
      key: "ai.production.costing",
      task: "Work out the costing for EX-PL-001",
      why: "The order needs a price before Friday.",
      record: order,
    });
    // The same open question is asked once.
    const again = await askPermission(env.company.id, {
      key: "ai.production.costing",
      task: "Work out the costing for EX-PL-001",
      record: order,
    });
    expect(again.id).toBe(asked.id);
    await expect(
      askPermission(env.company.id, { key: "company.roles.manage", task: "Give myself a role" }),
    ).rejects.toMatchObject({ code: "VALIDATION" });

    const waiting = await getRequests(env.owner);
    expect(waiting.permissions).toHaveLength(1);
    expect(waiting.permissions[0]).toMatchObject({
      path: "Production › Work out costing",
      askedBy: "Mehedi 2.0 (AI)",
      record: "EX-PL-001 Classic Polo",
      needsPin: false,
      status: "PENDING",
    });
    expect((await getRequests(env.watcher)).can.answer).toBe(false);
    await expectAppError(answerPermission(env.watcher, asked.id, { answer: "ONCE" }), "FORBIDDEN");
    expect((await getRequests(env.outsider)).permissions).toHaveLength(0);

    // Only this task: opens it for this order, once.
    await answerPermission(env.owner, asked.id, { answer: "ONCE" });
    const once = await aiMay(env.company.id, "ai.production.costing", order);
    expect(once.state).toBe("DO");
    expect((await aiMay(env.company.id, "ai.production.costing")).state).toBe("OFF");
    await useGrant(once.grantId);
    expect((await aiMay(env.company.id, "ai.production.costing", order)).state).toBe("OFF");
    await expectAppError(answerPermission(env.owner, asked.id, { answer: "ALWAYS" }), "CONFLICT");

    // For today.
    const today = await askPermission(env.company.id, {
      key: "production.view",
      task: "Read the open orders",
    });
    await answerPermission(env.owner, today.id, { answer: "TODAY" });
    expect((await aiMay(env.company.id, "production.view")).state).toBe("DO");

    // Always: the cell becomes Do; for a buyer message, Ask (it still waits for the owner).
    const always = await askPermission(env.company.id, { key: "hr.view", task: "Read staff list" });
    await answerPermission(env.owner, always.id, { answer: "ALWAYS" });
    expect(await aiMay(env.company.id, "hr.view")).toMatchObject({ state: "DO" });
    const buyer = await askPermission(env.company.id, {
      key: "ai.buyer.follow_up",
      task: "Follow up with Rahim Traders",
    });
    // A buyer message is locked: answering it needs the PIN.
    await setPin(env.owner, { pin: "1357" });
    await answerPermission(env.owner, buyer.id, { answer: "ALWAYS", pin: "1357" });
    expect((await aiMay(env.company.id, "ai.buyer.follow_up")).state).toBe("ASK");

    // No.
    const no = await askPermission(env.company.id, { key: "sales.view", task: "Read the sales" });
    await answerPermission(env.owner, no.id, { answer: "REFUSED", note: "Not now" });
    expect((await aiMay(env.company.id, "sales.view")).state).toBe("OFF");

    const history = await getRequests(env.owner, true);
    expect(history.permissions.map((p) => p.status).sort()).toEqual(
      ["ALWAYS", "ALWAYS", "ONCE", "REFUSED", "TODAY"].sort(),
    );
    expect((await getRequests(env.owner)).permissions).toHaveLength(0);
  });

  it("asks for the PIN before money, prices and deletions", async () => {
    await switchOn(env);
    await expect(setPin(env.owner, { pin: "12ab" })).rejects.toBeInstanceOf(ZodError);
    await expectAppError(setPin(env.pm, { pin: "4321" }), "FORBIDDEN");
    await setPin(env.owner, { pin: "4321" });
    expect((await getAiStatus(env.owner)).pinSet).toBe(true);
    const row = await prisma.aiSettings.findUniqueOrThrow({ where: { companyId: env.company.id } });
    expect(row.pinHash).not.toContain("4321");

    // Changing it needs the current one.
    await expectAppError(setPin(env.owner, { pin: "5678" }), "VALIDATION");
    await expectAppError(setPin(env.owner, { pin: "5678", current: "1111" }), "VALIDATION");
    await setPin(env.owner, { pin: "5678", current: "4321" });

    const money = await askPermission(env.company.id, {
      key: "accounts.payments.record",
      task: "Record the payment to the mill",
    });
    expect((await getRequests(env.owner)).permissions[0]!.needsPin).toBe(true);
    await expectAppError(
      answerPermission(env.owner, money.id, { answer: "ALWAYS" }),
      "VALIDATION",
      /PIN/,
    );
    await expectAppError(
      answerPermission(env.owner, money.id, { answer: "ALWAYS", pin: "4321" }),
      "VALIDATION",
      /PIN/,
    );
    expect(
      (await prisma.aiPermissionRequest.findUniqueOrThrow({ where: { id: money.id } })).status,
    ).toBe("PENDING");
    await answerPermission(env.owner, money.id, { answer: "ALWAYS", pin: "5678" });
    expect((await aiMay(env.company.id, "accounts.payments.record")).state).toBe("DO");

    // Saying no needs no PIN.
    const price = await askPermission(env.company.id, {
      key: "sales.quotation.manage",
      task: "Change the quotation price",
    });
    await answerPermission(env.owner, price.id, { answer: "REFUSED" });
  });

  it("never deletes: a Deletion request waits for the owner; approving deletes in the owner's name", async () => {
    await switchOn(env);
    const party = await prisma.party.create({
      data: {
        companyId: env.company.id,
        code: "B-0099",
        kind: "BUYER",
        name: "Rahim Traders (copy)",
      },
    });
    const request = {
      what: "Duplicate buyer Rahim Traders (copy)",
      recordType: "Party",
      recordId: party.id,
      href: `/parties/${party.id}`,
      why: "It is the same buyer as Rahim Traders, with no orders.",
      ifKept: "Two buyers with the same name confuse the follow-ups.",
    };
    const asked = await askDeletion(env.company.id, request);
    expect((await askDeletion(env.company.id, request)).id).toBe(asked.id);
    expect((await getRequests(env.owner)).deletions[0]).toMatchObject({
      what: "Duplicate buyer Rahim Traders (copy)",
      askedBy: "Mehedi 2.0 (AI)",
      status: "PENDING",
    });

    await expectAppError(
      answerDeletion(env.pm, asked.id, { approve: true, pin: "2468" }),
      "FORBIDDEN",
    );
    // With no PIN set yet, approving waits for one (v6.3: set it first).
    const notSet = await expectAppError(
      answerDeletion(env.owner, asked.id, { approve: true, pin: "2468" }),
      "VALIDATION",
      /^Set your PIN first in AI Center > Settings\./,
    );
    expect(notSet.details).toHaveProperty("pinNotSet");
    await setPin(env.owner, { pin: "2468" });
    await expectAppError(
      answerDeletion(env.owner, asked.id, { approve: true }),
      "VALIDATION",
      /PIN/,
    );
    await expectAppError(
      answerDeletion(env.owner, asked.id, { approve: true, pin: "1357" }),
      "VALIDATION",
      "The PIN is not right.",
    );
    expect(
      (await prisma.aiDeletionRequest.findUniqueOrThrow({ where: { id: asked.id } })).status,
    ).toBe("PENDING");
    await answerDeletion(env.owner, asked.id, { approve: true, pin: "2468" });
    // Approved and done: the party's own delete (its account closed) ran in the owner's name.
    expect(await prisma.party.findUniqueOrThrow({ where: { id: party.id } })).toMatchObject({
      status: "CLOSED",
    });
    expect(
      await prisma.aiDeletionRequest.findUniqueOrThrow({ where: { id: asked.id } }),
    ).toMatchObject({
      status: "APPROVED",
      answeredById: env.owner.user.id,
      doneAt: expect.any(Date),
    });
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { entityType: "Party", entityId: party.id, action: "STATUS_CHANGE" },
      }),
    ).toMatchObject({ userId: env.owner.user.id, byAi: false });
    await expectAppError(answerDeletion(env.owner, asked.id, { approve: false }), "CONFLICT");

    const second = await askDeletion(env.company.id, { ...request, recordId: "another" });
    await answerDeletion(env.owner, second.id, { approve: false, note: "Keep it" });
    expect(
      (await prisma.aiDeletionRequest.findUniqueOrThrow({ where: { id: second.id } })).status,
    ).toBe("REJECTED");
    const audit = await prisma.auditLog.findMany({
      where: { companyId: env.company.id, entityType: "AiDeletionRequest" },
      orderBy: { createdAt: "asc" },
    });
    // Each request is in the log, marked AI; each answer, in the owner's name.
    expect(audit.map((a) => [a.summary, a.byAi])).toEqual([
      ["Sent the owner a Deletion request: Duplicate buyer Rahim Traders (copy)", true],
      [
        "Approved the AI's Deletion request and deleted Duplicate buyer Rahim Traders (copy)",
        false,
      ],
      ["Sent the owner a Deletion request: Duplicate buyer Rahim Traders (copy)", true],
      ["Refused the AI's Deletion request: Duplicate buyer Rahim Traders (copy)", false],
    ]);
  });

  it("runs an approved Deletion request through the record's own checks", async () => {
    await switchOn(env);
    await setPin(env.owner, { pin: "2468" });
    const project = await createProject(env.owner, {
      name: "Old sample polo",
      factoryName: "Own sewing floor",
      targetDate: addDays(localDay(new Date(), env.company.timezone), 30),
      targetQuantity: 100,
      status: "PLANNED",
    });
    const asked = await askDeletion(env.company.id, {
      what: `Production order ${project.code}`,
      recordType: "ProductionProject",
      recordId: project.id,
      why: "It was never started.",
      ifKept: "It stays in the list.",
    });
    await answerDeletion(env.owner, asked.id, { approve: true, pin: "2468" });
    expect(
      await prisma.productionProject.findUniqueOrThrow({ where: { id: project.id } }),
    ).toMatchObject({ status: "CANCELLED" });
    // A kind of record the ERP never deletes stays pending, with the reason.
    const sheet = await askDeletion(env.company.id, {
      what: "Costing sheet CS-1",
      recordType: "OrderCosting",
      recordId: "cs-1",
      why: "Old",
      ifKept: "Nothing",
    });
    await expectAppError(
      answerDeletion(env.owner, sheet.id, { approve: true, pin: "2468" }),
      "CONFLICT",
      /no delete for this kind of record/,
    );
    expect(
      (await prisma.aiDeletionRequest.findUniqueOrThrow({ where: { id: sheet.id } })).status,
    ).toBe("PENDING");
  });

  it("logs what the AI did under its name, and every change to it", async () => {
    await setAiSwitch(env.owner, true);
    await setAssistantName(env.owner, { name: "Mehedi 2.0" });
    await prisma.auditLog.create({
      data: {
        companyId: env.company.id,
        userId: env.owner.user.id,
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: "proj-1",
        summary: "Drafted the tech pack notes for EX-PL-001",
        byAi: true,
      },
    });
    await prisma.auditLog.create({
      data: {
        companyId: env.company.id,
        userId: env.pm.user.id,
        action: "UPDATE",
        entityType: "ProductionProject",
        entityId: "proj-1",
        summary: "A person's own change",
      },
    });

    const ai = await getAiLogs(env.owner, "ai");
    expect(ai.items.map((i) => [i.what, i.who, i.byAi])).toEqual([
      ["Drafted the tech pack notes for EX-PL-001", "Mehedi 2.0 (AI) for owner", true],
    ]);
    const changes = await getAiLogs(env.owner, "changes");
    expect(changes.items.map((i) => i.what).sort()).toEqual([
      'Named the AI "Mehedi 2.0"',
      "Turned AI on",
    ]);
    const all = await getAiLogs(env.owner);
    expect(all.items).toHaveLength(3);
    expect(all.items.some((i) => i.what === "A person's own change")).toBe(false);
    expect((await getAiLogs(env.outsider)).items).toHaveLength(0);

    await setAssistantName(env.owner, { name: "Extas AI" });
    expect((await getAiLogs(env.owner, "ai")).items[0]!.who).toBe("Extas AI (AI) for owner");
  });

  it("opens the AI Center to the owner by default; ai.view sees it, only ai.manage changes it", async () => {
    const menu = (ctx: CompanyContext) => visibleNavItems([...ctx.permissions]).map((i) => i.href);
    expect(menu(env.owner)).toContain("/ai");
    expect(menu(env.watcher)).toContain("/ai");
    for (const ctx of [env.pm, env.accounts]) expect(menu(ctx)).not.toContain("/ai");

    signedIn.ctx = env.pm;
    const refused = await getAiStatusAction();
    expect(refused.ok || refused.error.code).toBe("FORBIDDEN");
    expect((await setAiSwitchAction(true)).ok).toBe(false);

    signedIn.ctx = env.watcher;
    const seen = await getAiStatusAction();
    expect(seen.ok && seen.data.can.manage).toBe(false);
    expect((await getControlAction()).ok).toBe(true);
    const change = await setControlCellAction({ node: "b:all", state: "DO" });
    expect(change.ok || change.error.code).toBe("FORBIDDEN");
    expect(await prisma.aiControlCell.count()).toBe(0);

    signedIn.ctx = env.owner;
    expect((await setAiSwitchAction(true)).ok).toBe(true);
    expect((await getAiStatus(env.owner)).enabled).toBe(true);
  });
});
