import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4 C: Bug Guard, the owner's all-round auditor. Only the platform owner
 * uses it. Its checks only read; what they find is kept from run to run (new,
 * back again, gone, put right), reported in Bengali on the bot and in the
 * inbox, and fixed only with the owner's OK: a code fix goes to Claude Code
 * and is judged again after the merge; a data correction waits for the PIN and
 * a backup, is logged and can be undone; a security step needs the PIN. By
 * itself it only blocks a new place after many wrong passwords and ends a
 * suspicious sign-in from a new place, never the owner's, never a place the
 * team signs in from. Its schedule and weekly summary run on the clock.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST as telegramWebhook } from "@/app/api/bot/telegram/webhook/route";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { saveTelegram, startLink, telegramSecret } from "@/modules/ai/bot/bot.service";
import { type BotCall, standInForBotApi } from "@/modules/ai/bot/channel";
import { saveGitHub } from "@/modules/ai/full-check/full-check.service";
import { setPin } from "@/modules/ai/settings.service";
import { login } from "@/modules/auth/auth.service";
import { afterFixes, scheduled, weekly } from "@/modules/bug-guard/clock";
import {
  applyCorrection,
  cancelCorrection,
  fixFinding,
  ignoreFinding,
  liftBlock,
  processCorrections,
  reopenFinding,
  snoozeFinding,
  undoCorrection,
} from "@/modules/bug-guard/fixes.service";
import { getBugGuard, runNow } from "@/modules/bug-guard/screen.service";
import { BLOCKED_TEXT, endSession } from "@/modules/bug-guard/security";
import { DEPLOY_MS, startBugGuard, STALE_RUN_MS } from "@/modules/bug-guard/runner";
import { SECURITY_CHECKS } from "@/modules/bug-guard/checks/security";
import { saveSettings } from "@/modules/bug-guard/settings.service";
import type { Check, Found } from "@/modules/bug-guard/types";
import { runDueJobs } from "@/modules/jobs/worker";

