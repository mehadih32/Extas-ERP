import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4.1 review 2: a copy that is not the ERP in use (on standby after a
 * restore, or a restore drill copy) still runs Bug Guard (its schedule, the
 * check after a fix, "Run now"), but never asks GitHub for the Full check
 * (which checks the live web address) and never prepares Claude Code fixes or
 * data corrections by itself: those belong to the ERP in use. Nor does it
 * change anything on GitHub at all; reading stays possible.
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

/** What the clock asked each run for, and the test's own checks in place of every check. */
const started = vi.hoisted(() => ({
  options: [] as Record<string, unknown>[],
  checks: [] as unknown[],
}));
vi.mock("@/modules/bug-guard/runner", async (original) => {
  const real = await original<typeof import("@/modules/bug-guard/runner")>();
  return {
    ...real,
    startBugGuard: (...args: Parameters<typeof real.startBugGuard>) => {
      const options = args[3] ?? {};
      started.options.push(options);
      return real.startBugGuard(args[0], args[1], args[2], {
        checks: started.checks as never,
        ...options,
      });
    },
  };
});

import { prisma } from "@/lib/prisma";
import { STANDBY_NOT_DONE } from "@/modules/backups/standby";
import { afterFixes, scheduled } from "@/modules/bug-guard/clock";
import { DEPLOY_MS, startBugGuard } from "@/modules/bug-guard/runner";
import { ensureSettings } from "@/modules/bug-guard/settings.service";
import type { Check, Found } from "@/modules/bug-guard/types";
import { getPull, openIssue } from "@/modules/github/github";

