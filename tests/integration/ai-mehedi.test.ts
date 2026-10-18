import type Anthropic from "@anthropic-ai/sdk";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

/*
 * Mehedi 2.0 (part 8 of v6.2): the AI's own account (what he does is marked
 * AI), his books and tests (Do counts only after he passes them, on the books
 * as they are), House Rules the owner teaches and approves, drafts that only
 * the owner sends, follow-up dates and reminders, the owner's chat (commands
 * read by rules, change cards the owner applies, deleting only ever asked),
 * and the company's mailbox with its password kept sealed.
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

import { addDays, localDay } from "@/lib/dates";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { aiAccountOf, asAi, auditAsAi } from "@/modules/ai/account";
import { runAiReminders } from "@/modules/ai/ai-reminders";
import type { ChatCard } from "@/modules/ai/chat/cards";
import { applyCard, cancelCard, getChat, sendChat } from "@/modules/ai/chat/chat.service";
import { AiAskFirst, type Ask, standInForClaude } from "@/modules/ai/claude";
import { aiMay, setControlCell } from "@/modules/ai/control.service";
import {
  discardDraft,
  getDrafts,
  makeAiDraft,
  sendDraft,
  setFollowUp,
} from "@/modules/ai/drafts.service";
import {
  decideHouseRule,
  listHouseRules,
  proposeHouseRule,
  retireHouseRule,
} from "@/modules/ai/house-rules.service";
import { bookTests, shippedBook, testStanding } from "@/modules/ai/knowledge";
import {
  getKnowledge,
  resetBook,
  runBookTest,
  saveBook,
  startTests,
} from "@/modules/ai/knowledge.service";
import { getAiLogs } from "@/modules/ai/logs.service";
import { getMehedi } from "@/modules/ai/mehedi.service";
import { mehediSystem } from "@/modules/ai/persona";
import {
  getAiStatus,
  OFF_TEXT,
  setAiPaused,
  setAiSwitch,
  setPin,
  setApiKey,
  setReplyRemindHours,
} from "@/modules/ai/settings.service";
import * as costing from "@/modules/costing/costing.service";
import {
  getMailSettings,
  type MailConfig,
  mailConfigOf,
  type OutgoingMail,
  removeMailSettings,
  saveMailSettings,
  sendTestMail,
  standInForMail,
} from "@/modules/mail/mail.service";
import * as parties from "@/modules/parties/party.service";
import { createProject } from "@/modules/production/project.service";
import { addMember } from "@/modules/rbac/member.service";
import { createRole } from "@/modules/rbac/role.service";
import {
  getChatAction,
  getMehediAction,
  saveMailSettingsAction,
  sendChatAction,
} from "@/server/actions/mehedi.actions";

import { passAllBooks } from "../fixtures/ai-books";
import { claudeMessage } from "../fixtures/claude";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const KEY = "sk-ant-api03-test0123456789abcdWXYZ";
const LABEL = "Mehedi 2.0 (AI)";

const MAIL = {
  host: "smtp.gmail.com",
  port: "587",
  secure: false,
  username: "owner@extas.test",
  password: "app-pass-word-1234",
  fromAddress: "owner@extas.test",
  fromName: "Extas",
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
  const watcherRole = await createRole(owner, {
    name: "AI Watcher",
    permissions: ["dashboard.view", "ai.view"],
  });
  const buyer = (
    await parties.createParty(owner, {
      kind: "BUYER",
      name: "Nordic Wear AB",
      email: "orders@nordicwear.test",
      tradePayment: "LC",
    })
  ).party;
  const mill = (
    await parties.createParty(owner, {
      kind: "SUPPLIER",
      name: "Narayanganj Fabrics",
      email: "sales@nfabrics.test",
    })
  ).party;
  return { company, owner, watcher: await join(watcherRole.id, "watcher"), buyer, mill };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Every email "sent" goes here instead of a mail server. */
function mailbox() {
  const sent: Array<{ config: MailConfig; mail: OutgoingMail }> = [];
  standInForMail(async (config, mail) => {
    sent.push({ config, mail });
    return { messageId: `<m${sent.length}@mail.test>` };
  });
  return sent;
}

/** Claude answers with these, one per call (the last one again after that). */
function claudeSays(...answers: Anthropic.Message[]) {
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  standInForClaude(async ({ body }) => {
    calls.push(body);
    const answer = answers[Math.min(calls.length - 1, answers.length - 1)]!;
    return { ...answer, model: body.model };
  });
  return calls;
}

const toolUse = (name: string, input: Record<string, unknown>, id = "toolu_1") =>
  ({
    ...claudeMessage([{ type: "tool_use", id, name, input } as Anthropic.ToolUseBlock]),
    stop_reason: "tool_use",
  }) as Anthropic.Message;

const systemText = async (companyId: string) =>
  (await mehediSystem(companyId)).map((b) => b.text).join("\n");

