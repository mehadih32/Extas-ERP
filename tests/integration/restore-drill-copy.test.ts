import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { GET as drillRoute } from "@/app/api/backups/drill/route";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { botCall, standInForBotApi } from "@/modules/ai/bot/channel";
import { driveToken, getBackupConfig } from "@/modules/backups/backup-core";
import { getBackupOverview } from "@/modules/backups/backup.service";
import { backupClock } from "@/modules/backups/scheduler";
import { recordServerDrill, standInForDrillCopy } from "@/modules/backups/server-drill";
import {
  DRILL_LINE,
  DRILL_MARK,
  DRILL_NOT_SENT,
  drillInfo,
  onDrill,
  onStandby,
} from "@/modules/backups/standby";
import { backupHealth } from "@/modules/backups/status";
import { getPull, openIssue } from "@/modules/github/github";
import { jobTick } from "@/modules/jobs/worker";
import { sendMail, standInForMail } from "@/modules/mail/mail.service";

import { makeCompany, makeUser, resetDb } from "./helpers";

/*
 * A restore drill copy (deploy/bootstrap.sh --drill, the guide's "Practice: a
 * restore drill", owner's item 12) runs in test mode for good: no clock runs and
 * nothing leaves it (no email, no bot message, no Google Drive, no GitHub
 * change), while it still opens and can be checked. Its time and result show on
 * its own Backups screen and, once recorded, on the real ERP's.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;

async function appError(promise: Promise<unknown>): Promise<AppError> {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

const FINISHED = {
  address: "drill.example.com",
  startedAt: "2026-10-18T04:00:00Z",
  finishedAt: "2026-10-18T04:46:12Z",
  seconds: 2772,
  backup: "2026-10-17_140000",
  records: 120_000,
  files: 3400,
  problems: 0,
  screenProblems: 0,
  https: true,
  result: "worked",
};

run("a restore drill copy and the drill's record", () => {
  let backupDir: string;
  const env = { ...process.env };

  beforeAll(async () => {
    await resetDb();
  });
  beforeEach(async () => {
    backupDir = await mkdtemp(path.join(os.tmpdir(), "extas-drill-copy-"));
    process.env.BACKUP_DIR = backupDir;
    process.env.APP_URL = "https://erp.example.com";
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_FROM = "erp@example.com";
  });
  afterEach(async () => {
    standInForMail(null);
    standInForBotApi(null);
    standInForDrillCopy(null);
    vi.unstubAllGlobals();
    process.env = { ...env };
    await rm(backupDir, { recursive: true, force: true });
    await resetDb();
  });
  afterAll(async () => {
    await resetDb();
  });

  const markDrill = (drill: object = { address: "drill.example.com" }) =>
    writeFile(path.join(backupDir, DRILL_MARK), JSON.stringify(drill));

  it("sends nothing and runs no clock, and says so on its Backups screen", async () => {
    const { company } = await makeCompany("Drill Co");
    const mails: string[] = [];
    standInForMail(async (_config, mail) => {
      mails.push(mail.to);
      return { messageId: "m1" };
    });
    const botCalls: string[] = [];
    standInForBotApi(async (call) => {
      botCalls.push(call.url);
      return { status: 200, body: { ok: true, result: {} } };
    });
    const fetches: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetches.push(String(url));
      return new Response(JSON.stringify({ number: 7, head: { sha: "x", ref: "b" } }), {
        status: 200,
      });
    });
    await markDrill();
    expect(await onDrill()).toBe(true);
    // No clock: no backup, no background job (checked on its own, not through standby,
    // whose backups and alarms run).
    expect(await onStandby()).toBe(false);
    await backupClock();
    expect(await prisma.backupRun.count()).toBe(0);
    expect(await jobTick()).toBeNull();
    expect((await backupHealth()).line).toBe(DRILL_LINE);
    // A drill copy that also waits on standby: still no backup, alarm or job.
    await writeFile(path.join(backupDir, ".standby"), "words");
    await backupClock();
    expect(await prisma.backupRun.count()).toBe(0);
    expect(await jobTick()).toBeNull();
    expect((await backupHealth()).line).toBe(DRILL_LINE);
    await rm(path.join(backupDir, ".standby"));

    // No email: refused, and the log says why.
    const mail = await appError(
      sendMail(company.id, { to: "buyer@example.com", subject: "Invoice", text: "..." }),
    );
    expect(mail.message).toBe(DRILL_NOT_SENT);
    expect(mails).toEqual([]);
    expect(
      await prisma.notificationLog.findFirst({ where: { recipient: "buyer@example.com" } }),
    ).toMatchObject({ status: "FAILED", error: DRILL_NOT_SENT });

    // No bot message, no webhook change.
    await expect(
      botCall({ url: "https://api.telegram.org/botX/sendMessage", method: "POST", json: {} }),
    ).rejects.toThrow(DRILL_NOT_SENT);
    expect(botCalls).toEqual([]);

    // No Google Drive at all (it holds the real ERP's sign-in).
    expect((await appError(driveToken(await getBackupConfig()))).message).toBe(DRILL_NOT_SENT);

    // GitHub: reads only.
    const gh = { repo: "owner/repo", token: "t" };
    expect((await appError(openIssue(gh, { title: "x", body: "y" }))).message).toBe(DRILL_NOT_SENT);
    expect(fetches).toEqual([]);
    await getPull(gh, 7).catch(() => undefined);
    expect(fetches).toHaveLength(1);

    // Without the mark (any other ERP), the same email goes out.
    await rm(path.join(backupDir, DRILL_MARK));
    await sendMail(company.id, { to: "buyer@example.com", subject: "Invoice", text: "..." });
    expect(mails).toEqual(["buyer@example.com"]);
  });

  it("shows its own drill on its Backups screen and answers it at /api/backups/drill", async () => {
    // Any other ERP: no drill, and the route says so.
    expect((await drillRoute()).status).toBe(404);
    expect((await getBackupOverview()).thisDrill).toBeNull();

    await markDrill({ address: "drill.example.com", startedAt: "2026-10-18T04:00:00Z" });
    expect((await getBackupOverview()).thisDrill).toMatchObject({
      address: "drill.example.com",
      result: null,
    });
    await markDrill(FINISHED);
    const overview = await getBackupOverview();
    expect(overview.thisDrill).toMatchObject({ seconds: 2772, result: "worked", https: true });
    const answer = await drillRoute();
    expect(answer.status).toBe(200);
    const body = (await answer.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      address: "drill.example.com",
      finishedAt: "2026-10-18T04:46:12.000Z",
      seconds: 2772,
      backup: "2026-10-17_140000",
      result: "worked",
    });
    // Not how big the business is.
    expect(body).not.toHaveProperty("records");
    expect(body).not.toHaveProperty("files");
  });

  it("records a finished drill of this ERP's own backup on the real ERP, and only that", async () => {
    const owner = await makeUser("owner@example.com", { isSuperAdmin: true });
    const actor = { userId: owner.id };
    await prisma.backupRun.create({
      data: {
        kind: "BACKUP",
        name: "2026-10-17_140000",
        status: "SUCCEEDED",
        trigger: "SCHEDULED",
      },
    });
    let answer: { status: number; text: string } = { status: 200, text: "" };
    const asked: string[] = [];
    standInForDrillCopy(async (url) => {
      asked.push(url);
      return answer;
    });

    // Not a web address (the form says so), or this ERP's own.
    await expect(recordServerDrill(actor, { address: "not an address" })).rejects.toThrow(
      /Type a web address like drill/,
    );
    expect(
      (await appError(recordServerDrill(actor, { address: "https://ERP.example.com/" }))).code,
    ).toBe("VALIDATION");
    expect(asked).toEqual([]);

    // Not a drill copy; not finished yet; another ERP's backup.
    answer = { status: 404, text: "{}" };
    expect(
      (await appError(recordServerDrill(actor, { address: "drill.example.com" }))).message,
    ).toMatch(/is not a restore drill copy/);
    answer = { status: 200, text: JSON.stringify({ ...FINISHED, result: null, finishedAt: null }) };
    expect(
      (await appError(recordServerDrill(actor, { address: "drill.example.com" }))).message,
    ).toMatch(/has not finished yet/);
    answer = { status: 200, text: JSON.stringify({ ...FINISHED, backup: "2025-01-01_000000" }) };
    expect(
      (await appError(recordServerDrill(actor, { address: "drill.example.com" }))).message,
    ).toMatch(/not restored from one of this ERP's backups/);
    expect((await getBackupOverview()).lastServerDrill).toBeNull();

    // A drill copy that cannot be reached.
    standInForDrillCopy(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect((await appError(recordServerDrill(actor, { address: "drill.example.com" }))).code).toBe(
      "UNAVAILABLE",
    );

    // The real one.
    standInForDrillCopy(async (url) => {
      asked.push(url);
      return { status: 200, text: JSON.stringify(FINISHED) };
    });
    const recorded = await recordServerDrill(actor, { address: " https://Drill.example.com/ " });
    expect(asked.at(-1)).toBe("https://drill.example.com/api/backups/drill");
    expect(recorded).toMatchObject({
      address: "drill.example.com",
      seconds: 2772,
      result: "worked",
    });
    expect((await getBackupOverview()).lastServerDrill).toMatchObject({
      address: "drill.example.com",
      seconds: 2772,
      result: "worked",
      backup: "2026-10-17_140000",
    });
    expect(
      await prisma.auditLog.findFirst({
        where: {
          entityType: "BackupConfig",
          summary: { contains: "restore drill on a new server" },
        },
      }),
    ).toMatchObject({ userId: owner.id });

    // On a drill copy itself, nothing is recorded.
    await mkdir(backupDir, { recursive: true });
    await markDrill();
    expect(
      (await appError(recordServerDrill(actor, { address: "drill.example.com" }))).message,
    ).toMatch(/This is the drill copy/);
  });

  it("reads only sane fields from a drill's mark", async () => {
    await markDrill({ address: "x; rm -rf /", seconds: -4, result: "maybe", backup: "../../etc" });
    expect(await drillInfo()).toMatchObject({
      address: null,
      seconds: null,
      result: null,
      backup: null,
    });
    await writeFile(path.join(backupDir, DRILL_MARK), "not json");
    // Still a drill copy: test mode does not depend on reading the mark.
    expect(await onDrill()).toBe(true);
    expect(await drillInfo()).toMatchObject({ address: null, result: null });
  });
});
