import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4 fresh review, Bug Guard and security: what the reviewers found, each
 * with the rule it breaks.
 *   S1   alarms (Bug Guard, backups, Server Health) reach only the bot links of
 *        active platform owners; platform-wide alarms only the platform company.
 *   S3   a blocked place lets the platform owner in with the right password
 *        (the account lock still applies); nobody else.
 *   S4   a sign-in Bug Guard stopped never makes its place "known".
 *   S5/6 an adjusting entry is checked again when it is applied, under a lock,
 *        in the ERP's lock order, and the supplier's bills follow it.
 *   S8   a server error shows its own company's message only.
 *   S10  what Bug Guard sends by itself is logged as Bug Guard, not the owner.
 *   S11  Bug Guard's own reads are not counted as slow database calls.
 *   S12  the Full check is started on the main branch.
 *   S13  a SELECT that ends a session or takes a lock is refused in read-only work.
 *   L5   Bug Guard's night run gives the Full check a longer time.
 *   L12  the bot shows only counts for Help searches that found nothing.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

import { POST as telegramWebhook } from "@/app/api/bot/telegram/webhook/route";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { readOnly } from "@/lib/read-only";
import { slowQueriesSince } from "@/lib/slow-queries";
import { summaryText } from "@/modules/bug-guard/bot-texts";
import { APP_CHECKS } from "@/modules/bug-guard/checks/app";
import { PRODUCT_CHECKS } from "@/modules/bug-guard/checks/product";
import { saveTelegram, startLink, telegramSecret } from "@/modules/ai/bot/bot.service";
import { type BotCall, standInForBotApi } from "@/modules/ai/bot/channel";
import { pushToBot } from "@/modules/ai/bot/push";
import { saveGitHub, startFullCheck } from "@/modules/ai/full-check/full-check.service";
import { alertOwner } from "@/modules/backups/backup-core";
import { fixFinding, prepareByItself } from "@/modules/bug-guard/fixes.service";
import { READ_ONLY_WHY } from "@/modules/bug-guard/runner";
import { alarmOwner } from "@/modules/bug-guard/security";
import type { CompanyContext } from "@/modules/auth/context";
import { runDueJobs } from "@/modules/jobs/worker";
import type { CheckContext } from "@/modules/bug-guard/types";