import { type FakeGitHub, startFakeGitHub } from "../fixtures/fake-github";
import { addToCompany, contextFor, makeCompany, makeUser, PASSWORD, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const PIN = "4321";
const MIN = 60_000;

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

/** What the test checks find this time. */
const world: { found: Found[]; broken: Found[] | "throw" } = { found: [], broken: [] };

const CHECKS: Check[] = [
  { key: "test.things", area: "DATA", label: "Test things", run: async () => world.found },
  {
    key: "test.broken",
    area: "APP",
    label: "A check that can break",
    run: async () => {
      if (world.broken === "throw") throw new Error("it broke");
      return world.broken;
    },
  },
  {
    key: "test.writer",
    area: "APP",
    label: "A check that tries to write",
    run: async (ctx) => {
      if (world.found.some((f) => f.key === "try-to-write")) {
        await ctx.db.company.update({ where: { id: ctx.companyId }, data: { name: "Changed" } });
      }
      return [];
    },
  },
];

const thing = (key: string, severity: Found["severity"], extra: Partial<Found> = {}): Found => ({
  key,
  area: "DATA",
  severity,
  title: `সমস্যা ${key}`,
  why: "কারণ",
  fix: "সমাধান",
  fixKind: "MANUAL",
  ...extra,
});

async function setup() {
  const { company, roles } = await makeCompany("Extas");
  const join = async (roleId: string, who: string, isSuperAdmin = false) => {
    const user = await makeUser(`${who}@extas.test`, { isSuperAdmin });
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner", true);
  const partner = await join(roles.SUPER_ADMIN, "partner");
  const staff = await join(roles.ACCOUNTS, "staff");
  const other = await join(roles.SALES_EXECUTIVE, "other");
  return { company, roles, owner, partner, staff, other };
}

type Env = Awaited<ReturnType<typeof setup>>;

/** Waits for the company's runs to finish (a run started by the clock is not awaited). */
async function settled(companyId: string) {
  for (let i = 0; i < 1200; i += 1) {
    const going = await prisma.bugGuardRun.count({ where: { companyId, status: "RUNNING" } });
    if (going === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("Bug Guard is still running");
}

const TOKEN = "123456789:AAH_test-token-abcdefghijklmnopqrstuv";
const OWNER_CHAT = 555001;

type Sent = { method: string; json: Record<string, unknown> };

/** Telegram, as a stand-in that records every call. */
function botApi() {
  const calls: Sent[] = [];
  let next = 100;
  standInForBotApi(async (call: BotCall) => {
    const tg = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(call.url);
    if (!tg) throw new Error(`Unexpected call to ${call.url}`);
    calls.push({ method: tg[2]!, json: (call.json ?? {}) as Record<string, unknown> });
    if (tg[2] === "getMe") {
      return {
        status: 200,
        body: {
          ok: true,
          result: { id: 123456789, username: "extas_ai_bot", first_name: "Extas AI" },
        },
      };
    }
    if (tg[2] === "sendMessage") {
      return { status: 200, body: { ok: true, result: { message_id: (next += 1) } } };
    }
    return { status: 200, body: { ok: true, result: true } };
  });
  const sent = () => calls.filter((c) => c.method === "sendMessage");
  return {
    said: () => sent().map((c) => String(c.json.text)),
    buttonsOf: (c: Sent | undefined) =>
      (
        (
          c?.json.reply_markup as {
            inline_keyboard?: Array<Array<{ text: string; callback_data: string }>>;
          }
        )?.inline_keyboard ?? []
      ).flat(),
    sent,
  };
}

let updateId = 5000;
const typed = (text: string) => ({
  update_id: (updateId += 1),
  message: {
    message_id: updateId,
    chat: { id: OWNER_CHAT, type: "private" },
    from: { id: OWNER_CHAT, first_name: "Mehadi" },
    text,
  },
});
const press = (data: string) => ({
  update_id: (updateId += 1),
  callback_query: {
    id: `cb${updateId}`,
    from: { id: OWNER_CHAT, first_name: "Mehadi" },
    data,
    message: { message_id: 777, chat: { id: OWNER_CHAT, type: "private" } },
  },
});

async function telegram(update: unknown) {
  const response = await telegramWebhook(
    new Request("https://erp.test/api/bot/telegram/webhook", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": telegramSecret(TOKEN),
        "content-type": "application/json",
      },
      body: JSON.stringify(update),
    }),
  );
  await runDueJobs();
  return response.status;
}

run("Bug Guard", () => {
  let env: Env;
  let uploads: string;

  beforeEach(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("AI_API_KEY", "");
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("DEMO_SITE", "");
    uploads = await mkdtemp(path.join(os.tmpdir(), "extras-bug-guard-"));
    vi.stubEnv("UPLOAD_DIR", uploads);
    world.found = [];
    world.broken = [];
    await resetDb();
    env = await setup();
  });
  afterEach(async () => {
    await settled(env.company.id);
    vi.unstubAllEnvs();
    await rm(uploads, { recursive: true, force: true });
  });

  const guard = (now: Date, trigger: "NOW" | "SCHEDULE" = "NOW") =>
    startBugGuard(env.company.id, trigger, env.owner.user.id, {
      checks: CHECKS,
      wait: true,
      fullCheck: false,
      now,
    });
  const findingOf = (key: string) =>
    prisma.bugGuardFinding.findUniqueOrThrow({
      where: { companyId_key: { companyId: env.company.id, key } },
    });
  const runOf = (id: string) => prisma.bugGuardRun.findUniqueOrThrow({ where: { id } });

  it("is the platform owner's only, and reading it saves nothing", async () => {
    await expectAppError(getBugGuard(env.partner), "FORBIDDEN", /platform owner/);
    await expectAppError(runNow(env.partner), "FORBIDDEN");
    await expectAppError(
      saveSettings(env.partner, { schedule: { mode: "DAYS", every: 1, times: ["02:00"] } }),
      "FORBIDDEN",
    );
    const screen = await getBugGuard(env.owner);
    expect(screen.settings).toMatchObject({ saved: false, autoPrepare: false, weeklyDay: 6 });
    expect(screen.settings.scheduleText).toMatch(/3 days/);
    expect(await prisma.bugGuardSettings.count()).toBe(0);

    const saved = await saveSettings(env.owner, {
      schedule: { mode: "HOURS", every: 6, times: ["01:00"] },
      weeklyDay: 1,
      weeklyTime: "09:00",
    });
    expect(saved.schedule).toMatch(/6 hours/);
    const events = await prisma.bugGuardEvent.findMany({ where: { kind: "SETTINGS" } });
    expect(events).toHaveLength(1);
    expect(events[0]!.byId).toBe(env.owner.user.id);
    expect(await prisma.auditLog.count({ where: { entityType: "BugGuardSettings" } })).toBe(1);
  });

  it("keeps what it finds from run to run: new, gone, back again, ignored, waiting", async () => {
    const t0 = new Date("2026-10-20T00:00:00Z");
    world.found = [thing("a", "URGENT"), thing("b", "LATER")];
    world.broken = [thing("c", "IMPORTANT")];
    const r1 = await guard(t0);
    expect(await runOf(r1.id)).toMatchObject({
      status: "DONE",
      urgent: 1,
      important: 1,
      later: 1,
      newCount: 3,
      fixedCount: 0,
    });
    // The report: the owner's inbox (no bot is linked here).
    const inbox = await prisma.notificationLog.findMany({
      where: { userId: env.owner.user.id, channel: "IN_APP" },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.subject).toBe("Bug Guard: জরুরি 1, গুরুত্বপূর্ণ 1");
    expect(inbox[0]!.body).toMatch(/🔴 জরুরি[\s\S]*🟠 গুরুত্বপূর্ণ[\s\S]*🟢 পরে দেখলেও চলবে/);
    expect(
      await prisma.notificationLog.count({ where: { userId: env.partner.user.id } }),
      "only the platform owner hears",
    ).toBe(0);

    // b is gone; c's check broke, so c is left as it was.
    world.found = [thing("a", "URGENT")];
    world.broken = "throw";
    const r2 = await guard(new Date(t0.getTime() + 60 * MIN));
    expect(await runOf(r2.id)).toMatchObject({ newCount: 0, fixedCount: 1 });
    expect((await runOf(r2.id)).note).toMatch(/could not finish: A check that can break/);
    expect((await findingOf("b")).status).toBe("GONE");
    expect((await findingOf("c")).status).toBe("OPEN");
    expect((await findingOf("a")).seenCount).toBe(2);

    // b comes back.
    world.found = [thing("a", "URGENT"), thing("b", "LATER")];
    world.broken = [thing("c", "IMPORTANT")];
    const r3 = await guard(new Date(t0.getTime() + 120 * MIN));
    expect(await runOf(r3.id)).toMatchObject({ newCount: 1 });
    expect((await findingOf("b")).status).toBe("OPEN");
    expect(await prisma.bugGuardEvent.count({ where: { kind: "REOPENED" } })).toBe(1);

    // Ignored: quiet, unless it gets worse.
    await ignoreFinding(env.owner, (await findingOf("b")).id);
    await guard(new Date(t0.getTime() + 180 * MIN));
    expect((await findingOf("b")).status).toBe("IGNORED");
    world.found = [thing("a", "URGENT"), thing("b", "IMPORTANT")];
    await guard(new Date(t0.getTime() + 240 * MIN));
    expect((await findingOf("b")).status).toBe("OPEN");

    // Remind me later: quiet for 3 days, then back.
    const at = new Date(t0.getTime() + 300 * MIN);
    const { until } = await snoozeFinding(env.owner, (await findingOf("a")).id, undefined, at);
    expect(until.getTime() - at.getTime()).toBe(3 * 86_400_000);
    await guard(new Date(at.getTime() + 86_400_000));
    expect((await findingOf("a")).status).toBe("SNOOZED");
    await guard(new Date(at.getTime() + 4 * 86_400_000));
    expect((await findingOf("a")).status).toBe("OPEN");
    expect((await findingOf("a")).reportedAt).not.toBeNull();

    // Show again.
    await ignoreFinding(env.owner, (await findingOf("c")).id);
    await reopenFinding(env.owner, (await findingOf("c")).id);
    expect((await findingOf("c")).status).toBe("OPEN");
    await expectAppError(ignoreFinding(env.partner, (await findingOf("c")).id), "FORBIDDEN");

    const screen = await getBugGuard(env.owner);
    expect(screen.open.map((f) => f.severity)).toEqual(["URGENT", "IMPORTANT", "IMPORTANT"]);
    expect(screen.last?.checks.map((c) => c.status)).toEqual(["FOUND", "FOUND", "OK"]);
  });

  it("only reads while it checks, and runs one at a time", async () => {
    world.found = [thing("try-to-write", "LATER")];
    const r = await guard(new Date("2026-10-20T00:00:00Z"));
    const checks = (await runOf(r.id)).checks as Array<{
      key: string;
      status: string;
      note?: string;
    }>;
    expect(checks.find((c) => c.key === "test.writer")).toMatchObject({
      status: "FAILED",
      note: expect.stringMatching(/only reads/),
    });
    expect((await prisma.company.findUniqueOrThrow({ where: { id: env.company.id } })).name).toBe(
      "Extas",
    );

    const now = new Date();
    const going = await prisma.bugGuardRun.create({
      data: { companyId: env.company.id, trigger: "NOW", status: "RUNNING", startedAt: now },
    });
    await expectAppError(runNow(env.owner), "CONFLICT", /checking already/);
    await prisma.bugGuardRun.update({
      where: { id: going.id },
      data: { startedAt: new Date(now.getTime() - STALE_RUN_MS - MIN) },
    });
    world.found = [];
    await guard(now);
    expect((await runOf(going.id)).status).toBe("FAILED");
  });

  describe("code fixes", () => {
    let gh: FakeGitHub;
    beforeEach(async () => {
      gh = await startFakeGitHub("extas/erp");
      vi.stubEnv("GITHUB_API_URL", gh.url);
      await saveGitHub(env.owner, { repo: "extas/erp", token: gh.token });
    });
    afterEach(async () => {
      await gh.close();
    });

    const codeThing = () =>
      thing("err", "URGENT", {
        area: "APP",
        title: "স্ক্রিনে এরর: Rahim Traders এর অর্ডার খোলা যাচ্ছে না",
        href: "/sales/orders/ckorder0000000000000000001",
        fixKind: "CODE",
        evidence: [{ label: "বার্তা", value: "Customer Rahim Traders owes 125000" }],
        code: {
          route: "/sales/orders/[orderId]",
          method: "GET",
          status: 500,
          errorType: "TypeError",
          stack: ["at load (/app/.next/server/app/sales/orders/page.js:10:5)"],
          times: 3,
        },
      });

    it("sends only safe facts to Claude Code, and judges the fix after the merge and the update", async () => {
      const t0 = new Date("2026-10-20T00:00:00Z");
      world.found = [codeThing()];
      await guard(t0);
      const f = await findingOf("err");
      const done = await fixFinding(env.owner, f.id);
      expect(done).toMatchObject({ kind: "CODE" });
      expect(gh.state.issues).toHaveLength(1);
      const body = JSON.stringify([gh.state.issues, gh.calls.map((c) => c.body)]);
      expect(body).toContain("/sales/orders/[orderId]");
      expect(body).toContain("TypeError");
      expect(body).not.toMatch(/Rahim|125000|ckorder|এরর/);
      const fixing = await findingOf("err");
      expect(fixing.status).toBe("FIXING");
      await expectAppError(fixFinding(env.owner, f.id), "CONFLICT", /working on this already/);
      expect(await prisma.bugGuardEvent.findFirst({ where: { kind: "FIX_ASKED" } })).toMatchObject({
        byId: env.owner.user.id,
      });

      // Not merged yet: found or not, it waits for the fix.
      await guard(new Date(t0.getTime() + 60 * MIN));
      expect((await findingOf("err")).status).toBe("FIXING");
      world.found = [];
      await guard(new Date(t0.getTime() + 120 * MIN));
      expect((await findingOf("err")).status).toBe("FIXING");

      // Merged: judged only on what was seen after the safe update.
      const merged = new Date(t0.getTime() + 180 * MIN);
      await prisma.claudeCodeRequest.update({
        where: { id: fixing.requestId! },
        data: { state: "MERGED", mergedAt: merged, mergedById: env.owner.user.id },
      });
      world.found = [codeThing()];
      await guard(new Date(merged.getTime() + 5 * MIN));
      expect((await findingOf("err")).status).toBe("FIXING");
      await guard(new Date(merged.getTime() + DEPLOY_MS + MIN));
      const again = await findingOf("err");
      expect(again).toMatchObject({ status: "OPEN", requestId: null });
      expect(
        (await prisma.bugGuardEvent.findFirst({ where: { kind: "REOPENED" } }))?.summary,
      ).toMatch(/did not put it right/);

      // A second fix that works.
      await fixFinding(env.owner, again.id);
      const second = await findingOf("err");
      const merged2 = new Date(merged.getTime() + 300 * MIN);
      await prisma.claudeCodeRequest.update({
        where: { id: second.requestId! },
        data: { state: "MERGED", mergedAt: merged2 },
      });
      world.found = [];
      const r = await guard(new Date(merged2.getTime() + DEPLOY_MS + MIN));
      expect((await findingOf("err")).status).toBe("FIXED");
      expect((await runOf(r.id)).fixedCount).toBe(1);
    });

    it("puts a stopped fix back in the list, and checks again after a merge", async () => {
      world.found = [codeThing()];
      await guard(new Date(Date.now() - 3 * 60 * MIN));
      const f = await findingOf("err");
      await fixFinding(env.owner, f.id);
      const { requestId } = await findingOf("err");
      await prisma.claudeCodeRequest.update({
        where: { id: requestId! },
        data: { state: "STOPPED", note: "Closed without merging" },
      });
      await afterFixes(new Date());
      expect(await findingOf("err")).toMatchObject({ status: "OPEN", requestId: null });

      await fixFinding(env.owner, f.id);
      const second = await findingOf("err");
      const mergedAt = new Date(Date.now() - DEPLOY_MS - MIN);
      await prisma.claudeCodeRequest.update({
        where: { id: second.requestId! },
        data: { state: "MERGED", mergedAt, mergedById: env.owner.user.id },
      });
      await afterFixes(new Date());
      const after = await prisma.bugGuardRun.findFirst({ where: { trigger: "AFTER_FIX" } });
      expect(after).toMatchObject({ startedById: env.owner.user.id });
      await settled(env.company.id);
      await afterFixes(new Date());
      expect(await prisma.bugGuardRun.count({ where: { trigger: "AFTER_FIX" } })).toBe(1);
    });
  });

  describe("data corrections", () => {
    async function accounts() {
      const make = (code: string, name: string) =>
        prisma.ledgerAccount.create({
          data: { companyId: env.company.id, code, name, type: "ASSET", subType: "BANK" },
        });
      return { cash: await make("T-CASH", "Test cash"), bank: await make("T-BANK", "Test bank") };
    }
    const backup =
      (status: "RUNNING" | "SUCCEEDED" | "FAILED" = "RUNNING") =>
      async () =>
        (await prisma.backupRun.create({ data: { trigger: "MANUAL", status } })).id;

    it("applies an exact correction only with the PIN and after a backup, logged and undoable", async () => {
      const { cash, bank } = await accounts();
      world.found = [
        thing("money", "IMPORTANT", {
          fixKind: "DATA",
          correction: {
            kind: "JOURNAL",
            date: "2026-10-20",
            description: "ব্যাংক ও ক্যাশ মেলানো",
            lines: [
              { accountId: cash.id, account: cash.name, debit: "150.00", credit: "0" },
              { accountId: bank.id, account: bank.name, debit: "0", credit: "150.00" },
            ],
          },
        }),
      ];
      await guard(new Date());
      const f = await findingOf("money");
      const prepared = await fixFinding(env.owner, f.id);
      expect(prepared).toMatchObject({ kind: "DATA" });
      const id = (prepared as { correctionId: string }).correctionId;
      expect((prepared as { summary: string }).summary).toContain("Test cash: ডেবিট 150");
      expect(await prisma.journalEntry.count()).toBe(0);

      await expectAppError(applyCorrection(env.owner, id, {}), "VALIDATION", /PIN first/);
      await setPin(env.owner, { pin: PIN });
      await expectAppError(
        applyCorrection(env.owner, id, {}, undefined, undefined, backup()),
        "VALIDATION",
        /PIN/,
      );
      await expect(
        applyCorrection(env.owner, id, { pin: "9999" }, undefined, undefined, backup()),
      ).rejects.toBeInstanceOf(AppError);
      await expectAppError(
        applyCorrection(env.partner, id, { pin: PIN }, undefined, undefined, backup()),
        "FORBIDDEN",
      );

      const started = await applyCorrection(
        env.owner,
        id,
        { pin: PIN },
        undefined,
        undefined,
        backup(),
      );
      expect(await prisma.bugGuardCorrection.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: "BACKING_UP",
        backupRunId: started.backupRunId,
      });
      await expectAppError(
        applyCorrection(env.owner, id, { pin: PIN }, undefined, undefined, backup()),
        "CONFLICT",
      );
      // Nothing changes until the backup is done.
      await processCorrections(new Date());
      expect(await prisma.journalEntry.count()).toBe(0);
      await prisma.backupRun.update({
        where: { id: started.backupRunId },
        data: { status: "SUCCEEDED" },
      });
      await processCorrections(new Date());
      const applied = await prisma.bugGuardCorrection.findUniqueOrThrow({ where: { id } });
      expect(applied.status).toBe("APPLIED");
      const entry = await prisma.journalEntry.findUniqueOrThrow({
        where: { id: applied.journalEntryId! },
        include: { lines: true },
      });
      expect(entry).toMatchObject({
        sourceType: "CORRECTION",
        sourceId: id,
        postedById: env.owner.user.id,
      });
      expect(
        entry.lines.map((l) => [l.accountId, l.debit.toFixed(2), l.credit.toFixed(2)]),
      ).toEqual(
        expect.arrayContaining([
          [cash.id, "150.00", "0.00"],
          [bank.id, "0.00", "150.00"],
        ]),
      );
      expect((await findingOf("money")).status).toBe("FIXED");
      expect(await prisma.bugGuardEvent.findFirst({ where: { kind: "APPLIED" } })).toMatchObject({
        byId: env.owner.user.id,
      });
      expect(
        await prisma.auditLog.count({ where: { entityType: "BugGuardCorrection", entityId: id } }),
      ).toBe(2);

      // Undo: a reversing entry; the first entry stays (history is never edited or deleted).
      await expectAppError(undoCorrection(env.owner, id, {}), "VALIDATION", /PIN/);
      await undoCorrection(env.owner, id, { pin: PIN });
      const undone = await prisma.bugGuardCorrection.findUniqueOrThrow({ where: { id } });
      expect(undone.status).toBe("UNDONE");
      expect(await prisma.journalEntry.count()).toBe(2);
      expect(await prisma.journalEntry.findUnique({ where: { id: entry.id } })).not.toBeNull();
      expect((await findingOf("money")).status).toBe("OPEN");
      await expectAppError(undoCorrection(env.owner, id, { pin: PIN }), "CONFLICT");

      // A failed backup changes nothing; Cancel changes nothing.
      const again = await fixFinding(env.owner, f.id);
      const id2 = (again as { correctionId: string }).correctionId;
      await applyCorrection(env.owner, id2, { pin: PIN }, undefined, undefined, backup("FAILED"));
      await processCorrections(new Date());
      const failed = await prisma.bugGuardCorrection.findUniqueOrThrow({ where: { id: id2 } });
      expect(failed).toMatchObject({
        status: "PREPARED",
        error: expect.stringMatching(/backup failed/),
      });
      expect(await prisma.journalEntry.count()).toBe(2);
      await cancelCorrection(env.owner, id2);
      expect(
        (await prisma.bugGuardCorrection.findUniqueOrThrow({ where: { id: id2 } })).status,
      ).toBe("CANCELLED");
    });

    it("refuses a correction of anything but the listed totals", async () => {
      world.found = [
        thing("bad", "URGENT", {
          fixKind: "DATA",
          correction: {
            kind: "SET",
            changes: [
              {
                model: "User",
                id: env.partner.user.id,
                field: "isSuperAdmin",
                before: "0",
                after: "1",
                label: "x",
              },
            ],
          },
        }),
      ];
      await guard(new Date());
      await expectAppError(
        fixFinding(env.owner, (await findingOf("bad")).id),
        "VALIDATION",
        /may not change User/,
      );
      expect(await prisma.bugGuardCorrection.count()).toBe(0);
    });
  });

  describe("security", () => {
    const wrong = (email: string, ip: string) =>
      login({ email, password: "not-the-password" }, { ipAddress: ip }).catch(() => undefined);

    it("blocks a new place after 10 wrong passwords, never a place the team uses, and the owner lifts it with the PIN", async () => {
      const ip = "203.0.113.9";
      for (let i = 0; i < 10; i += 1) await wrong(`nobody${i}@x.test`, ip);
      const block = await prisma.loginBlock.findFirstOrThrow({ where: { source: ip } });
      expect(block.liftedAt).toBeNull();
      await expectAppError(
        login({ email: "staff@extas.test", password: PASSWORD }, { ipAddress: ip }),
        "ACCOUNT_LOCKED",
        BLOCKED_TEXT,
      );
      expect(
        await prisma.bugGuardEvent.findFirst({ where: { kind: "SOURCE_BLOCKED" } }),
      ).toMatchObject({
        byId: null,
      });
      expect(
        await prisma.notificationLog.count({
          where: { userId: env.owner.user.id, subject: { contains: "blocked for 24 hours" } },
        }),
      ).toBe(1);

      // The office: someone signed in from there, so it is never blocked by itself.
      const office = "198.51.100.7";
      await login({ email: "staff@extas.test", password: PASSWORD }, { ipAddress: office });
      for (let i = 0; i < 12; i += 1) await wrong(`typo${i}@x.test`, office);
      expect(await prisma.loginBlock.count({ where: { source: office } })).toBe(0);
      expect(await prisma.bugGuardEvent.count({ where: { kind: "KNOWN_PLACE_FAILURES" } })).toBe(1);
      await login({ email: "other@extas.test", password: PASSWORD }, { ipAddress: office });

      await expectAppError(liftBlock(env.owner, block.id, {}), "VALIDATION", /PIN/);
      await setPin(env.owner, { pin: PIN });
      await liftBlock(env.owner, block.id, { pin: PIN });
      await login({ email: "staff@extas.test", password: PASSWORD }, { ipAddress: ip });
    });

    it("ends a sign-in from a new place right after wrong passwords for several accounts, never the owner's", async () => {
      const ip = "192.0.2.50";
      await wrong("ghost@x.test", ip);
      await wrong("other@extas.test", ip);
      await wrong("partner@extas.test", ip);
      await expectAppError(
        login({ email: "staff@extas.test", password: PASSWORD }, { ipAddress: ip }),
        "ACCOUNT_LOCKED",
        /looked unsafe/,
      );
      const session = await prisma.session.findFirstOrThrow({
        where: { userId: env.staff.user.id, ipAddress: ip },
      });
      expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now());
      expect(
        await prisma.bugGuardEvent.findFirst({ where: { kind: "SESSION_ENDED" } }),
      ).toMatchObject({
        byId: null,
      });
      const owner = await login(
        { email: "owner@extas.test", password: PASSWORD },
        { ipAddress: ip },
      );
      expect(owner.token).toBeTruthy();
      const ownSession = await prisma.session.findFirstOrThrow({
        where: { userId: env.owner.user.id, ipAddress: ip },
      });
      await expectAppError(
        endSession({
          sessionId: ownSession.id,
          companyId: env.company.id,
          byId: null,
          why: "test",
        }),
        "FORBIDDEN",
        /never ends the owner's own/,
      );
    });

    it("takes a security step from a finding only with the PIN", async () => {
      const ip = "203.0.113.77";
      for (let i = 0; i < 6; i += 1) await wrong(`x${i}@x.test`, ip);
      const r = await startBugGuard(env.company.id, "NOW", env.owner.user.id, {
        checks: SECURITY_CHECKS.filter((c) => c.key === "security.failed-logins"),
        wait: true,
        fullCheck: false,
      });
      expect((await runOf(r.id)).status).toBe("DONE");
      const f = await findingOf(`security.failed-place:${ip}`);
      expect(f).toMatchObject({ fixKind: "SECURITY", severity: "IMPORTANT" });
      await expectAppError(fixFinding(env.owner, f.id, {}), "VALIDATION", /PIN/);
      await setPin(env.owner, { pin: PIN });
      expect(await fixFinding(env.owner, f.id, { pin: PIN })).toMatchObject({ kind: "SECURITY" });
      expect(await prisma.loginBlock.count({ where: { source: ip, liftedAt: null } })).toBe(1);
      expect((await findingOf(`security.failed-place:${ip}`)).status).toBe("FIXED");
    });
  });

  describe("on the bot", () => {
    afterEach(() => standInForBotApi(null));

    it('reports with Fix, Ignore and Remind me later, takes the presses, asks the PIN to apply, and runs on "bug guard"', async () => {
      const api = botApi();
      await saveTelegram(env.owner, { token: TOKEN });
      const { code } = await startLink(env.owner, "TELEGRAM");
      expect(await telegram(typed(`/start ${code}`))).toBe(200);
      const cash = await prisma.ledgerAccount.create({
        data: {
          companyId: env.company.id,
          code: "T-CASH",
          name: "Test cash",
          type: "ASSET",
          subType: "BANK",
        },
      });
      const bank = await prisma.ledgerAccount.create({
        data: {
          companyId: env.company.id,
          code: "T-BANK",
          name: "Test bank",
          type: "ASSET",
          subType: "BANK",
        },
      });
      world.found = [
        thing("a", "URGENT", {
          fixKind: "DATA",
          correction: {
            kind: "JOURNAL",
            date: "2026-10-20",
            description: "মেলানো",
            lines: [
              { accountId: cash.id, account: cash.name, debit: "10.00", credit: "0" },
              { accountId: bank.id, account: bank.name, debit: "0", credit: "10.00" },
            ],
          },
        }),
        thing("b", "LATER"),
      ];
      // The AI is off: Bug Guard is the owner's own alarm, so it still reports.
      await guard(new Date());
      await runDueJobs();
      expect(api.said().some((t) => t.startsWith("Bug Guard · Extas"))).toBe(true);
      const a = await findingOf("a");
      const item = api.sent().find((c) => String(c.json.text).includes("কী সমস্যা: সমস্যা a"));
      expect(api.buttonsOf(item).map((b) => [b.text, b.callback_data])).toEqual([
        ["Fix", `bg:${a.id}:f`],
        ["Ignore", `bg:${a.id}:i`],
        ["Remind me later", `bg:${a.id}:l`],
      ]);
      expect(api.said().some((t) => t.includes("কী সমস্যা: সমস্যা b"))).toBe(false);

      await telegram(press(`bg:${a.id}:l`));
      expect((await findingOf("a")).status).toBe("SNOOZED");
      expect(api.said().at(-1)).toMatch(/3 দিন পর/);
      await reopenFinding(env.owner, a.id);

      await telegram(press(`bg:${a.id}:f`));
      const correction = await prisma.bugGuardCorrection.findFirstOrThrow();
      expect(api.buttonsOf(api.sent().at(-1)).map((b) => b.callback_data)).toEqual([
        `bc:${correction.id}:a`,
        `bc:${correction.id}:x`,
      ]);
      await setPin(env.owner, { pin: PIN });
      await telegram(press(`bc:${correction.id}:a`));
      expect(api.said().at(-1)).toMatch(/Send your PIN to apply a data correction/);
      await telegram(typed("বাতিল"));
      expect(api.said().at(-1)).toBe("Stopped: nothing changed.");
      expect((await prisma.bugGuardCorrection.findFirstOrThrow()).status).toBe("PREPARED");
      await telegram(press(`bc:${correction.id}:x`));
      expect((await prisma.bugGuardCorrection.findFirstOrThrow()).status).toBe("CANCELLED");

      await telegram(typed("bug guard"));
      expect(api.said().at(-1)).toMatch(/Bug Guard চেক শুরু করেছে/);
      await settled(env.company.id);
      expect(await prisma.bugGuardRun.findFirst({ where: { trigger: "TELEGRAM" } })).toMatchObject({
        status: "DONE",
        startedById: env.owner.user.id,
      });
      const before = api.said().length;
      await runDueJobs();
      expect(
        api
          .said()
          .slice(before)
          .some((t) => t.startsWith("Bug Guard · Extas")),
      ).toBe(true);
    });
  });

  describe("the clock", () => {
    it("starts a scheduled run once when it is due, all checks only reading, and moves the next one on", async () => {
      const now = new Date();
      expect(await scheduled(now)).toBeNull();
      const settings = await prisma.bugGuardSettings.findUniqueOrThrow({
        where: { companyId: env.company.id },
      });
      expect(settings.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
      await prisma.bugGuardSettings.update({
        where: { companyId: env.company.id },
        data: { nextRunAt: new Date(now.getTime() - MIN) },
      });
      const started = await scheduled(now);
      expect(started).toMatchObject({ trigger: "SCHEDULE" });
      expect(await scheduled(now)).toBeNull();
      await settled(env.company.id);
      const done = await runOf(started!.id);
      expect(done.status).toBe("DONE");
      const checks = done.checks as Array<{ key: string; status: string; note?: string }>;
      // Every real check ran on this database and none tried to write.
      expect(checks.length).toBeGreaterThanOrEqual(20);
      expect(checks.filter((c) => c.note && /only reads/.test(c.note))).toEqual([]);
      expect(done.note).toMatch(/GitHub is not connected/);
      const moved = await prisma.bugGuardSettings.findUniqueOrThrow({
        where: { companyId: env.company.id },
      });
      expect(moved.nextRunAt!.getTime()).toBeGreaterThan(now.getTime());
      expect(moved.lastRunAt).not.toBeNull();
    });

    it("sends the weekly summary once, on the owner's day, even when all is well", async () => {
      await scheduled(new Date());
      // Saturday 2026-10-24, 10:05 in Dhaka.
      const saturday = new Date("2026-10-24T04:05:00Z");
      await weekly(new Date("2026-10-24T03:55:00Z"));
      expect(
        await prisma.notificationLog.count({ where: { subject: "Bug Guard: weekly summary" } }),
      ).toBe(0);
      await weekly(saturday);
      await weekly(new Date(saturday.getTime() + 30 * MIN));
      const sent = await prisma.notificationLog.findMany({
        where: { subject: "Bug Guard: weekly summary" },
      });
      expect(sent).toHaveLength(1);
      expect(sent[0]!.body).toMatch(/সব ঠিক আছে/);
    });
  });
});
