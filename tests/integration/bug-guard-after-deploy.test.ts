import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4.1 (D5): after each update deploy.sh asks the live ERP for one Bug Guard
 * run (BACKUP_DIR/bug-guard-after-deploy.json). The ERP's clock takes it once
 * and checks every company: only reading, no AI, nothing prepared or corrected
 * (even when the owner lets Bug Guard prepare fixes by itself), a new Full
 * check on GitHub for the platform's own company, and the report in the inbox
 * and on Telegram marked "after the update". What could not be checked is told
 * too; the update itself stays installed.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const prepared = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/modules/bug-guard/fixes.service", async (original) => ({
  ...(await original<typeof import("@/modules/bug-guard/fixes.service")>()),
  prepareByItself: async () => {
    prepared.calls += 1;
  },
}));

const fullChecks = vi.hoisted(() => ({ asked: [] as string[] }));
vi.mock("@/modules/ai/full-check/full-check.service", async (original) => {
  const { prisma: db } = await import("@/lib/prisma");
  return {
    ...(await original<typeof import("@/modules/ai/full-check/full-check.service")>()),
    startFullCheckFor: async (companyId: string) => {
      fullChecks.asked.push(companyId);
      const made = await db.fullCheckRun.create({ data: { companyId, site: "live" } });
      return { id: made.id, site: "live" };
    },
  };
});

import { prisma } from "@/lib/prisma";
import { AFTER_DEPLOY_REQUEST, bugGuardAfterDeploy } from "@/modules/bug-guard/after-deploy";
import { startBugGuard, takeInFullChecks } from "@/modules/bug-guard/runner";
import { ensureSettings } from "@/modules/bug-guard/settings.service";
import type { Check, Found } from "@/modules/bug-guard/types";