import { type FakeGitHub, startFakeGitHub } from "../fixtures/fake-github";
import { addToCompany, contextFor, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

/** A store with its platform owner, a partner in the Super Admin role (not the platform owner) and staff. */
async function setup(name = "Extas") {
  const { company, roles } = await makeCompany(name);
  const slug = name.toLowerCase().replace(/\s+/g, "-");
  const join = async (roleId: string, who: string, isSuperAdmin = false) => {
    const user = await makeUser(`${who}@${slug}.test`, { isSuperAdmin });
    await addToCompany(user.id, company.id, roleId);
    return contextFor(user.id, company.id);
  };
  const owner = await join(roles.SUPER_ADMIN, "owner", true);
  const partner = await join(roles.SUPER_ADMIN, "partner");
  const staff = await join(roles.ACCOUNTS, "staff");
  return { company, roles, owner, partner, staff };
}

/** A Bug Guard finding as a run keeps it. */
function finding(companyId: string, key: string, extra: Record<string, unknown> = {}) {
  return prisma.bugGuardFinding.create({
    data: {
      companyId,
      key,
      check: key.split(":")[0]!,
      area: "APP",
      severity: "URGENT",
      title: `সমস্যা ${key}`,
      why: "কারণ",
      fix: "সমাধান",
      fixKind: "MANUAL",
      ...extra,
    },
  });
}

/** Runs one of Bug Guard's real checks for a company, only reading. */
function check(key: string, companyId: string, extra: Partial<CheckContext> = {}) {
  const found = [...APP_CHECKS, ...PRODUCT_CHECKS].find((c) => c.key === key)!;
  const now = new Date();
  return readOnly(READ_ONLY_WHY, () =>
    found.run({
      companyId,
      now,
      since: new Date(now.getTime() - 86_400_000),
      platform: false,
      db: prisma,
      ...extra,
    }),
  );
}

const TOKEN = "123456789:AAH_test-token-abcdefghijklmnopqrstuv";

/** Telegram, as a stand-in: every message sent, with the chat it went to. */
function botApi() {
  const sent: Array<{ chat: string; text: string }> = [];
  let next = 100;
  standInForBotApi(async (call: BotCall) => {
    const tg = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(call.url);
    if (!tg) throw new Error(`Unexpected call to ${call.url}`);
    const json = (call.json ?? {}) as Record<string, unknown>;
    if (tg[2] === "getMe") {
      return {
        status: 200,
        body: { ok: true, result: { id: 123456789, username: "extas_ai_bot", first_name: "AI" } },
      };
    }
    if (tg[2] === "sendMessage") {
      sent.push({ chat: String(json.chat_id), text: String(json.text) });
      return { status: 200, body: { ok: true, result: { message_id: (next += 1) } } };
    }
    return { status: 200, body: { ok: true, result: true } };
  });
  return { sent, to: (chat: number) => sent.filter((m) => m.chat === String(chat)) };
}

let updateId = 9000;
/** Links the person's own Telegram chat to the store's bot, the way the owner does it. */
async function linkBot(who: CompanyContext, chat: number) {
  await saveTelegram(who, { token: TOKEN });
  const { code } = await startLink(who, "TELEGRAM");
  const response = await telegramWebhook(
    new Request("https://erp.test/api/bot/telegram/webhook", {
      method: "POST",
      headers: {
        "x-telegram-bot-api-secret-token": telegramSecret(TOKEN),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        update_id: (updateId += 1),
        message: {
          message_id: updateId,
          chat: { id: chat, type: "private" },
          from: { id: chat, first_name: "Someone" },
          text: `/start ${code}`,
        },
      }),
    }),
  );
  expect(response.status).toBe(200);
  await runDueJobs();
  expect(
    await prisma.aiBotLink.findFirstOrThrow({ where: { companyId: who.company.id } }),
  ).toMatchObject({ chatId: String(chat), ownerId: who.user.id });
}

async function refusedInside(work: () => Promise<unknown>) {
  // Awaited inside: a Prisma query starts only when it is awaited.
  const error = await readOnly(READ_ONLY_WHY, async () => await work()).then(
    () => null,
    (e: unknown) => e,
  );
  expect(error, "expected it to be refused").toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe("FORBIDDEN");
}

