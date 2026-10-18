import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * v6.4 (G1): after a restore on a new server, bootstrap.sh runs Bug Guard
 * (deploy/bug-guard.sh --after-restore). The server leaves a request in
 * BACKUP_DIR; the ERP's clock takes it once, runs Bug Guard on every company
 * (each only reading, the report to the inbox and Telegram as always) and
 * leaves what it found for the script to print.
 */

vi.mock("next/cache", () => ({ revalidatePath: () => undefined, revalidateTag: () => undefined }));

const prepared = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/modules/bug-guard/fixes.service", async (original) => ({
  ...(await original<typeof import("@/modules/bug-guard/fixes.service")>()),
  prepareByItself: async () => {
    prepared.calls += 1;
  },
}));

import { prisma } from "@/lib/prisma";
import {
  AFTER_RESTORE_REQUEST,
  AFTER_RESTORE_RESULT,
  bugGuardAfterRestore,
} from "@/modules/bug-guard/after-restore";
import { ensureSettings } from "@/modules/bug-guard/settings.service";
import type { Check, Found } from "@/modules/bug-guard/types";

import { addToCompany, makeCompany, makeUser, resetDb } from "./helpers";

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const found: Found[] = [];
const CHECKS: Check[] = [
  { key: "test.things", area: "DATA", label: "Test things", run: async () => found },
];
const thing = (key: string, severity: Found["severity"]): Found => ({
  key,
  area: "DATA",
  severity,
  title: `সমস্যা ${key}`,
  why: "কারণ",
  fix: "সমাধান",
  fixKind: "MANUAL",
});

run("Bug Guard after a restore (G1)", () => {
  let backupDir: string;
  let companyId: string;

  beforeEach(async () => {
    vi.stubEnv("ENCRYPTION_KEY", "test-encryption-key-0123456789");
    vi.stubEnv("APP_URL", "https://erp.test");
    vi.stubEnv("DEMO_SITE", "");
    backupDir = await mkdtemp(path.join(os.tmpdir(), "extras-bug-guard-restore-"));
    vi.stubEnv("BACKUP_DIR", backupDir);
    found.length = 0;
    prepared.calls = 0;
    await resetDb();
    const { company, roles } = await makeCompany("Extas");
    companyId = company.id;
    const owner = await makeUser("owner@extas.test", { isSuperAdmin: true });
    await addToCompany(owner.id, company.id, roles.SUPER_ADMIN);
    await makeCompany("Extras Kids");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(backupDir, { recursive: true, force: true });
  });

  const result = async () =>
    JSON.parse(await readFile(path.join(backupDir, AFTER_RESTORE_RESULT), "utf8")) as {
      requestedAt: string;
      ok: boolean;
      companies: Array<Record<string, unknown>>;
    };

  it("runs once on every company when the server asks, and leaves what it found", async () => {
    // Nothing asked: nothing runs.
    expect(await bugGuardAfterRestore({ checks: CHECKS })).toBeNull();
    expect(await prisma.bugGuardRun.count()).toBe(0);

    found.push(thing("a", "IMPORTANT"), thing("b", "LATER"));
    const requestedAt = new Date().toISOString();
    await writeFile(path.join(backupDir, AFTER_RESTORE_REQUEST), JSON.stringify({ requestedAt }));
    const done = await bugGuardAfterRestore({ checks: CHECKS });
    expect(done).toMatchObject({ requestedAt, ok: true });

    // Taken once.
    expect(existsSync(path.join(backupDir, AFTER_RESTORE_REQUEST))).toBe(false);
    expect(await bugGuardAfterRestore({ checks: CHECKS })).toBeNull();

    const runs = await prisma.bugGuardRun.findMany({ orderBy: { startedAt: "asc" } });
    expect(runs).toHaveLength(2);
    for (const r of runs) {
      expect(r).toMatchObject({ trigger: "NOW", startedById: null, status: "DONE" });
      // The report went to the inbox, as after every run.
      expect(r.reportSentAt).toBeInstanceOf(Date);
    }
    const written = await result();
    expect(written).toEqual(done);
    expect(written.companies).toEqual(
      expect.arrayContaining([
        { name: "Extas", status: "DONE", urgent: 0, important: 1, later: 1, failedChecks: 0 },
        { name: "Extras Kids", status: "DONE", urgent: 0, important: 1, later: 1, failedChecks: 0 },
      ]),
    );
    expect(
      await prisma.notificationLog.count({ where: { subject: { startsWith: "Bug Guard" } } }),
    ).toBeGreaterThan(0);
    // It only read: the companies are as they were.
    expect(await prisma.company.findUniqueOrThrow({ where: { id: companyId } })).toMatchObject({
      name: "Extas",
    });
  });

  it("prepares no fix by itself, even when the owner lets Bug Guard do so (v6.4.1 review)", async () => {
    // A restored copy may not be the ERP in use: no Claude Code fix issue from it.
    await ensureSettings(companyId, new Date());
    await prisma.bugGuardSettings.update({ where: { companyId }, data: { autoPrepare: true } });
    found.push(thing("a", "URGENT"));
    await writeFile(
      path.join(backupDir, AFTER_RESTORE_REQUEST),
      JSON.stringify({ requestedAt: new Date().toISOString() }),
    );
    expect(await bugGuardAfterRestore({ checks: CHECKS })).toMatchObject({ ok: true });
    expect(prepared.calls).toBe(0);
  });

  it("says when a company could not be checked", async () => {
    const requestedAt = new Date().toISOString();
    await writeFile(path.join(backupDir, AFTER_RESTORE_REQUEST), JSON.stringify({ requestedAt }));
    // A run already going on one company (the schedule): that company says so.
    await prisma.bugGuardRun.create({
      data: { companyId, trigger: "SCHEDULE", status: "RUNNING" },
    });
    const done = await bugGuardAfterRestore({ checks: CHECKS });
    expect(done?.ok).toBe(false);
    expect(done?.companies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Extas", status: "NOT_RUN", note: expect.any(String) }),
        expect.objectContaining({ name: "Extras Kids", status: "DONE" }),
      ]),
    );
  });

  it("ignores a request that is not one", async () => {
    await writeFile(path.join(backupDir, AFTER_RESTORE_REQUEST), "not json");
    expect(await bugGuardAfterRestore({ checks: CHECKS })).toBeNull();
    expect(existsSync(path.join(backupDir, AFTER_RESTORE_REQUEST))).toBe(false);
    expect(await prisma.bugGuardRun.count()).toBe(0);
  });
});