import { addToCompany, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const world: { found: Found[]; write: boolean } = { found: [], write: false };
const CHECKS: Check[] = [
  { key: "test.things", area: "DATA", label: "Test things", run: async () => world.found },
  {
    key: "test.writer",
    area: "APP",
    label: "A check that tries to write",
    run: async (ctx) => {
      if (world.write) {
        await ctx.db.company.update({ where: { id: ctx.companyId }, data: { name: "Changed" } });
      }
      return [];
    },
  },
];
const thing = (key: string, severity: Found["severity"]): Found => ({
  key,
  area: "DATA",
  severity,
  title: `সমস্যা ${key}`,
  why: "কারণ",
  fix: "সমাধান",
  fixKind: "DATA",
});

run("Bug Guard once after each update (D5)", () => {
  let backupDir: string;
  let platformId: string;
  let otherId: string;

  beforeEach(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("DEMO_SITE", "");
    backupDir = await mkdtemp(path.join(os.tmpdir(), "extras-bug-guard-deploy-"));
    vi.stubEnv("BACKUP_DIR", backupDir);
    world.found = [];
    world.write = false;
    prepared.calls = 0;
    fullChecks.asked = [];
    await resetDb();
    const { company, roles } = await makeCompany("Extas");
    platformId = company.id;
    const owner = await makeUser("owner@extas.test", { isSuperAdmin: true });
    await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);
    otherId = (await makeCompany("Extras Kids")).company.id;
    // GitHub is connected on the platform's company (AI Center > Full check).
    await prisma.aiSettings.create({
      data: { companyId: platformId, githubRepo: "extas/erp", githubTokenSealed: "sealed" },
    });
    // The owner lets Bug Guard prepare fixes by itself on its schedule.
    for (const companyId of [platformId, otherId]) {
      await ensureSettings(companyId, new Date());
      await prisma.bugGuardSettings.update({ where: { companyId }, data: { autoPrepare: true } });
    }
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(backupDir, { recursive: true, force: true });
  });

  const ask = () =>
    writeFile(
      path.join(backupDir, AFTER_DEPLOY_REQUEST),
      JSON.stringify({ requestedAt: new Date().toISOString() }),
    );
  const told = (subject: string) =>
    prisma.notificationLog.findMany({ where: { subject }, select: { body: true, userId: true } });

  it("checks every company once, only reading, prepares nothing and reports it as after the update", async () => {
    // Nothing asked: nothing runs.
    expect(await bugGuardAfterDeploy({ checks: CHECKS })).toBeNull();
    expect(await prisma.bugGuardRun.count()).toBe(0);

    world.found = [thing("a", "IMPORTANT")];
    world.write = true;
    // A Full check ran an hour ago: after an update a new one is asked for all the same.
    await prisma.fullCheckRun.create({
      data: {
        companyId: platformId,
        site: "live",
        status: "DONE",
        startedAt: new Date(Date.now() - 3600_000),
      },
    });
    await ask();
    const done = await bugGuardAfterDeploy({ checks: CHECKS });
    expect(done).toEqual([
      { companyId: platformId, status: "DONE" },
      { companyId: otherId, status: "DONE" },
    ]);
    // Taken once.
    expect(existsSync(path.join(backupDir, AFTER_DEPLOY_REQUEST))).toBe(false);
    expect(await bugGuardAfterDeploy({ checks: CHECKS })).toBeNull();

    const runs = await prisma.bugGuardRun.findMany({ orderBy: { startedAt: "asc" } });
    expect(runs).toHaveLength(2);
    for (const r of runs) {
      expect(r).toMatchObject({ trigger: "AFTER_DEPLOY", startedById: null, status: "DONE" });
      expect(r.reportSentAt).toBeInstanceOf(Date);
    }
    // Only the platform's own company asks GitHub for the Full check, and a new one.
    expect(fullChecks.asked).toEqual([platformId]);
    expect(runs.find((r) => r.companyId === platformId)?.fullCheckRunId).toBeTruthy();
    expect(runs.find((r) => r.companyId === otherId)?.fullCheckRunId).toBeNull();

    // Only read: the check that tried to write was refused and nothing changed.
    const checks = runs[0]!.checks as Array<{ key: string; status: string; note?: string }>;
    expect(checks.find((c) => c.key === "test.writer")).toMatchObject({ status: "FAILED" });
    expect(await prisma.company.count({ where: { name: "Changed" } })).toBe(0);
    // Nothing prepared or corrected, though the owner lets Bug Guard prepare by itself.
    expect(prepared.calls).toBe(0);
    expect(await prisma.bugGuardCorrection.count()).toBe(0);
    // No AI.
    expect(await prisma.aiUsage.count()).toBe(0);

    // The report is in the owner's inbox, marked as the check after the update.
    const inbox = await prisma.notificationLog.findMany({
      where: { companyId: platformId, subject: { startsWith: "Bug Guard after the update" } },
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]!.body).toContain("আপডেটের পরের চেক");
    expect(inbox[0]!.body).toContain("কোনো ডেটা বদলায়নি");
    expect(inbox[0]!.body).toContain("Full check GitHub-এ চলছে");
    // v6.4.2: the read-only review of saved CM settlements and bookings, once, in plain words.
    const review = await told("Bug Guard: nothing to review after the update");
    expect(review).toHaveLength(1);
    expect(review[0]!.body).toContain("Nothing was changed.");
    expect(review[0]!.body).toContain("No saved CM settlement would come out different");
    await ask();
    await bugGuardAfterDeploy({ checks: CHECKS });
    expect(await told("Bug Guard: nothing to review after the update")).toHaveLength(1);

    // A run on the owner's schedule does prepare (so the test above means something).
    world.write = false;
    await startBugGuard(platformId, "SCHEDULE", null, {
      wait: true,
      checks: CHECKS,
      fullCheck: false,
    });
    world.found = [thing("b", "URGENT")];
    await startBugGuard(platformId, "SCHEDULE", null, {
      wait: true,
      checks: CHECKS,
      fullCheck: false,
    });
    expect(prepared.calls).toBeGreaterThan(0);
  });

  it("says in the inbox when a company could not be checked, and the update stays installed", async () => {
    // A run going now (started after this server started): the after-update run cannot start.
    await prisma.bugGuardRun.create({
      data: {
        companyId: platformId,
        trigger: "SCHEDULE",
        status: "RUNNING",
        startedAt: new Date(),
      },
    });
    // One from before the server restarted (the update) was cut short: it does not block.
    await prisma.bugGuardRun.create({
      data: {
        companyId: otherId,
        trigger: "SCHEDULE",
        status: "RUNNING",
        startedAt: new Date(Date.now() - process.uptime() * 1000 - 60_000),
      },
    });
    await ask();
    const done = await bugGuardAfterDeploy({ checks: CHECKS });
    expect(done).toEqual([
      { companyId: platformId, status: "NOT_RUN", note: expect.stringMatching(/checking already/) },
      { companyId: otherId, status: "DONE" },
    ]);
    const cut = await prisma.bugGuardRun.findFirstOrThrow({
      where: { companyId: otherId, trigger: "SCHEDULE" },
    });
    expect(cut).toMatchObject({ status: "FAILED", note: expect.stringMatching(/restarted/) });
    const notes = await told("Bug Guard: the check after the update did not finish");
    expect(notes).toHaveLength(1);
    expect(notes[0]!.body).toContain("Bug Guard is checking already");
    expect(notes[0]!.body).toContain("নতুন ভার্শন চালু আছে");
  });

  it("reports how the Full check after the update ended, even when it found nothing", async () => {
    await ask();
    await bugGuardAfterDeploy({ checks: CHECKS });
    const platformRun = await prisma.bugGuardRun.findFirstOrThrow({
      where: { companyId: platformId, trigger: "AFTER_DEPLOY" },
    });
    // GitHub's check could not finish.
    await prisma.fullCheckRun.update({
      where: { id: platformRun.fullCheckRunId! },
      data: { status: "FAILED", note: "GitHub did not start the check." },
    });
    await takeInFullChecks(new Date());
    const failed = await told("Bug Guard: the Full check after the update did not finish");
    expect(failed).toHaveLength(1);
    expect(failed[0]!.body).toContain("GitHub did not start the check.");

    // Next update: the Full check finished and found nothing new; the owner still hears.
    await ask();
    await bugGuardAfterDeploy({ checks: CHECKS });
    const next = await prisma.bugGuardRun.findFirstOrThrow({
      where: { companyId: platformId, trigger: "AFTER_DEPLOY", fullCheckSeenAt: null },
    });
    await prisma.fullCheckRun.update({
      where: { id: next.fullCheckRunId! },
      data: { status: "DONE", finishedAt: new Date() },
    });
    await takeInFullChecks(new Date());
    const finished = await told("Bug Guard: Full check, 0 new");
    expect(finished).toHaveLength(1);
    expect(finished[0]!.body).toContain("আপডেটের পরের Full check শেষ");
    expect(prepared.calls).toBe(0);
  });

  it("never runs on the demo site", async () => {
    vi.stubEnv("DEMO_SITE", "on");
    await ask();
    expect(await bugGuardAfterDeploy({ checks: CHECKS })).toBeNull();
    expect(await prisma.bugGuardRun.count()).toBe(0);
  });

  it("is taken at once on a restore drill copy or a copy on standby, and checks nothing there (v6.4.1 review)", async () => {
    const logged = vi.spyOn(console, "log").mockImplementation(() => undefined);
    for (const mark of [".drill", ".standby"]) {
      await writeFile(path.join(backupDir, mark), mark === ".drill" ? "{}" : "3f9a0c1d2e4b5a69");
      await ask();
      // Taken (deploy.sh does not wait), but no Bug Guard run and no Full check of the
      // live address, which this copy does not own.
      expect(await bugGuardAfterDeploy({ checks: CHECKS })).toBeNull();
      expect(existsSync(path.join(backupDir, AFTER_DEPLOY_REQUEST))).toBe(false);
      expect(await prisma.bugGuardRun.count()).toBe(0);
      expect(fullChecks.asked).toEqual([]);
      await rm(path.join(backupDir, mark));
    }
    expect(logged.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(
      /after the update: not checked here, this is a restore drill copy[\s\S]*after the update: not checked here, this copy is on standby/,
    );
    logged.mockRestore();
  });

  it("is taken by the clock of a restore drill copy too, so the update does not wait for it", async () => {
    await writeFile(path.join(backupDir, ".drill"), "{}");
    await ask();
    const { reminderTick } = await import("@/modules/reminders/scheduler");
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    expect(await reminderTick()).toBeNull();
    await vi.waitFor(() =>
      expect(existsSync(path.join(backupDir, AFTER_DEPLOY_REQUEST))).toBe(false),
    );
    expect(await prisma.bugGuardRun.count()).toBe(0);
    vi.restoreAllMocks();
  });
});