import { addToCompany, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const world: { found: Found[] } = { found: [] };
const CHECKS: Check[] = [
  { key: "test.things", area: "APP", label: "Test things", run: async () => world.found },
];
const thing = (key: string): Found => ({
  key,
  area: "APP",
  severity: "IMPORTANT",
  title: `সমস্যা ${key}`,
  why: "কারণ",
  fix: "সমাধান",
  fixKind: "CODE",
});

run("Bug Guard on a copy that is not the ERP in use (v6.4.1 review 2)", () => {
  let backupDir: string;
  let platformId: string;
  let ownerId: string;

  beforeEach(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("DEMO_SITE", "");
    backupDir = await mkdtemp(path.join(os.tmpdir(), "extras-bug-guard-standby-"));
    vi.stubEnv("BACKUP_DIR", backupDir);
    world.found = [];
    prepared.calls = 0;
    fullChecks.asked = [];
    started.options = [];
    started.checks = CHECKS;
    await resetDb();
    const { company, roles } = await makeCompany("Extas");
    platformId = company.id;
    const owner = await makeUser("owner@extas.test", { isSuperAdmin: true });
    ownerId = owner.id;
    await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);
    // GitHub is connected (AI Center > Full check), and the owner lets Bug Guard
    // prepare fixes by itself.
    await prisma.aiSettings.create({
      data: { companyId: platformId, githubRepo: "extas/erp", githubTokenSealed: "sealed" },
    });
    await ensureSettings(platformId, new Date());
    await prisma.bugGuardSettings.update({
      where: { companyId: platformId },
      data: { autoPrepare: true },
    });
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    await rm(backupDir, { recursive: true, force: true });
  });

  const MARKS = [
    { mark: ".standby", words: "3f9a0c1d2e4b5a69", why: "this copy is on standby" },
    { mark: ".drill", words: "{}", why: "this is a restore drill copy" },
  ];

  const finished = (id: string) =>
    vi.waitFor(
      async () => {
        const r = await prisma.bugGuardRun.findUniqueOrThrow({ where: { id } });
        expect(r.status).not.toBe("RUNNING");
        return r;
      },
      { timeout: 20_000 },
    );

  it("checks, but asks GitHub for no Full check and prepares nothing, whoever starts it", async () => {
    for (const { mark, words, why } of MARKS) {
      await writeFile(path.join(backupDir, mark), words);
      world.found = [thing(`run-now${mark}`)];
      // "Run now", with the defaults (Full check and preparing on).
      const now = await startBugGuard(platformId, "NOW", ownerId, { wait: true, checks: CHECKS });
      const done = await prisma.bugGuardRun.findUniqueOrThrow({ where: { id: now.id } });
      expect(done.status).toBe("DONE");
      expect(done.newCount).toBe(1);
      expect(done.fullCheckRunId).toBeNull();
      expect(done.note).toContain(`The Full check was not asked for: ${why}`);

      // The owner's schedule.
      world.found = [thing(`schedule${mark}`)];
      await prisma.bugGuardSettings.update({
        where: { companyId: platformId },
        data: { nextRunAt: new Date(Date.now() - 60_000) },
      });
      const scheduledRun = await scheduled(new Date());
      expect(scheduledRun).not.toBeNull();
      expect((await finished(scheduledRun!.id)).fullCheckRunId).toBeNull();

      // The check after a merged fix.
      await new Promise((resolve) => setTimeout(resolve, 50));
      world.found = [thing(`after-fix${mark}`)];
      const request = await prisma.claudeCodeRequest.create({
        data: {
          companyId: platformId,
          kind: "FIX",
          title: "Fix",
          text: "Fix it",
          state: "MERGED",
          // Merged just long enough ago for the safe update to have run, after the runs above.
          mergedAt: new Date(Date.now() - DEPLOY_MS - 1),
        },
      });
      await prisma.bugGuardFinding.create({
        data: {
          companyId: platformId,
          key: `fixing${mark}`,
          check: "test.things",
          area: "APP",
          severity: "IMPORTANT",
          title: "সমস্যা",
          why: "কারণ",
          fix: "সমাধান",
          fixKind: "CODE",
          status: "FIXING",
          requestId: request.id,
        },
      });
      await afterFixes(new Date());
      const afterFix = await prisma.bugGuardRun.findFirstOrThrow({
        where: { trigger: "AFTER_FIX" },
        orderBy: { startedAt: "desc" },
      });
      expect((await finished(afterFix.id)).fullCheckRunId).toBeNull();
      await prisma.bugGuardFinding.updateMany({
        where: { requestId: request.id },
        data: { status: "FIXED" },
      });
      await rm(path.join(backupDir, mark));
    }
    expect(fullChecks.asked).toEqual([]);
    expect(prepared.calls).toBe(0);
    // The clock asks for neither on such a copy.
    const fromClock = started.options.filter((o) => o.now !== undefined);
    expect(fromClock).toHaveLength(4);
    for (const options of fromClock) {
      expect(options).toMatchObject({ fullCheck: false, prepare: false });
    }

    // The ERP in use: the Full check and the fixes, as before.
    world.found = [thing("in-use")];
    const live = await startBugGuard(platformId, "NOW", ownerId, { wait: true, checks: CHECKS });
    expect(
      (await prisma.bugGuardRun.findUniqueOrThrow({ where: { id: live.id } })).fullCheckRunId,
    ).toBeTruthy();
    expect(fullChecks.asked).toEqual([platformId]);
    expect(prepared.calls).toBe(1);
  });

  it("changes nothing on GitHub from a copy on standby; reading stays possible", async () => {
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetches.push(String(url));
      return new Response(JSON.stringify({ number: 7, head: { sha: "x", ref: "b" } }), {
        status: 200,
      });
    });
    await writeFile(path.join(backupDir, ".standby"), "3f9a0c1d2e4b5a69");
    const gh = { repo: "owner/repo", token: "t" };
    await expect(openIssue(gh, { title: "x", body: "y" })).rejects.toThrow(STANDBY_NOT_DONE);
    expect(fetches).toEqual([]);
    await getPull(gh, 7).catch(() => undefined);
    expect(fetches).toHaveLength(1);
    // In use again (go-live.sh): it may.
    await rm(path.join(backupDir, ".standby"));
    await openIssue(gh, { title: "x", body: "y" }).catch(() => undefined);
    expect(fetches).toHaveLength(2);
  });
});