run("Bug Guard, after the review", () => {
  beforeEach(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("DEMO_SITE", "");
    await resetDb();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("reading only (S11, S13)", () => {
    it("refuses a SELECT with side effects, and never counts Bug Guard's own reads as slow", async () => {
      const { company } = await makeCompany("Extas");
      await refusedInside(() => prisma.$queryRawUnsafe("SELECT pg_advisory_xact_lock(1)"));
      await refusedInside(() =>
        prisma.$queryRawUnsafe("SELECT pg_terminate_backend(pg_backend_pid() + 100000)"),
      );
      expect((await prisma.company.findUniqueOrThrow({ where: { id: company.id } })).name).toBe(
        "Extas",
      );

      const since = new Date();
      await readOnly(READ_ONLY_WHY, async () => {
        await prisma.$queryRawUnsafe("SELECT 1 AS n FROM pg_sleep(1.05)");
      });
      expect(slowQueriesSince(since)).toEqual([]);
      await prisma.$queryRawUnsafe("SELECT 1 AS n FROM pg_sleep(1.05)");
      expect(slowQueriesSince(since)).toEqual([
        expect.objectContaining({ model: "RawSQL", operation: "$queryRawUnsafe" }),
      ]);
    });
  });

  describe("server errors (S8)", () => {
    it("show the company's own error message and stack, never another company's", async () => {
      const { company: mine } = await makeCompany("Extas");
      const { company: theirs } = await makeCompany("Other Store");
      const error = (companyId: string, at: Date, message: string, stack: string) =>
        prisma.serverError.create({
          data: {
            companyId,
            at,
            routeType: "render",
            method: "GET",
            path: "/sales/orders/[id]",
            errorName: "TypeError",
            message,
            stack: [stack],
            errorId: companyId === mine.id ? "ERR-MINE" : "ERR-THEIRS",
          },
        });
      await error(mine.id, new Date(Date.now() - 60 * 60_000), "Our own message", "at ours");
      // The other store's error is newer: it must not be shown to this store.
      await error(theirs.id, new Date(Date.now() - 60_000), "Their private message", "at theirs");
      const [finding] = await check("app.server-errors", mine.id);
      expect(finding!.evidence).toEqual(
        expect.arrayContaining([
          { label: "বার্তা", value: "Our own message" },
          { label: "এরর কোড", value: "ERR-MINE" },
        ]),
      );
      expect(JSON.stringify(finding)).not.toMatch(/Their private|at theirs|ERR-THEIRS/);
      expect(finding!.code?.stack).toEqual(["at ours"]);
    });
  });

  describe("the Full check (S12)", () => {
    let gh: FakeGitHub;
    beforeEach(async () => {
      gh = await startFakeGitHub("extas/erp");
      vi.stubEnv("GITHUB_API_URL", gh.url);
      vi.stubEnv("GITHUB_OIDC_ISSUER", gh.issuer);
    });
    afterEach(async () => {
      await gh.close();
    });

    it("is started on the main branch, the only one whose proof the ERP takes", async () => {
      const { owner } = await setup();
      await saveGitHub(owner, { repo: "extas/erp", token: gh.token });
      // Someone made another branch the default on GitHub.
      gh.state.defaultBranch = "develop";
      await startFullCheck(owner);
      const dispatch = gh.calls.find((c) => c.path.endsWith("/full-check.yml/dispatches"))!;
      expect(dispatch.body).toMatchObject({ ref: "main" });
    });

    it("logs what Bug Guard sends to Claude Code by itself as Bug Guard's, not the owner's (S10)", async () => {
      const { company, owner } = await setup();
      await saveGitHub(owner, { repo: "extas/erp", token: gh.token });
      const code = (route: string) => ({
        fixKind: "CODE",
        code: { route, method: "GET", status: 500, errorType: "TypeError", stack: [], times: 2 },
      });
      const byItself = await finding(company.id, "app.error:a", code("/sales"));
      const pressed = await finding(company.id, "app.error:b", code("/parties"));
      await prepareByItself(company.id, [byItself.id]);
      await fixFinding(owner, pressed.id);
      const logged = await prisma.auditLog.findMany({
        where: { companyId: company.id, entityType: "ClaudeCodeRequest" },
        orderBy: { createdAt: "asc" },
      });
      expect(logged).toHaveLength(2);
      expect(logged[0]).toMatchObject({ userId: null });
      expect(logged[0]!.summary).toMatch(/^Bug Guard \(automatic\): Sent to Claude Code/);
      // The owner's own press stays in the owner's name.
      expect(logged[1]).toMatchObject({ userId: owner.user.id });
      expect(logged[1]!.summary).toMatch(/^Sent to Claude Code/);
    });
  });

  describe("Help searches that found nothing (L12)", () => {
    it("reach the bot as counts only; the words stay in the ERP for the owner", async () => {
      const { company } = await makeCompany("Extas");
      const { localDay } = await import("@/lib/dates");
      const day = localDay(new Date(), "Asia/Dhaka");
      for (const [subject, count] of [
        ["karim traders due", 3],
        ["lc margin rahim", 2],
      ] as const) {
        await prisma.usageCount.create({
          data: { companyId: company.id, day, kind: "HELP_MISS", subject, count },
        });
      }
      const [finding] = await check("product.help-misses", company.id);
      expect(finding!.title).not.toMatch(/karim|rahim|traders|margin/);
      expect(finding!.title).toMatch(/2টি/);
      expect(finding!.title).toMatch(/5 বার/);
      // The words are in the evidence: shown on the Bug Guard screen, not on the bot.
      expect(finding!.evidence).toEqual(
        expect.arrayContaining([{ label: "karim traders due", value: "3 বার" }]),
      );
      const report = summaryText(
        {
          company: "Extas",
          at: new Date(),
          checked: 1,
          failedChecks: [],
          newCount: 1,
          fixedCount: 0,
          open: [
            { severity: finding!.severity, title: finding!.title, href: finding!.href ?? null },
          ],
        },
        "https://erp.test",
      );
      expect(report).not.toMatch(/karim|rahim/);
    });
  });

  describe("alarms on the bot (S1)", () => {
    afterEach(() => standInForBotApi(null));

    it("go only to a bot linked by an active platform owner; ordinary AI pushes keep their rules", async () => {
      const api = botApi();
      const { company, owner, partner } = await setup();
      // A partner in the Super Admin role (not the platform owner) linked the bot.
      const PARTNER_CHAT = 700001;
      await linkBot(partner, PARTNER_CHAT);
      const before = api.sent.length;
      await alarmOwner(
        company.id,
        "Sign-in from 203.0.113.9 blocked for 24 hours",
        "Lift it with your PIN.",
      );
      await pushToBot(company.id, { kind: "text", text: "Bug Guard: সব ঠিক আছে" }, { alarm: true });
      await runDueJobs();
      expect(api.sent.slice(before)).toEqual([]);
      // The inbox copy still reaches the platform owner.
      expect(
        await prisma.notificationLog.count({
          where: { userId: owner.user.id, subject: { contains: "blocked for 24 hours" } },
        }),
      ).toBe(1);
      expect(await prisma.notificationLog.count({ where: { userId: partner.user.id } })).toBe(0);

      // Ordinary AI pushes keep today's rules: with the AI on, the linked chat gets them.
      await prisma.aiSettings.upsert({
        where: { companyId: company.id },
        create: { companyId: company.id, enabled: true },
        update: { enabled: true },
      });
      await pushToBot(company.id, { kind: "text", text: "Morning note" });
      await runDueJobs();
      expect(api.to(PARTNER_CHAT).map((m) => m.text)).toContain("Morning note");

      // Once the platform owner links their own chat, the alarms reach it.
      const OWNER_CHAT = 700002;
      await linkBot(owner, OWNER_CHAT);
      await alarmOwner(company.id, "A correction was not applied", "Nothing was changed.");
      await runDueJobs();
      expect(api.to(OWNER_CHAT).some((m) => m.text.includes("A correction was not applied"))).toBe(
        true,
      );
    });

    it("about backups go only to the platform company's owners, never another store's bot", async () => {
      const api = botApi();
      // The platform's own store is the oldest.
      const platform = await setup("Extas");
      const store = await setup("Other Store");
      // The platform owner is a member of the other store too; its own admin linked its bot.
      await addToCompany(platform.owner.user.id, store.company.id, store.roles.SUPER_ADMIN);
      const OWNER_CHAT = 710001;
      const STORE_CHAT = 710002;
      await linkBot(platform.owner, OWNER_CHAT);
      await linkBot(store.partner, STORE_CHAT);
      const linked = api.sent.length;
      await alertOwner("Backup failed", "The database copy could not be made.");
      await runDueJobs();
      const after = api.sent.slice(linked);
      expect(after.map((m) => m.chat)).toEqual([String(OWNER_CHAT)]);
      expect(after[0]!.text).toMatch(/^Backup failed/);
      const inbox = await prisma.notificationLog.findMany({
        where: { subject: "Backup failed" },
        select: { companyId: true, userId: true },
      });
      expect(inbox).toEqual([{ companyId: platform.company.id, userId: platform.owner.user.id }]);
    });
  });
});