/** A costing sheet for the buyer, made in Production > Costing. */
const sheet = (env: Env) =>
  costing.createCosting(env.owner, {
    title: "Pique polos, spring 2027",
    buyerId: env.buyer.id,
    factoryId: env.mill.id,
    currency: "USD",
    exchangeRate: "120",
    profitPercent: "8",
    sourceTaxPercent: "1",
    bankChargePercent: "0.15",
    commissionPercent: "",
    shipDate: addDays(localDay(new Date(), "Asia/Dhaka"), 120),
    fabricDays: "",
    makingDays: "",
    risks: [],
    notes: "",
  });

run("Mehedi 2.0", () => {
  let env: Env;
  let uploads: string;
  beforeEach(async () => {
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("SMTP_FROM", "");
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-ai-mehedi-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    await resetDb();
    env = await setup();
  });
  afterEach(async () => {
    standInForClaude(null);
    standInForMail(null);
    signedIn.ctx = null;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    await rm(uploads, { recursive: true, force: true });
  });

  /** The owner writes in the chat; the answers come back. */
  const say = (text: string) => sendChat(env.owner, { text });
  const cardOf = (row: { card: unknown }) => row.card as ChatCard;

  it("works in his own account that cannot sign in, and what he does is marked AI", async () => {
    const account = await aiAccountOf(env.company.id);
    expect(account.name).toBe(LABEL);
    expect(await aiAccountOf(env.company.id)).toEqual(account);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({
      passwordHash: null,
      status: "SUSPENDED",
    });
    // In no team: no list shows him and no role can be given to him.
    expect(await prisma.companyMembership.count({ where: { userId: account.id } })).toBe(0);
    // His address can never be added to a team, in this store or another (v6.3).
    const role = await prisma.role.findFirstOrThrow({
      where: { companyId: env.company.id, systemRole: "SUPER_ADMIN" },
    });
    await expect(
      addMember(env.owner, { email: account.email, name: "Taking over", roleId: role.id }),
    ).rejects.toBeInstanceOf(ZodError);
    await expect(
      addMember(env.owner, {
        email: `ai-someother@ai.invalid`,
        name: "Not a person",
        roleId: role.id,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    // Nor his account, whatever address it ends up with.
    await prisma.user.update({ where: { id: account.id }, data: { email: "bot@extas.test" } });
    await expectAppError(
      addMember(env.owner, { email: "bot@extas.test", name: "Taking over", roleId: role.id }),
      "VALIDATION",
      /kept for the AI's own account/,
    );
    await prisma.user.update({ where: { id: account.id }, data: { email: account.email } });
    // An account someone made at the address before is locked again before the AI uses it.
    const other = await makeCompany("Second store");
    const squatter = await makeUser(`ai-${other.company.id}@ai.invalid`);
    await addToCompany(squatter.id, other.company.id, other.roles.SUPER_ADMIN);
    await prisma.session.create({
      data: {
        userId: squatter.id,
        token: "squatter-token",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    const taken = await aiAccountOf(other.company.id);
    expect(taken.id).toBe(squatter.id);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: squatter.id } })).toMatchObject({
      passwordHash: null,
      status: "SUSPENDED",
    });
    expect(
      await prisma.companyMembership.count({ where: { userId: squatter.id, isActive: true } }),
    ).toBe(0);
    expect(await prisma.session.count({ where: { userId: squatter.id } })).toBe(0);
    expect(
      (await prisma.aiSettings.findUniqueOrThrow({ where: { companyId: env.company.id } }))
        .aiUserId,
    ).toBe(account.id);

    const ai = await asAi(env.owner);
    expect(ai).toMatchObject({
      byAi: true,
      user: { id: account.id, name: LABEL, isSuperAdmin: false },
    });
    // Never the team, roles, backups or the AI Center, whoever he works for.
    for (const key of [
      "company.members.manage",
      "company.roles.manage",
      "backups.manage",
      "ai.manage",
    ]) {
      expect(ai.can(key as never)).toBe(false);
    }
    expect(ai.can("sales.view")).toBe(true);

    await auditAsAi(env.company.id, {
      action: "CREATE",
      entityType: "AiDraft",
      summary: "Drafted a follow-up",
    });
    const logs = await getAiLogs(env.owner, "ai");
    expect(logs.items).toEqual([
      expect.objectContaining({ byAi: true, who: LABEL, what: "Drafted a follow-up" }),
    ]);

    // Shown under the owner's name for him: the profile.
    const me = await getMehedi(env.owner);
    expect(me).toMatchObject({
      shownName: "Mehedi 2.0 · Extas CEO (AI)",
      expertId: "X26",
      state: "switched-off",
      tests: { passed: 0, total: 6 },
      waiting: { drafts: 0, permissions: 0, deletions: 0 },
      can: { manage: true },
    });
    expect(me.limits).toHaveLength(8);
    expect(me.work[0]).toMatchObject({ who: LABEL });
    expect((await getMehedi(env.watcher)).can.manage).toBe(false);
  });

  it("counts Do only once he has passed the books' tests, on the books as they are now", async () => {
    await setAiSwitch(env.owner, true);
    await setControlCell(env.owner, { node: "b:all", state: "DO" });
    expect(await aiMay(env.company.id, "production.view")).toMatchObject({
      state: "ASK",
      why: expect.stringContaining("test"),
    });

    await passAllBooks(env.company.id);
    expect((await aiMay(env.company.id, "production.view")).state).toBe("DO");
    expect((await aiMay(env.company.id, "accounts.view")).state).toBe("DO");

    // The owner changes K4 (production): its test is due again, so production asks.
    const k4 = await shippedBook("K4");
    await expectAppError(saveBook(env.watcher, "K4", { text: k4 }), "FORBIDDEN");
    await saveBook(env.owner, "K4", {
      text: `${k4}\n\nOur line: we always check shrinkage before cutting.`,
    });
    expect((await testStanding(env.company.id)).K4.state).toBe("CHANGED");
    expect(await aiMay(env.company.id, "production.view")).toMatchObject({
      state: "ASK",
      why: expect.stringContaining("K4"),
    });
    // Accounts does not need K4.
    expect((await aiMay(env.company.id, "accounts.view")).state).toBe("DO");

    // Back to the shipped text: the pass counts again.
    await resetBook(env.owner, "K4");
    expect((await aiMay(env.company.id, "production.view")).state).toBe("DO");

    // A pass counts for a month.
    await prisma.aiTestRun.deleteMany();
    await passAllBooks(env.company.id, new Date(Date.now() - 32 * 86_400_000));
    expect((await testStanding(env.company.id)).K1.state).toBe("EXPIRED");
    expect((await aiMay(env.company.id, "production.view")).state).toBe("ASK");
    await expectAppError(saveBook(env.owner, "K9", { text: k4 }), "NOT_FOUND");
  });

  it("takes a test only when the owner says go, answers from the books and is marked", async () => {
    await expectAppError(startTests(env.owner, { books: ["K1"] }), "UNAVAILABLE", /switched off/);
    await setAiSwitch(env.owner, true);
    await setApiKey(env.owner, { key: KEY });
    await expectAppError(startTests(env.watcher, { books: ["K1"] }), "FORBIDDEN");

    // No budget: he says what it will cost first.
    const first = await startTests(env.owner, { books: ["K1", "K2"] }).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(AiAskFirst);
    expect(await prisma.aiTestRun.count()).toBe(0);

    const runs = await startTests(env.owner, { books: ["K1", "K2"], costOk: true });
    expect(runs.map((r) => r.book)).toEqual(["K1", "K2"]);
    expect(
      await prisma.backgroundJob.count({ where: { kind: "ai.knowledge.test", maxAttempts: 1 } }),
    ).toBe(2);
    await expectAppError(
      startTests(env.owner, { books: ["K1"], costOk: true }),
      "CONFLICT",
      /running already/,
    );
    expect((await testStanding(env.company.id)).K1.state).toBe("RUNNING");

    const questions = (await bookTests()).K1!.questions;
    const asked: Parameters<Ask>[0][] = [];
    const ask: Ask = async (request) => {
      asked.push(request);
      if (request.tools?.some((t) => t.name === "record_marks")) {
        const marks = questions.map((q) => ({ n: q.n, right: true, why: "Same result" }));
        return { model: "claude-sonnet-5-5", message: toolUse("record_marks", { marks }) };
      }
      return {
        model: "claude-sonnet-5-5",
        message: claudeMessage("By the v6.2 rule: the owner decides."),
      };
    };
    await runBookTest(runs[0]!.id, { ask });
    expect(asked).toHaveLength(questions.length + 1);
    const system = (asked[0]!.system as Anthropic.TextBlockParam[]).map((b) => b.text).join("\n");
    expect(system).toContain('<book code="K1"');
    expect(system).toContain('<book code="X26"');
    expect(asked[0]!.task).toBe("knowledge.test");
    expect(await prisma.aiTestRun.findUniqueOrThrow({ where: { id: runs[0]!.id } })).toMatchObject({
      status: "DONE",
      right: questions.length,
      total: questions.length,
      passed: true,
    });

    // The K2 test stops halfway: it is kept as not finished, never run again by itself.
    await runBookTest(runs[1]!.id, {
      ask: async () => {
        throw new AppError("UNAVAILABLE", "The Claude service is busy. Try again in a minute.");
      },
    });
    expect(await prisma.aiTestRun.findUniqueOrThrow({ where: { id: runs[1]!.id } })).toMatchObject({
      status: "FAILED",
      passed: false,
      error: "The Claude service is busy. Try again in a minute.",
    });

    const books = (await getKnowledge(env.watcher)).books;
    expect(books.find((b) => b.code === "K1")?.test.state).toBe("PASSED");
    expect(books.find((b) => b.code === "K2")?.test.state).toBe("NONE");
  });

  it("learns House Rules only once the owner approves them, and shows the old rules on the same thing", async () => {
    const said = "For Nordic Wear the collar is always 3 1/4 inch";
    await expectAppError(proposeHouseRule(env.watcher, { text: said }), "FORBIDDEN");
    await expect(
      proposeHouseRule(env.owner, { text: said, scope: "BUYER" }),
    ).rejects.toBeInstanceOf(ZodError);

    const rule = await proposeHouseRule(env.owner, {
      text: said,
      scope: "BUYER",
      scopeValue: "Nordic Wear AB",
    });
    // A rule the AI worded is marked AI in the log; the owner's own words are not.
    const worded = await proposeHouseRule(
      env.owner,
      { text: "Nordic Wear pays by TT within 30 days" },
      undefined,
      { byAi: true, said: "nordic pays tt 30 days" },
    );
    const logged = await prisma.auditLog.findMany({
      where: { entityType: "HouseRule", entityId: { in: [rule.id, worded.id] } },
    });
    expect(logged.find((a) => a.entityId === rule.id)?.byAi).toBe(false);
    expect(logged.find((a) => a.entityId === worded.id)?.byAi).toBe(true);
    // The AI's proposal is saved under the AI's own account, never the owner's.
    const ai = await aiAccountOf(env.company.id);
    expect(worded.proposedById).toBe(ai.id);
    expect(rule.proposedById).toBe(env.owner.user.id);
    expect(logged.find((a) => a.entityId === worded.id)?.userId).toBe(ai.id);
    expect(logged.find((a) => a.entityId === worded.id)?.summary).toContain(env.owner.user.name);
    expect(logged.find((a) => a.entityId === rule.id)?.userId).toBe(env.owner.user.id);
    await prisma.houseRule.delete({ where: { id: worded.id } });
    expect(rule).toMatchObject({ status: "PROPOSED", source: "Teach", byAi: false });
    expect(await systemText(env.company.id)).not.toContain(said);

    await expectAppError(decideHouseRule(env.watcher, rule.id, { approve: true }), "FORBIDDEN");
    await decideHouseRule(env.owner, rule.id, { approve: true });
    await expectAppError(decideHouseRule(env.owner, rule.id, { approve: false }), "CONFLICT");
    expect(await systemText(env.company.id)).toContain(`- ${said} (buyer: Nordic Wear AB)`);

    const newer = await proposeHouseRule(env.owner, {
      text: "Nordic Wear collar is 3 inch from now",
      scope: "BUYER",
      scopeValue: "nordic wear ab",
    });
    const rules = await listHouseRules(env.owner);
    expect(rules.proposed).toEqual([
      expect.objectContaining({ id: newer.id, sameThing: [{ id: rule.id, text: said }] }),
    ]);
    expect(rules.approved.map((r) => r.id)).toEqual([rule.id]);

    await retireHouseRule(env.owner, rule.id);
    await expectAppError(retireHouseRule(env.owner, rule.id), "CONFLICT");
    expect(await systemText(env.company.id)).not.toContain(said);
    expect((await listHouseRules(env.owner)).past).toEqual([
      expect.objectContaining({ id: rule.id, status: "RETIRED" }),
    ]);
  });

  it("drafts for buyers, and only the owner sends them from the company's mailbox", async () => {
    const sent = mailbox();
    const draft = await makeAiDraft(env.company.id, {
      kind: "BUYER_FOLLOW_UP",
      partyId: env.buyer.id,
      about: "PO 4501",
    });
    // AI off: the plain draft, still written by him and waiting for the owner.
    expect(draft).toMatchObject({
      byAi: true,
      status: "DRAFT",
      toAddress: "orders@nordicwear.test",
      recordLabel: "PO 4501",
    });
    expect(draft.subject).toContain("PO 4501");
    expect(draft.body).toContain(`Drafted by ${LABEL}`);
    // A buyer's draft reminds the owner after 24 hours; a supplier's never.
    const hours = (draft.remindAt!.getTime() - draft.createdAt.getTime()) / 3_600_000;
    expect(hours).toBeGreaterThan(23.9);
    expect(hours).toBeLessThan(24.1);
    const supplier = await makeAiDraft(env.company.id, {
      kind: "SUPPLIER",
      partyId: env.mill.id,
      about: "Fabric",
    });
    expect(supplier.remindAt).toBeNull();

    await expectAppError(sendDraft(env.watcher, draft.id), "FORBIDDEN");
    // No mailbox yet: nothing goes, and the draft says why.
    await expectAppError(sendDraft(env.owner, draft.id), "UNAVAILABLE", /not set up/);
    expect(await prisma.aiDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: "FAILED",
      sentAt: null,
    });
    expect(sent).toHaveLength(0);

    await saveMailSettings(env.owner, MAIL);
    await sendDraft(env.owner, draft.id);
    expect(sent).toEqual([
      {
        config: expect.objectContaining({
          source: "company",
          host: "smtp.gmail.com",
          password: MAIL.password,
        }),
        mail: expect.objectContaining({ to: "orders@nordicwear.test", subject: draft.subject }),
      },
    ]);
    expect(await prisma.aiDraft.findUniqueOrThrow({ where: { id: draft.id } })).toMatchObject({
      status: "SENT",
      sentById: env.owner.user.id,
      error: null,
    });
    expect(
      await prisma.notificationLog.findFirstOrThrow({
        where: { channel: "EMAIL", entityId: draft.id },
      }),
    ).toMatchObject({ status: "SENT", recipient: "orders@nordicwear.test" });
    await expectAppError(sendDraft(env.owner, draft.id), "CONFLICT", /sent already/);
    await expectAppError(discardDraft(env.owner, draft.id), "CONFLICT");
    expect(sent).toHaveLength(1);

    await discardDraft(env.owner, supplier.id);
    const screen = await getDrafts(env.owner, "sent");
    expect(screen.counts).toEqual({ waiting: 0, sent: 1, discarded: 1 });
    expect(screen.drafts).toEqual([
      expect.objectContaining({ id: draft.id, by: LABEL, forBuyer: true }),
    ]);
    expect(screen.parties.map((p) => p.name)).toEqual(["Narayanganj Fabrics", "Nordic Wear AB"]);
    const watched = await getDrafts(env.watcher);
    expect(watched).toMatchObject({ parties: [], can: { manage: false } });
  });

  it("drafts the follow-up on its day and reminds the owner once of what is not sent", async () => {
    const today = localDay(new Date(), env.company.timezone);
    await expectAppError(
      setFollowUp(env.owner, { partyId: env.mill.id, dueOn: today }),
      "VALIDATION",
      /buyer/,
    );
    await expectAppError(
      setFollowUp(env.owner, { partyId: env.buyer.id, dueOn: addDays(today, -1) }),
      "VALIDATION",
      /today or a later day/,
    );
    const follow = await setFollowUp(env.owner, {
      partyId: env.buyer.id,
      dueOn: today,
      recordLabel: "PO 4501",
      note: "Ask for the lab dip approval",
    });
    const reply = await makeAiDraft(env.company.id, {
      kind: "BUYER_REPLY",
      partyId: env.buyer.id,
      about: "Price",
    });

    const now = new Date();
    // While the AI is off or paused nothing runs: no draft, no reminder (v6.3).
    expect(await runAiReminders(now, { companyId: env.company.id })).toEqual({
      followUps: 0,
      waiting: 0,
    });
    await setAiSwitch(env.owner, true);
    await setAiPaused(env.owner, true);
    expect(
      await runAiReminders(new Date(now.getTime() + 25 * 3_600_000), {
        companyId: env.company.id,
      }),
    ).toEqual({ followUps: 0, waiting: 0 });
    expect(await prisma.aiDraft.count({ where: { kind: "BUYER_FOLLOW_UP" } })).toBe(0);
    expect(await prisma.notificationLog.count()).toBe(0);
    await setAiPaused(env.owner, false);

    expect(await runAiReminders(now, { companyId: env.company.id })).toEqual({
      followUps: 1,
      waiting: 0,
    });
    const drafted = await prisma.aiFollowUp.findUniqueOrThrow({ where: { id: follow.id } });
    expect(drafted.draftId).not.toBeNull();
    expect(
      await prisma.aiDraft.findUniqueOrThrow({ where: { id: drafted.draftId! } }),
    ).toMatchObject({
      kind: "BUYER_FOLLOW_UP",
      followUpId: follow.id,
      status: "DRAFT",
    });
    // Nothing went to the buyer: only the owner is told, in the ERP.
    const told = await prisma.notificationLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(told).toEqual([
      expect.objectContaining({
        channel: "IN_APP",
        userId: env.owner.user.id,
        subject: "Follow up with Nordic Wear AB today",
      }),
    ]);
    expect(await runAiReminders(now, { companyId: env.company.id })).toEqual({
      followUps: 0,
      waiting: 0,
    });

    // A day later both buyer drafts are still not sent: one reminder each, once.
    const later = new Date(now.getTime() + 25 * 3_600_000);
    expect(await runAiReminders(later, { companyId: env.company.id })).toEqual({
      followUps: 0,
      waiting: 2,
    });
    expect(await runAiReminders(later, { companyId: env.company.id })).toEqual({
      followUps: 0,
      waiting: 0,
    });
    const reminders = await prisma.notificationLog.findMany({
      where: { subject: { startsWith: "Not sent yet" } },
    });
    expect(reminders.map((r) => r.entityId).sort()).toEqual([drafted.draftId, reply.id].sort());
    expect(reminders.every((r) => r.userId === env.owner.user.id && r.channel === "IN_APP")).toBe(
      true,
    );

    // Sending the follow-up's draft closes the follow-up.
    mailbox();
    await saveMailSettings(env.owner, MAIL);
    await sendDraft(env.owner, drafted.draftId!);
    expect((await prisma.aiFollowUp.findUniqueOrThrow({ where: { id: follow.id } })).status).toBe(
      "DONE",
    );
  });

  it("answers the owner's commands, and only help and status while switched off or paused", async () => {
    let [answer] = await say("আজকের সেল রিপোর্ট PDF দাও");
    expect(answer!.text).toBe("I am switched off. The owner turns me on in AI Center > AI Home.");
    [answer] = await say("help");
    expect(cardOf(answer!)).toMatchObject({ type: "help" });
    [answer] = await say("সব থামাও");
    expect(answer!.text).toBe("I am switched off already: nothing runs.");

    await setAiSwitch(env.owner, true);
    [answer] = await say("status");
    expect(answer!.text).toBe(OFF_TEXT["no-key"]);
    expect(cardOf(answer!)).toMatchObject({
      type: "facts",
      rows: expect.arrayContaining([
        { label: "Tests passed", value: "0 of 6", href: "/ai/knowledge" },
        { label: "AI cost today", value: "BDT 0.00", href: "/ai/costs?period=today" },
      ]),
    });

    [answer] = await say("সব থামাও");
    expect(answer!.text).toMatch(/^Stopped\./);
    expect((await getAiStatus(env.owner)).paused).toBe(true);
    [answer] = await say("শেষ ৭ দিনের খরচ");
    expect(answer!.text).toMatch(/I am paused/);
    [answer] = await say("আবার চালু করো");
    expect(answer!.text).toBe("Working again.");
    expect((await getAiStatus(env.owner)).paused).toBe(false);

    // On without a key: the commands work, free questions wait for the key.
    [answer] = await say("শেষ ৭ দিনের খরচ");
    expect(answer!.text).toBe("Last 7 days: no AI work, no cost.");
    [answer] = await say("What do you think of the new buyer?");
    expect(answer!.text).toMatch(/^I need an AI key \(Claude, OpenAI or Gemini\)/);

    // The report PDF is made in his name, for the owner.
    [answer] = await say("আজকের সেল রিপোর্ট PDF দাও");
    expect(cardOf(answer!)).toMatchObject({ type: "report", title: "Sales report", emailed: null });
    const report = await prisma.reportExport.findFirstOrThrow({ include: { file: true } });
    expect(report.file?.mimeType).toBe("application/pdf");
    expect((cardOf(answer!) as Extract<ChatCard, { type: "report" }>).href).toBe(
      `/api/reports/exports/${report.id}/download`,
    );

    const chat = await getChat(env.owner);
    // Today's and this month's AI cost show over the chat.
    expect(chat.cost).toMatchObject({
      today: { spent: "0.00", calls: 0 },
      spent: "0.00",
      currency: "BDT",
    });
    expect(chat.messages.filter((m) => m.role === "OWNER")).toHaveLength(10);
    expect(chat.messages.at(-1)).toMatchObject({ role: "AI", channel: "ERP" });
    // Each owner's chat is their own.
    expect(
      await prisma.aiChatMessage.count({ where: { userId: { not: env.owner.user.id } } }),
    ).toBe(0);
  });

  it("proposes changes as cards the owner applies, in the owner's name", async () => {
    await setAiSwitch(env.owner, true);
    const [accounts] = await say("আজকের জন্য Accounts খুলে দাও");
    expect(accounts!.cardStatus).toBe("PROPOSED");
    expect(await prisma.aiGrant.count()).toBe(0);
    await applyCard(env.owner, accounts!.id);
    expect(await prisma.aiGrant.findFirstOrThrow()).toMatchObject({
      node: "b:accounts",
      scope: "TODAY",
      grantedById: env.owner.user.id,
    });
    expect(
      (await prisma.aiChatMessage.findUniqueOrThrow({ where: { id: accounts!.id } })).cardStatus,
    ).toBe("APPLIED");
    expect(
      await prisma.auditLog.findFirstOrThrow({
        where: { entityType: "AiChat", entityId: accounts!.id },
      }),
    ).toMatchObject({
      userId: env.owner.user.id,
      byAi: false,
      summary: "Accounts open today (AI Chat, approved by owner)",
    });
    await expectAppError(applyCard(env.owner, accounts!.id), "CONFLICT");
    await expectAppError(cancelCard(env.owner, accounts!.id), "CONFLICT");
    expect(await prisma.aiGrant.count()).toBe(1);

    // Cancel: nothing changes.
    const [mode] = await say("সাপ্লায়ারকে নিজে পাঠাও, বায়ারকে খসড়া দাও");
    expect(cardOf(mode!)).toMatchObject({
      action: "control.cell",
      params: { node: "k:ai.production.message.supplier", state: "DO" },
    });
    await cancelCard(env.owner, mode!.id);
    expect(await prisma.aiControlCell.count()).toBe(0);

    // The profit % is the owner's, per order.
    const { id, number } = await sheet(env);
    const [profit] = await say(`${number} profit 12.5%`);
    expect(cardOf(profit!)).toMatchObject({
      action: "profit.set",
      lines: [{ label: "Profit %", before: "8%", after: "12.5%" }],
      params: { costingId: id, percent: 12.5 },
    });
    expect(
      (await prisma.orderCosting.findUniqueOrThrow({ where: { id } })).profitPercent?.toString(),
    ).toBe("8");
    // A price: the PIN must be set first, and given (v6.3).
    await expectAppError(applyCard(env.owner, profit!.id), "VALIDATION", /^Set your PIN first/);
    await setPin(env.owner, { pin: "1357" });
    await expectAppError(applyCard(env.owner, profit!.id), "VALIDATION", /Give your PIN/);
    await expectAppError(
      applyCard(env.owner, profit!.id, undefined, "9999"),
      "VALIDATION",
      "The PIN is not right.",
    );
    expect(
      (await prisma.aiChatMessage.findUniqueOrThrow({ where: { id: profit!.id } })).cardStatus,
    ).toBe("PROPOSED");
    await applyCard(env.owner, profit!.id, undefined, "1357");
    expect(
      (await prisma.orderCosting.findUniqueOrThrow({ where: { id } })).profitPercent?.toString(),
    ).toBe("12.5");

    // The Order check card for the sheet: he shows it, the owner decides.
    const [check] = await say(`${number} কস্টিং`);
    expect(check!.text).toMatch(/You decide; I only show the card\.$/);
    expect(cardOf(check!)).toMatchObject({ type: "check", costingId: id, profitPercent: "12.5" });
    expect((await prisma.orderCosting.findUniqueOrThrow({ where: { id } })).decision).toBeNull();

    // A task and a follow-up date.
    const [task] = await say("Task: Check the bookings, by 2026-12-01");
    await applyCard(env.owner, task!.id);
    expect(await prisma.task.findFirstOrThrow()).toMatchObject({
      title: "Check the bookings",
      assigneeId: null,
    });
    // Written with its letters: a bare number of 4 to 8 digits is hidden (v6.4.2).
    const [follow] = await say("Follow up: Nordic Wear, in 3 days, PO4501");
    expect(await prisma.aiFollowUp.count()).toBe(0);
    await applyCard(env.owner, follow!.id);
    const today = localDay(new Date(), env.company.timezone);
    const row = await prisma.aiFollowUp.findFirstOrThrow();
    expect(row).toMatchObject({ partyId: env.buyer.id, recordLabel: "PO4501", status: "OPEN" });
    expect(row.dueOn.toISOString().slice(0, 10)).toBe(addDays(today, 3));

    // A card that fails is offered again.
    const [again] = await say(`${number} profit 15%`);
    await prisma.orderCosting.delete({ where: { id } });
    await expectAppError(applyCard(env.owner, again!.id, undefined, "1357"), "NOT_FOUND");
    expect(
      (await prisma.aiChatMessage.findUniqueOrThrow({ where: { id: again!.id } })).cardStatus,
    ).toBe("PROPOSED");
  });

  it("never deletes: asking to delete becomes a Deletion request", async () => {
    await setAiSwitch(env.owner, true);
    const { number } = await sheet(env);
    // A costing sheet is never deleted in the ERP: nothing is asked.
    const [sheetAnswer] = await say(`delete ${number}`);
    expect(sheetAnswer!.text).toMatch(/cannot be deleted in the ERP \(it keeps costing sheets\)/);
    expect(await prisma.aiDeletionRequest.count()).toBe(0);
    const project = await createProject(env.owner, {
      name: "Old sample polo",
      factoryName: "Own sewing floor",
      targetDate: addDays(localDay(new Date(), env.company.timezone), 30),
      targetQuantity: 50,
      status: "PLANNED",
    });
    const [answer] = await say(`delete ${project.code}`);
    expect(answer!.text).toMatch(/^I never delete anything\. I sent you a Deletion request/);
    expect(await prisma.aiDeletionRequest.findFirstOrThrow()).toMatchObject({
      recordType: "ProductionProject",
      recordId: project.id,
      status: "PENDING",
      channel: "ERP",
      askedBy: LABEL,
    });
    expect(
      (await prisma.productionProject.findUniqueOrThrow({ where: { id: project.id } })).status,
    ).toBe("PLANNED");
    const [old] = await say("পুরোনো ড্রাফট বুকিংগুলো মুছে দাও");
    expect(old!.text).toBe("There are no draft bookings older than 30 days. Nothing to ask.");
    expect(await prisma.aiDeletionRequest.count()).toBe(1);
  });

  it("writes taught rules down for approval; পাঠাও only shows the draft again, Send sends it", async () => {
    await setAiSwitch(env.owner, true);
    await say("নিয়ম: Nordic Wear-এর কলার সবসময় 3 1/4 ইঞ্চি");
    expect(await prisma.houseRule.findFirstOrThrow()).toMatchObject({
      status: "PROPOSED",
      source: "Chat",
      text: "Nordic Wear-এর কলার সবসময় 3 1/4 ইঞ্চি",
    });

    const [nothing] = await say("পাঠাও");
    expect(nothing!.text).toBe("There is no draft in this chat to send. Open Drafts to send one.");

    const sent = mailbox();
    await saveMailSettings(env.owner, MAIL);
    const [drafted] = await say("Draft follow-up to Nordic Wear, about PO4501");
    expect(cardOf(drafted!)).toMatchObject({
      type: "draft",
      party: "Nordic Wear AB",
      forBuyer: true,
      to: "orders@nordicwear.test",
    });
    expect(sent).toHaveLength(0);
    const draftId = (cardOf(drafted!) as { draftId: string }).draftId;
    // Words never send: the exact draft comes back with its buyer and subject, to confirm.
    const [shown] = await say("পাঠাও");
    expect(shown!.text).toMatch(
      /^Send this one\? To Nordic Wear AB \(orders@nordicwear\.test\): ".+"\. Press Send under it to send it\. Nothing goes until you press it\.$/,
    );
    expect(cardOf(shown!)).toMatchObject({ type: "draft", draftId });
    expect(sent).toHaveLength(0);
    await sendDraft(env.owner, draftId);
    expect(sent).toHaveLength(1);
    const [twice] = await say("পাঠাও");
    expect(twice!.text).toMatch(/^The draft shown last here \(".+"\) was sent already\./);
    expect(sent).toHaveLength(1);
    expect((await getChat(env.owner)).messages.find((m) => m.id === drafted!.id)?.draftStatus).toBe(
      "SENT",
    );
  });

  it("answers free questions with Claude and tools that only read or propose", async () => {
    await setAiSwitch(env.owner, true);
    await setApiKey(env.owner, { key: KEY });
    const { id, number } = await sheet(env);
    const calls = claudeSays(
      toolUse("costing_check", { number }),
      claudeMessage("Two yellow signals. The profit is yours to set."),
    );
    const [answer] = await say("Should we take the Nordic polo order?");
    expect(answer!.text).toBe("Two yellow signals. The profit is yours to set.");
    expect(cardOf(answer!)).toMatchObject({ type: "check", costingId: id });
    expect(calls).toHaveLength(2);
    const tools = calls[0]!.tools!.map((t) => (t as Anthropic.Tool).name);
    expect(tools).toEqual(
      expect.arrayContaining(["read_books", "costing_check", "draft_message", "ask_deletion"]),
    );
    expect(tools.some((t) => /^(delete|send|apply|set)_/.test(t))).toBe(false);
    expect(calls[1]!.messages.at(-1)).toMatchObject({
      role: "user",
      content: [expect.objectContaining({ type: "tool_result", tool_use_id: "toolu_1" })],
    });
    // His usage is counted like every AI call.
    expect(await prisma.aiUsage.count({ where: { task: "chat" } })).toBe(2);

    // "@X07 ...": only that expert answers.
    claudeSays(claudeMessage("Keep 5% for enzyme wash."));
    const [expert] = await say("@X07 এনজাইম ওয়াশে শ্রিঙ্কেজ কত ধরব?");
    expect(expert!.text).toMatch(/^X07 · .+: Keep 5% for enzyme wash\.$/);
  });

  it("keeps the mailbox password sealed, and only the owner sets it up", async () => {
    await expectAppError(saveMailSettings(env.watcher, MAIL), "FORBIDDEN");
    await saveMailSettings(env.owner, MAIL);
    const row = await prisma.companyMailSettings.findUniqueOrThrow({
      where: { companyId: env.company.id },
    });
    expect(row.passwordSealed).toBeTruthy();
    expect(row.passwordSealed).not.toContain(MAIL.password);
    const screen = await getMailSettings(env.owner);
    expect(JSON.stringify(screen)).not.toContain(MAIL.password);
    expect(screen.own).toMatchObject({
      host: "smtp.gmail.com",
      port: 587,
      hasPassword: true,
      testedAt: null,
    });

    // An empty password keeps the one saved.
    await saveMailSettings(env.owner, { ...MAIL, password: "", fromName: "Extas Merchandising" });
    const sent = mailbox();
    await sendTestMail(env.owner);
    expect(sent[0]).toMatchObject({
      config: { password: MAIL.password, fromName: "Extas Merchandising" },
      mail: { to: "owner@extas.test", subject: "Extas: test email" },
    });
    expect((await getMailSettings(env.owner)).own?.testedAt).not.toBeNull();

    standInForMail(async () => {
      throw Object.assign(new Error("535 5.7.8 Username and Password not accepted"), {
        code: "EAUTH",
      });
    });
    await expectAppError(sendTestMail(env.owner), "UNAVAILABLE", /refused the login/);
    expect(
      await prisma.notificationLog.findFirstOrThrow({
        where: { channel: "EMAIL", status: "FAILED" },
      }),
    ).toMatchObject({ error: "The mailbox refused the login. Check the user name and password." });

    await removeMailSettings(env.owner);
    expect(await mailConfigOf(env.company.id)).toBeNull();

    await setReplyRemindHours(env.owner, { hours: 6 });
    expect((await getAiStatus(env.owner)).replyRemindHours).toBe(6);
    await expect(setReplyRemindHours(env.owner, { hours: 0 })).rejects.toBeInstanceOf(ZodError);
    await expectAppError(setReplyRemindHours(env.watcher, { hours: 12 }), "FORBIDDEN");
  });

  it("opens Mehedi 2.0 to ai.view and his chat only to the owner", async () => {
    signedIn.ctx = env.watcher;
    expect((await getMehediAction()).ok).toBe(true);
    const chat = await sendChatAction({ text: "help" });
    expect(chat.ok || chat.error.code).toBe("FORBIDDEN");
    const seen = await getChatAction();
    expect(seen.ok || seen.error.code).toBe("FORBIDDEN");
    const mail = await saveMailSettingsAction(MAIL);
    expect(mail.ok || mail.error.code).toBe("FORBIDDEN");
    expect(await prisma.aiChatMessage.count()).toBe(0);
    expect(await prisma.companyMailSettings.count()).toBe(0);

    signedIn.ctx = env.owner;
    expect((await sendChatAction({ text: "help" })).ok).toBe(true);
    const mine = await getChatAction();
    expect(mine.ok && mine.data.messages.map((m) => m.role)).toEqual(["OWNER", "AI"]);
  });
});
